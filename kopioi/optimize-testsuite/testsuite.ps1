## Measures test-suite runs for the optimize-testsuite skill and keeps the reports outside the projects.
##   testsuite.ps1 measure -Root <project> [-RunnerArgs '-q'] [-Repeat 3] [-TimeoutSec <auto>] [-Selection focused]
##   testsuite.ps1 status  -Root <project>          recent median, baseline and what was advised, per kind of run
##   testsuite.ps1 accept-baseline -Root <project> [-AllowFewerTests]
##   testsuite.ps1 evaluate                         the daily hook: cwd and event from stdin JSON, one advisory or nothing
## measure runs pytest from <project>\.venv.
## Exit 0 when every run completed and passed, 1 otherwise. Reports: <StateDir>\<hash of root>\<id>.summary.json,
## <id>.cases.json (one row per test) and <id>.log (the run's output).
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('measure', 'evaluate', 'accept-baseline', 'status')]
    [string]$Command = 'status',
    [string]$Root,
    [string[]]$RunnerArgs = @(),
    [ValidateSet('full', 'focused')][string]$Selection = 'full',
    [int]$Repeat = 1,
    [int]$TimeoutSec = 0,
    [string]$Python,
    [switch]$AllowFewerTests,
    [string]$Cwd,
    [string]$HookEvent,
    [datetime]$Now = [datetime]::UtcNow,
    [string]$StateDir = (Join-Path $HOME '.claude/test-suite-metrics')
)

$ErrorActionPreference = 'Stop'

$Schema = 1
$KeepRuns = 100
$DefaultTimeoutSec = @{ pytest = 600 }
$SlowSeconds = 60
$WorsePercent = 1.25
$WorseSeconds = 10
$RecentDays = 14
$CooldownDays = 7

function Write-Json([string]$Path, $Value) {
    $temp = "$Path.tmp"
    ConvertTo-Json -InputObject $Value -Depth 6 | Set-Content -LiteralPath $temp -Encoding utf8
    [System.IO.File]::Move($temp, $Path, $true)
}

function Read-Json([string]$Path) {
    try { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable }
    catch { throw "Cannot read $Path (modified $((Get-Item -LiteralPath $Path).LastWriteTimeUtc.ToString('o'))): $($_.Exception.Message)" }
}

