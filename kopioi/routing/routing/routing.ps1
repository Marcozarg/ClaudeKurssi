[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('on', 'off', 'status', 'context', 'log', 'report')]
    [string]$Command = 'status',
    [Parameter(Position = 1)][int]$Days = 14,
    [string]$Agent,
    [string]$Model,
    [string]$Task,
    [string]$Problem,
    [switch]$Json,
    [string]$StateDir = $PSScriptRoot,
    [string]$ProjectsDir = (Join-Path $HOME ".claude/projects")
)

$ErrorActionPreference = 'Stop'

$flagPath = Join-Path $StateDir 'enabled'
$historyPath = Join-Path $StateDir 'history.jsonl'
$rulePath = Join-Path $PSScriptRoot 'rule.md'
$pricesPath = Join-Path $PSScriptRoot 'prices.json'

function Add-History([hashtable]$Entry) {
    $line = ([ordered]@{ ts = (Get-Date).ToString('o') } + $Entry) | ConvertTo-Json -Compress
    Add-Content -LiteralPath $historyPath -Value $line -Encoding utf8
}

function Read-History {
    if (-not (Test-Path -LiteralPath $historyPath)) { return @() }
    @(Get-Content -LiteralPath $historyPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}

function Get-StateAt([datetime]$At, $Toggles) {
    $state = 'off'
    foreach ($t in $Toggles) {
        if (([datetime]$t.ts).ToLocalTime() -lt $At) { $state = $t.state }
    }
    $state
}

function Get-Cost($Price, $T) {
    ($T.in * $Price.input + $T.out * $Price.output + $T.read * $Price.cacheRead +
        $T.w5 * $Price.input * 1.25 + $T.w1 * $Price.input * 2) / 1e6
}

function Read-Usage([System.IO.FileInfo]$File) {
    # One API response is written as several lines carrying the same usage; keep the last per message id.
    $messages = [ordered]@{}
    $n = 0
    # ReadWrite share: a running session keeps its transcript open for writing.
    $reader = [System.IO.StreamReader]::new([System.IO.FileStream]::new($File.FullName, 'Open', 'Read', 'ReadWrite'))
    try {
        while ($null -ne ($line = $reader.ReadLine())) {
            $n++
            if (-not $line.Contains('"usage"')) { continue }
            try { $d = $line | ConvertFrom-Json }
            catch { throw "Cannot parse $($File.FullName) line ${n}: $($_.Exception.Message)" }
            if ($d.type -ne 'assistant' -or -not $d.message.usage) { continue }
            if ($d.message.model -eq '<synthetic>') { continue }
            $id = if ($d.message.id) { $d.message.id } else { $d.uuid }
            $messages[$id] = $d
        }
    }
    finally { $reader.Dispose() }
    $messages
}

function Get-Report {
    $prices = Get-Content -LiteralPath $pricesPath -Raw | ConvertFrom-Json -AsHashtable
    $since = (Get-Date).Date.AddDays(-($Days - 1))
    $history = Read-History
    $toggles = @($history | Where-Object { $_.event -eq 'toggle' })

    $files = Get-ChildItem -LiteralPath $ProjectsDir -Recurse -Filter *.jsonl -File |
        Where-Object { $_.LastWriteTime -ge $since } | Sort-Object FullName
    $taken = @{}
    $sessions = @{}
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($file in $files) {
        $bucket = 'main'
        $session = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        if ($file.Directory.Name -eq 'subagents') {
            $session = $file.Directory.Parent.Name
            $metaPath = $file.FullName -replace '\.jsonl$', '.meta.json'
            $bucket = '(no meta)'
            if (Test-Path -LiteralPath $metaPath) {
                $bucket = (Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json).agentType
            }
        }
        foreach ($d in (Read-Usage $file).Values) {
            $id = if ($d.message.id) { $d.message.id } else { $d.uuid }
            # A resumed or forked session copies the earlier messages into its new transcript.
            if ($taken.ContainsKey($id)) { continue }
            $taken[$id] = $true
            $u = $d.message.usage
            $w5 = [long]$u.cache_creation_input_tokens
            $w1 = 0L
            if ($u.cache_creation) {
                $w5 = [long]$u.cache_creation.ephemeral_5m_input_tokens
                $w1 = [long]$u.cache_creation.ephemeral_1h_input_tokens
            }
            $t = @{ in = [long]$u.input_tokens; out = [long]$u.output_tokens; read = [long]$u.cache_read_input_tokens; w5 = $w5; w1 = $w1 }
            $t.total = $t.in + $t.out + $t.read + $w5 + $w1
            $model = $d.message.model -replace '-\d{8}$', ''
            $ts = ([datetime]$d.timestamp).ToLocalTime()
            if (-not $sessions.ContainsKey($session)) { $sessions[$session] = @{ start = $ts; mainTokens = @{} } }
            $s = $sessions[$session]
            if ($ts -lt $s.start) { $s.start = $ts }
            if ($bucket -eq 'main') { $s.mainTokens[$model] = [long]$s.mainTokens[$model] + $t.total }
            $skill = if ($d.attributionSkill) { $d.attributionSkill } else { '(no skill)' }
            $records.Add(@{ bucket = $bucket; session = $session; file = $file.FullName; model = $model; ts = $ts; t = $t; skill = $skill })
        }
    }

    foreach ($s in $sessions.Values) {
        $s.state = Get-StateAt $s.start $toggles
        $top = $s.mainTokens.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
        $s.mainPrice = if ($top) { $prices[$top.Key] } else { $null }
    }

    $byAgent = @{}
    $byDay = @{}
    $bySkill = @{}
    $byState = @{}
    $runs = @{}
    $unpriced = @{}
    $noMain = @{}
    foreach ($r in $records) {
        if ($r.ts.Date -lt $since) { continue }
        $t = $r.t
        $p = $prices[$r.model]
        $cost = 0.0
        if ($p) { $cost = Get-Cost $p $t } else { $unpriced[$r.model] = [long]$unpriced[$r.model] + $t.total }
        $s = $sessions[$r.session]
        $main = $r.bucket -eq 'main'

        $key = "$($r.bucket)|$($r.model)"
        if (-not $byAgent.ContainsKey($key)) {
            $byAgent[$key] = [ordered]@{ agent = $r.bucket; model = $r.model; runs = 0; input = 0L; output = 0L; cacheRead = 0L; cacheWrite = 0L; cost = 0.0; atMain = $null; saved = $null }
            $runs[$key] = @{}
        }
        $a = $byAgent[$key]
        $a.input += $t.in; $a.output += $t.out; $a.cacheRead += $t.read; $a.cacheWrite += $t.w5 + $t.w1; $a.cost += $cost
        $runs[$key][$r.file] = $true
        if (-not $main) {
            $atMain = $cost
            if ($s.mainPrice) { $atMain = Get-Cost $s.mainPrice $t } else { $noMain[$r.session] = $true }
            $a.atMain = [double]$a.atMain + $atMain
            $a.saved = $a.atMain - $a.cost
        }

        $dayKey = $r.ts.ToString('yyyy-MM-dd')
        if (-not $byDay.ContainsKey($dayKey)) {
            $byDay[$dayKey] = [ordered]@{ date = $dayKey; mainCost = 0.0; agentCost = 0.0; totalCost = 0.0; tokens = 0L }
        }
        # The skill invoked last in the user's turn; a skill started inside another takes over.
        if (-not $bySkill.ContainsKey($r.skill)) {
            $bySkill[$r.skill] = [ordered]@{ skill = $r.skill; mainCost = 0.0; agentCost = 0.0; totalCost = 0.0; tokens = 0L }
        }
        if (-not $byState.ContainsKey($s.state)) {
            $byState[$s.state] = [ordered]@{ routing = $s.state; sessions = @{}; mainCost = 0.0; agentCost = 0.0; totalCost = 0.0; tokens = 0L }
        }
        $byState[$s.state].sessions[$r.session] = $true
        foreach ($row in $byDay[$dayKey], $bySkill[$r.skill], $byState[$s.state]) {
            if ($main) { $row.mainCost += $cost } else { $row.agentCost += $cost }
            $row.totalCost += $cost
            $row.tokens += $t.total
        }
    }
    foreach ($key in $runs.Keys) { $byAgent[$key].runs = $runs[$key].Count }
    foreach ($row in $byState.Values) {
        $row.sessions = $row.sessions.Count
        $row.perSession = $row.totalCost / $row.sessions
    }

    $problems = @($history | Where-Object { $_.event -eq 'problem' -and ([datetime]$_.ts).ToLocalTime() -ge $since })
    foreach ($a in $byAgent.Values) {
        $a.problems = @($problems | Where-Object { $_.agent -eq $a.agent }).Count
    }

    [ordered]@{
        since    = $since.ToString('yyyy-MM-dd')
        days     = $Days
        byState  = @($byState.Values | Sort-Object { $_.routing } -Descending)
        byDay    = @($byDay.Values | Sort-Object { $_.date })
        bySkill  = @($bySkill.Values | Sort-Object { -$_.totalCost })
        byAgent  = @($byAgent.Values | Sort-Object { -$_.cost })
        problems = $problems
        unpriced = @($unpriced.GetEnumerator() | ForEach-Object { [ordered]@{ model = $_.Key; tokens = $_.Value } })
        noMain   = @($noMain.Keys | Sort-Object)
    }
}

function Fmt($Value, [string]$Format) {
    ([double]$Value).ToString($Format, [cultureinfo]::InvariantCulture)
}

# Format-Table drops the last columns when the host is narrow, whatever Out-String -Width says.
function Show-Table([object[]]$Rows) {
    if ($Rows.Count -eq 0) { return }
    $names = @($Rows[0].Keys)
    $width = @{}
    foreach ($n in $names) {
        $width[$n] = (@($n.Length) + @($Rows | ForEach-Object { ([string]$_[$n]).Length }) | Measure-Object -Maximum).Maximum
    }
    ($names | ForEach-Object { $_.PadRight($width[$_]) }) -join '  '
    ($names | ForEach-Object { '-' * $width[$_] }) -join '  '
    foreach ($row in $Rows) { ($names | ForEach-Object { ([string]$row[$_]).PadRight($width[$_]) }) -join '  ' }
    ''
}

switch ($Command) {
    'on' {
        if (-not (Test-Path -LiteralPath $flagPath)) {
            New-Item -ItemType File -Path $flagPath | Out-Null
            Add-History @{ event = 'toggle'; state = 'on' }
        }
        'Model routing: on'
        ''
        Get-Content -LiteralPath $rulePath -Raw
    }
    'off' {
        if (Test-Path -LiteralPath $flagPath) {
            Remove-Item -LiteralPath $flagPath
            Add-History @{ event = 'toggle'; state = 'off' }
        }
        'Model routing: off. For the rest of this session do not delegate to scout, runner or implementer, and start the sub-agents of skills and of plan mode without a model override.'
    }
    'status' {
        if (Test-Path -LiteralPath $flagPath) { 'Model routing: on' } else { 'Model routing: off' }
    }
    'context' {
        if (Test-Path -LiteralPath $flagPath) { Get-Content -LiteralPath $rulePath -Raw }
    }
    'log' {
        if (-not $Agent -or -not $Problem) { throw 'log needs -Agent and -Problem' }
        Add-History @{ event = 'problem'; agent = $Agent; model = $Model; task = $Task; problem = $Problem; cwd = (Get-Location).Path }
        "Logged problem for $Agent"
    }
    'report' {
        $r = Get-Report
        if ($Json) { $r | ConvertTo-Json -Depth 6; break }

        "Model routing report, $($r.since) to today ($($r.days) days). Cost is USD at API list prices; on a subscription read it as a relative weight."
        ''
        'Per routing state at session start'
        Show-Table @($r.byState | ForEach-Object {
            [ordered]@{
                Routing = $_.routing; Sessions = $_.sessions
                'Main $' = Fmt $_.mainCost N2; 'Agents $' = Fmt $_.agentCost N2
                'Total $' = Fmt $_.totalCost N2; '$/session' = Fmt $_.perSession N2; 'Tokens k' = Fmt ($_.tokens / 1000) N0
            }
        })
        'Per day'
        Show-Table @($r.byDay | ForEach-Object {
            [ordered]@{
                Date = $_.date
                'Main $' = Fmt $_.mainCost N2; 'Agents $' = Fmt $_.agentCost N2
                'Total $' = Fmt $_.totalCost N2; 'Tokens k' = Fmt ($_.tokens / 1000) N0
            }
        })
        'Per skill'
        Show-Table @($r.bySkill | ForEach-Object {
            [ordered]@{
                Skill = $_.skill
                'Main $' = Fmt $_.mainCost N2; 'Agents $' = Fmt $_.agentCost N2
                'Total $' = Fmt $_.totalCost N2; 'Tokens k' = Fmt ($_.tokens / 1000) N0
            }
        })
        'Per agent and model ("At main $": the same tokens at the prices of the session''s main model)'
        Show-Table @($r.byAgent | ForEach-Object {
            [ordered]@{
                Agent = $_.agent; Model = $_.model; Runs = $_.runs
                'In k' = Fmt ($_.input / 1000) N0; 'Out k' = Fmt ($_.output / 1000) N0
                'Cache read k' = Fmt ($_.cacheRead / 1000) N0; 'Cache write k' = Fmt ($_.cacheWrite / 1000) N0
                'Cost $' = Fmt $_.cost N2
                'At main $' = $(if ($null -ne $_.atMain) { Fmt $_.atMain N2 } else { '' })
                'Saved $' = $(if ($null -ne $_.saved) { Fmt $_.saved N2 } else { '' })
                Problems = $_.problems
            }
        })
        if ($r.problems.Count -gt 0) {
            'Logged problems'
            $r.problems | ForEach-Object { "  $(([datetime]$_.ts).ToLocalTime().ToString('yyyy-MM-dd')) $($_.agent) ($($_.model)) $($_.task): $($_.problem)" }
            ''
        }
        foreach ($u in $r.unpriced) {
            Write-Warning "No price for model '$($u.model)' ($($u.tokens) tokens counted at 0 USD). Add it to $pricesPath."
        }
        if ($r.noMain.Count -gt 0) {
            Write-Warning "No priced main transcript for session(s) $($r.noMain -join ', '); their agents' saving counts 0."
        }
    }
}