function Get-CanonicalRoot([string]$Path) {
    if (-not $Path) { throw '-Root is required.' }
    (Resolve-Path -LiteralPath $Path).ProviderPath.TrimEnd('\')
}

function Get-Roots {
    $path = Join-Path $StateDir 'roots.json'
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    @(Read-Json $path)
}

function Find-Root([string]$CanonicalRoot) {
    Get-Roots | Where-Object { $_.root -eq $CanonicalRoot } | Select-Object -First 1
}

function Register-Root([string]$CanonicalRoot, [string]$Runner) {
    $known = Find-Root $CanonicalRoot
    if ($known) { return $known }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($CanonicalRoot.ToLowerInvariant())
    $hash = [System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).Substring(0, 16).ToLowerInvariant()
    $entry = [ordered]@{ root = $CanonicalRoot; hash = $hash; runner = $Runner; slowRule = $true }
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    Write-Json (Join-Path $StateDir 'roots.json') @(@(Get-Roots) + $entry)
    $entry
}

function Get-ProjectDir($Entry) {
    $dir = Join-Path $StateDir $Entry.hash
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $dir
}

$Skipped =[System.Collections.Generic.HashSet[string]]::new()

function Get-Summaries([string]$ProjectDir) {
    @(Get-ChildItem -LiteralPath $ProjectDir -Filter *.summary.json | Sort-Object Name -Descending |
        Select-Object -First $KeepRuns | ForEach-Object {
            try {
                $s = Read-Json $_.FullName
                if ($s.schema -ne $Schema) { throw "Cannot read $($_.FullName): schema $($s.schema), this script reads schema $Schema." }
                $s
            }
            catch {
                if (-not $SkipUnreadable) { throw }
                if ($Skipped.Add($_.Exception.Message)) { Write-Host "skipped: $($_.Exception.Message)" }
            }
        })
}

function Test-Valid($Summary) {
    $counted = $Summary.passed + $Summary.failed + $Summary.skipped + $Summary.xfailed + $Summary.xpassed
    $Summary.status -eq 'completed' -and $Summary.exitCode -eq 0 -and $Summary.failed -eq 0 -and $Summary.errors -eq 0 -and
        $null -ne $Summary.wallSeconds -and $Summary.collected -gt 0 -and $Summary.collected -ge $counted
}

function Get-Median([double[]]$Values) {
    $sorted = @($Values | Sort-Object)
    $sorted[[int][Math]::Floor(($sorted.Count - 1) / 2)]
}

function Get-Tolerance([int]$A, [int]$B) {
    [Math]::Max(5, [int][Math]::Ceiling(0.05 * [Math]::Max($A, $B)))
}

function Remove-OldRuns([string]$ProjectDir) {
    $statePath = Join-Path $ProjectDir 'state.json'
    $keep = @()
    if (Test-Path -LiteralPath $statePath) {
        # Without a readable state the baseline runs are unknown, so nothing is pruned.
        try { $state = Read-Json $statePath } catch { return }
        $keep = @($state.baselines.Values | ForEach-Object { $_.ids })
    }
    $old = Get-ChildItem -LiteralPath $ProjectDir -Filter *.summary.json | Sort-Object Name -Descending |
        Where-Object { ($_.Name -replace '\.summary\.json$') -notin $keep } | Select-Object -Skip $KeepRuns
    foreach ($file in $old) {
        $id = $file.Name -replace '\.summary\.json$'
        Remove-Item -LiteralPath (Join-Path $ProjectDir "$id.summary.json"), (Join-Path $ProjectDir "$id.cases.json"),
            (Join-Path $ProjectDir "$id.log") -Force -ErrorAction SilentlyContinue
    }
}

function Get-Git([string]$CanonicalRoot) {
    $revision = & git -C $CanonicalRoot rev-parse --short HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return @{ revision = $null; dirtyFiles = $null } }
    @{ revision = "$revision"; dirtyFiles = @(& git -C $CanonicalRoot status --porcelain | Where-Object { $_ }).Count }
}

function Invoke-Child([string]$Exe, [string[]]$Arguments, [string]$WorkDir, [hashtable]$Environment, [int]$Seconds, [string]$LogPath) {
    $info = [System.Diagnostics.ProcessStartInfo]::new($Exe)
    foreach ($a in $Arguments) { $info.ArgumentList.Add($a) }
    $info.WorkingDirectory = $WorkDir
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($name in $Environment.Keys) {
        if ($null -eq $Environment[$name]) { [void]$info.Environment.Remove($name) } else { $info.Environment[$name] = $Environment[$name] }
    }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $process = [System.Diagnostics.Process]::Start($info)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($Seconds * 1000)
    if ($timedOut) {
        # The venv launcher starts the real interpreter as a child, so the whole tree goes.
        & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
        $process.WaitForExit()
    }
    $clock.Stop()
    Set-Content -LiteralPath $LogPath -Value ($stdout.Result + $stderr.Result) -Encoding utf8
    @{ timedOut = $timedOut; exitCode = $process.ExitCode; seconds = [Math]::Round($clock.Elapsed.TotalSeconds, 2) }
}

function New-Summary([string]$Id, [datetime]$StartedUtc, [string]$CanonicalRoot, [string]$Runner, [string[]]$Argv, [string]$RunSelection) {
    [ordered]@{
        schema = $Schema; id = $Id; startedUtc = $StartedUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [cultureinfo]::InvariantCulture)
        root = $CanonicalRoot; runner = $Runner; runnerVersion = $null; runtime = $null; argv = $Argv; selection = $RunSelection
        membership = $null; collected = $null; passed = $null; failed = $null; skipped = $null; xfailed = $null; xpassed = $null
        errors = $null; status = 'not-started'; exitCode = $null; wallSeconds = $null; phases = $null; workers = $null
        revision = $null; dirtyFiles = $null; log = $null; timeoutSec = $null
    }
}

function Get-Timeout([string]$ProjectDir, [string]$Runner, [string]$RunSelection) {
    if ($TimeoutSec -gt 0) { return $TimeoutSec }
    # Earlier runs only raise the limit: they may come from another interpreter or a much smaller suite.
    $walls = @(Get-Summaries $ProjectDir | Where-Object { (Test-Valid $_) -and $_.runner -eq $Runner -and $_.selection -eq $RunSelection } |
        Select-Object -First 3 | ForEach-Object { [double]$_.wallSeconds })
    if ($walls.Count -lt 3) { return $DefaultTimeoutSec[$Runner] }
    [int][Math]::Max($DefaultTimeoutSec[$Runner], 3 * (Get-Median $walls))
}

function Assert-RunnerArgs {
    $joined = @($RunnerArgs | Where-Object { $_ -match "^'|^-\S*,-" })
    if ($joined) {
        throw "-RunnerArgs got $($joined -join ' ') as one argument: 'pwsh -File' hands a list over as one string. Call the script " +
            "from PowerShell instead: & testsuite.ps1 measure -Root <root> -RunnerArgs @('-q', '-n', '12')"
    }
}

function Measure-Pytest([string]$CanonicalRoot, $Entry) {
    $exe = if ($Python) { $Python } else { Join-Path $CanonicalRoot '.venv\Scripts\python.exe' }
    if (-not (Test-Path -LiteralPath $exe)) { throw "No Python interpreter at $exe; pass -Python." }
    $dir = Get-ProjectDir $Entry
    $started = [datetime]::UtcNow
    # Milliseconds keep the ids of one process in run order; the two random digits separate two processes.
    $id = '{0}{1}' -f $started.ToString('yyyyMMdd-HHmmss-fff'), [guid]::NewGuid().ToString('N').Substring(0, 2)
    $summary = New-Summary $id $started $CanonicalRoot 'pytest' (@('python', '-m', 'pytest') + $RunnerArgs) $Selection
    $summary.log = "$id.log"
    $n = [Array]::IndexOf($RunnerArgs, '-n')
    if ($n -ge 0 -and $n + 1 -lt $RunnerArgs.Count) { $summary.workers = $RunnerArgs[$n + 1] }
    $git = Get-Git $CanonicalRoot
    $summary.revision = $git.revision
    $summary.dirtyFiles = $git.dirtyFiles

    $out = Join-Path $dir $id
    $arguments = @('-m', 'pytest') + $RunnerArgs + @('-p', 'tsm_report', '-o', 'faulthandler_timeout=45')
    $environment = @{ TSM_OUT = $out; PYTHONUNBUFFERED = '1'
                      PYTHONPATH = (@($PSScriptRoot, $env:PYTHONPATH) | Where-Object { $_ }) -join ';' }
    $summary.timeoutSec = Get-Timeout $dir 'pytest' $Selection
    $run = Invoke-Child $exe $arguments $CanonicalRoot $environment $summary.timeoutSec (Join-Path $dir "$id.log")

    $pluginPath = "$out.plugin.json"
    if ($run.timedOut) {
        $summary.status = 'timeout'
    }
    elseif (Test-Path -LiteralPath $pluginPath) {
        $plugin = Read-Json $pluginPath
        $summary.status = 'completed'
        $summary.wallSeconds = $run.seconds
        foreach ($name in 'runnerVersion', 'runtime', 'membership', 'collected', 'phases', 'workers') { $summary[$name] = $plugin[$name] }
        foreach ($name in 'passed', 'failed', 'skipped', 'xfailed', 'xpassed') { $summary[$name] = $plugin.counts[$name] }
        $summary.errors = $plugin.counts.error
    }
    if (-not $run.timedOut) { $summary.exitCode = $run.exitCode }
    Remove-Item -LiteralPath $pluginPath -Force -ErrorAction SilentlyContinue
    Write-Json "$out.summary.json" $summary
    $summary
}

function Get-Key($Summary) {
    @($Summary.runner, $Summary.runnerVersion, $Summary.runtime, ($Summary.argv -join ' '), $Summary.workers, $Summary.selection) -join '|'
}

function ConvertTo-Utc($Value) {
    if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
    [datetime]::Parse($Value, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

function Get-Day([datetime]$Utc) {
    $Utc.ToLocalTime().ToString('yyyy-MM-dd')
}

function Format-Seconds([double]$Value) {
    if ($Value -eq [Math]::Round($Value)) { "$([int]$Value) s" } else { "$([Math]::Round($Value, 1)) s" }
}

function Format-Tests($Runs) {
    $counts = @($Runs | ForEach-Object { [int]$_.collected } | Sort-Object)
    if ($counts[0] -eq $counts[-1]) { "$($counts[0]) tests" } else { "$($counts[0])-$($counts[-1]) tests" }
}

function Test-Comparable($A, $B) {
    if ((Get-Key $A) -ne (Get-Key $B)) { return $false }
    if ($A.membership -eq $B.membership) { return $true }
    $tolerance = Get-Tolerance $A.collected $B.collected
    [Math]::Abs($A.collected - $B.collected) -le $tolerance -and
        [Math]::Abs(($A.skipped + $A.xfailed) - ($B.skipped + $B.xfailed)) -le $tolerance
}

function Test-Trio($Runs) {
    (Test-Comparable $Runs[0] $Runs[1]) -and (Test-Comparable $Runs[0] $Runs[2]) -and (Test-Comparable $Runs[1] $Runs[2])
}

function New-Baseline($Runs, [string]$By, [string]$Day) {
    [ordered]@{
        ids = @($Runs | ForEach-Object { $_.id })
        median = Get-Median ($Runs | ForEach-Object { [double]$_.wallSeconds })
        collected = [int](Get-Median ($Runs | ForEach-Object { [double]$_.collected }))
        skipped = [int](Get-Median ($Runs | ForEach-Object { [double]($_.skipped + $_.xfailed) }))
        runsUntil = Get-Day (ConvertTo-Utc $Runs[2].startedUtc); setOn = $Day; by = $By
    }
}

function Read-State([string]$ProjectDir, $Entry) {
    $path = Join-Path $ProjectDir 'state.json'
    if (-not (Test-Path -LiteralPath $path)) {
        return @{ schema = $Schema; root = $Entry.root; evaluatedDay = $null; baselines = @{}; advised = @{} }
    }
    $state = Read-Json $path
    if ($state.schema -ne $Schema) { throw "Cannot read ${path}: schema $($state.schema), this script reads schema $Schema." }
    foreach ($name in 'baselines', 'advised') { if ($null -eq $state[$name]) { $state[$name] = @{} } }
    $state
}

function Get-Standing($Entry, $State, [datetime]$NowUtc) {
    # One record per kind of full run: what the recent runs say against the baseline.
    $runs = @(Get-Summaries (Join-Path $StateDir $Entry.hash) | Where-Object { $_.selection -ne 'focused' } |
        Sort-Object { ConvertTo-Utc $_.startedUtc })
    foreach ($group in $runs | Group-Object { Get-Key $_ }) {
        $valid = @($group.Group | Where-Object { Test-Valid $_ })
        $baseline = $State.baselines[$group.Name]
        for ($i = 0; -not $baseline -and $i + 2 -lt $valid.Count; $i++) {
            if (Test-Trio $valid[$i..($i + 2)]) { $baseline = New-Baseline $valid[$i..($i + 2)] 'first-trio' (Get-Day $NowUtc) }
        }
        $standing = @{ key = $group.Name; selection = $group.Group[0].selection; runner = $group.Group[0].runner; runs = $valid.Count
                       baseline = $baseline; recent = $null; median = $null; note = $null; reasons = @() }
        $last = @($valid | Select-Object -Last 3)
        if ($last.Count -lt 3) {
            $standing.note = 'three completed runs are needed'
        }
        elseif (($NowUtc - (ConvertTo-Utc $last[0].startedUtc)).TotalDays -gt $RecentDays) {
            $standing.note = "no three runs in the last $RecentDays days"
        }
        elseif (-not (Test-Trio $last)) {
            $standing.note = "the last three runs are not comparable: $(Format-Tests $last)"
        }
        else {
            $standing.recent = $last
            $standing.median = Get-Median ($last | ForEach-Object { [double]$_.wallSeconds })
            if ($Entry.slowRule -and $standing.median -gt $SlowSeconds) { $standing.reasons = @('slow') }
            if ($baseline) {
                $collected = [int](Get-Median ($last | ForEach-Object { [double]$_.collected }))
                $skipped = [int](Get-Median ($last | ForEach-Object { [double]($_.skipped + $_.xfailed) }))
                $tolerance = Get-Tolerance $collected $baseline.collected
                if ([Math]::Abs($collected - $baseline.collected) -gt $tolerance -or [Math]::Abs($skipped - $baseline.skipped) -gt $tolerance) {
                    $standing.note = "the baseline of $($baseline.collected) tests is no longer comparable; accept a new one"
                }
                elseif ($standing.median -gt $WorsePercent * $baseline.median -and $standing.median - $baseline.median -gt $WorseSeconds) {
                    $standing.reasons = @('regression') + $standing.reasons
                }
            }
        }
        $standing
    }
}

function Select-Advisory($Entry, $State, $Standings, [string]$Today) {
    $candidates = foreach ($standing in $Standings) {
        foreach ($reason in $standing.reasons) {
            $last = if ($State.advised[$standing.key]) { $State.advised[$standing.key][$reason] }
            $again = $last -and $standing.median -gt $WorsePercent * $last.median -and $standing.median - $last.median -gt $WorseSeconds -and
                ([datetime]$Today - [datetime]"$($last.day)").TotalDays -ge $CooldownDays
            if (-not $last -or $again) { @{ standing = $standing; reason = $reason } }
        }
    }
    $chosen = @($candidates) | Sort-Object { $_.reason -ne 'regression' }, { -$_.standing.median } | Select-Object -First 1
    if (-not $chosen) { return $null }
    $standing = $chosen.standing
    if (-not $State.advised[$standing.key]) { $State.advised[$standing.key] = @{} }
    $State.advised[$standing.key][$chosen.reason] = @{ day = $Today; median = $standing.median }

    $name = Split-Path -Leaf $Entry.root
    $runs = "the median of the last three comparable $($standing.selection) runs is $(Format-Seconds $standing.median)"
    $span = "$(Format-Tests $standing.recent), $(Get-Day (ConvertTo-Utc $standing.recent[0].startedUtc)) to $(Get-Day (ConvertTo-Utc $standing.recent[2].startedUtc))"
    $finding = if ($chosen.reason -eq 'regression') {
        $over = $standing.median - $standing.baseline.median
        "regression: $runs, $(Format-Seconds $over) ($([int](100 * $over / $standing.baseline.median)) %) over the baseline of " +
            "$(Format-Seconds $standing.baseline.median) from $($standing.baseline.runsUntil) ($span)."
    }
    else {
        $off = if ($standing.note) { " Regression check off: $($standing.note)." } else { '' }
        "slow suite: $runs ($span), over the $SlowSeconds s mark.$off"
    }
    $text = "Test-suite advisory for ${name}: $finding In your next reply add one brief suggestion to run /optimize-testsuite " +
        'for this project; do not start it unasked.'
    $text.Substring(0, [Math]::Min($text.Length, 600))
}

function Find-RootOf([string]$Path) {
    $path = $Path.Replace('/', '\').TrimEnd('\')
    Get-Roots | Where-Object { $path -eq $_.root -or $path.StartsWith("$($_.root)\", [System.StringComparison]::OrdinalIgnoreCase) } |
        Sort-Object { $_.root.Length } -Descending | Select-Object -First 1
}

function Format-Run($Summary) {
    $tests = if ($null -ne $Summary.collected) { "$($Summary.collected) tests" } else { 'tests unknown' }
    $wall = if ($null -ne $Summary.wallSeconds) { "$($Summary.wallSeconds) s" } else { 'no wall time' }
    $failures = if ($Summary.failed -or $Summary.errors) { "  $($Summary.failed) failed, $($Summary.errors) errors" } else { '' }
    "$($Summary.id)  $($Summary.status)  $tests  $wall  exit $($Summary.exitCode)$failures"
}

$SkipUnreadable = $Command -in 'measure', 'status', 'accept-baseline'

switch ($Command) {
    'measure' {
        Assert-RunnerArgs
        $canonical = Get-CanonicalRoot $Root
        $known = Find-Root $canonical
        $entry = if ($known) { $known } else { Register-Root $canonical 'pytest' }
        $bad = 0
        foreach ($i in 1..$Repeat) {
            $summary = Measure-Pytest $canonical $entry
            Format-Run $summary
            if (-not (Test-Valid $summary)) {
                $bad++
                "  not a clean run; output: $(Join-Path (Get-ProjectDir $entry) $summary.log)"
                if ($i -lt $Repeat) { "  stopped: $($Repeat - $i) repeat(s) not run" }
                break
            }
        }
        Remove-OldRuns (Get-ProjectDir $entry)
        if ($bad -gt 0) { exit 1 }
    }
    'status' {
        $canonical = Get-CanonicalRoot $Root
        $entry = Find-Root $canonical
        if (-not $entry) { throw "$canonical has no measurements; run measure first." }
        $dir = Get-ProjectDir $entry
        $state = Read-State $dir $entry
        $standings = @(Get-Standing $entry $state $Now.ToUniversalTime())
        if (-not $standings) { "no full runs measured for $canonical" }
        foreach ($standing in $standings) {
            $recent = if ($standing.recent) { "recent median $(Format-Seconds $standing.median) over $(Format-Tests $standing.recent)" } else { $standing.note }
            $b = $standing.baseline
            $baseline = if ($b) { "baseline $(Format-Seconds $b.median) over $($b.collected) tests from $($b.runsUntil) ($($b.by))" } else { 'no baseline' }
            $note = if ($standing.recent -and $standing.note) { "; $($standing.note)" } else { '' }
            $advised = if ($state.advised[$standing.key]) {
                '; advised: ' + (($state.advised[$standing.key].GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value.day) at $(Format-Seconds $_.Value.median)" }) -join ', ')
            } else { '' }
            "$($standing.selection) ($($standing.runner)): $($standing.runs) completed run(s); $recent; $baseline$note$advised"
        }
        "evaluated: $(if ($state.evaluatedDay) { $state.evaluatedDay } else { 'never' })"
    }
    'accept-baseline' {
        if ($Selection -eq 'focused') { throw 'A baseline is kept for full runs only.' }
        $canonical = Get-CanonicalRoot $Root
        $entry = Find-Root $canonical
        if (-not $entry) { throw "$canonical has no measurements; run measure first." }
        $dir = Get-ProjectDir $entry
        $state = Read-State $dir $entry
        $last = @(Get-Summaries $dir | Where-Object { (Test-Valid $_) -and $_.selection -eq $Selection } |
            Sort-Object { ConvertTo-Utc $_.startedUtc } | Select-Object -Last 3)
        if ($last.Count -lt 3 -or -not (Test-Trio $last)) {
            throw "accept-baseline needs three comparable completed $Selection runs as the newest ones; see status."
        }
        $key = Get-Key $last[2]
        $new = New-Baseline $last 'accepted' (Get-Day $Now.ToUniversalTime())
        $old = $state.baselines[$key]
        if ($old -and $new.collected -lt $old.collected -and -not $AllowFewerTests) {
            throw "The newest runs hold $($new.collected) tests and the baseline $($old.collected). Name the tests that are gone; when they were removed on purpose, repeat with -AllowFewerTests."
        }
        $state.baselines[$key] = $new
        # Kept as advised at the accepted median, so the slow rule speaks again only when the suite gets materially worse.
        if (-not $state.advised[$key]) { $state.advised[$key] = @{} }
        $state.advised[$key].Remove('regression')
        $state.advised[$key]['slow'] = @{ day = $new.setOn; median = $new.median }
        Write-Json (Join-Path $dir 'state.json') $state
        "baseline for $Selection runs: $(Format-Seconds $new.median) over $($new.collected) tests (accepted $($new.setOn))"
        "from runs: $($new.ids -join ', ')"
    }
    'evaluate' {
        # The daily hook. It reads reports and the state; it never starts a run.
        $nowUtc = $Now.ToUniversalTime()
        $dir = $null
        try {
            if (-not $Cwd) {
                $raw = if ([Console]::IsInputRedirected) { [Console]::In.ReadToEnd() } else { '' }
                $hook = @{}
                if ($raw.Trim()) {
                    try { $hook = $raw | ConvertFrom-Json -AsHashtable } catch { throw "stdin is not JSON: $($_.Exception.Message)" }
                }
                $Cwd = $hook.cwd
                if (-not $HookEvent) { $HookEvent = $hook.hook_event_name }
            }
            if (-not $Cwd) { throw 'no cwd in stdin.' }
            $entry = Find-RootOf $Cwd
            if (-not $entry) { exit 0 }
            $dir = Join-Path $StateDir $entry.hash
            if (-not (Test-Path -LiteralPath $dir)) { exit 0 }
            $today = Get-Day $nowUtc
            $state = Read-State $dir $entry
            if ($state.evaluatedDay -eq $today) { exit 0 }
            $standings = @(Get-Standing $entry $state $nowUtc)
            foreach ($standing in $standings) {
                if ($standing.baseline -and -not $state.baselines[$standing.key]) { $state.baselines[$standing.key] = $standing.baseline }
            }
            $advice = Select-Advisory $entry $state $standings $today
            $state.evaluatedDay = $today
            Write-Json (Join-Path $dir 'state.json') $state
            if ($advice) {
                $event = if ($HookEvent) { $HookEvent } else { 'UserPromptSubmit' }
                @{ hookSpecificOutput = @{ hookEventName = $event; additionalContext = $advice } } | ConvertTo-Json -Compress -Depth 4
            }
        }
        catch {
            $message = $_.Exception.Message
            $where = if ($dir -and (Test-Path -LiteralPath $dir)) { $dir } else { $StateDir }
            $notePath = Join-Path $where 'diagnostic.json'
            $today = Get-Day $nowUtc
            $noted = $null
            # An unreadable note only means the problem is reported again.
            if (Test-Path -LiteralPath $notePath) { try { $noted = Read-Json $notePath } catch { $noted = $null } }
            if ($noted -and $noted.day -eq $today -and $noted.message -eq $message) { exit 0 }
            if (Test-Path -LiteralPath $where) { Write-Json $notePath @{ day = $today; message = $message } }
            [Console]::Error.WriteLine("testsuite hook: $message")
            exit 1
        }
    }
}
exit 0
