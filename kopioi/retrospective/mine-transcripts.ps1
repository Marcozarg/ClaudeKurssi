## Counts repeated work, corrections, review findings, test runs and stale records in a project's Claude Code history.
## Usage: mine-transcripts.ps1 -Project <folder under ~/.claude/projects> [-Days 30] [-OutFile <report.md>] [-ProjectsDir <projects folder>]
## Streams the *.jsonl transcripts line by line (never loads one whole); writes a markdown report. PowerShell 7.
param(
    [Parameter(Mandatory = $true)][string]$Project,
    [int]$Days = 30,
    [string]$OutFile = '',
    [string]$ProjectsDir = (Join-Path $HOME '.claude/projects')
)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $ProjectsDir $Project
if(-not (Test-Path -LiteralPath $Root)) { [Console]::Error.WriteLine("no such project folder: $Root"); exit 1 }
if(-not $OutFile) { $OutFile = Join-Path ([IO.Path]::GetTempPath()) "retro-$Project.md" }
$Since = (Get-Date).AddDays(-$Days)
$Files = @(Get-ChildItem -LiteralPath $Root -Filter '*.jsonl' | Where-Object { $_.LastWriteTime -ge $Since } | Sort-Object LastWriteTime)
$Shapes = @{}; $Corrections = [System.Collections.Generic.List[string]]::new(); $Findings = @{}; $Runs = [System.Collections.Generic.List[string]]::new()
$FailNames = @{}; $Skills = @{}; $Tools = @{}; $Compactions = 0; $UserMsgs = 0; $Unreadable = 0
$CorrectionRx = '(?i)\b(still|again|does ?n.t work|don.t want|i dont|broken|wrong|not what|why do we)\b'
$CategoryRx = @{ 'fail-open' = '(?i)fail.?open|silent|looks clean|counted as'; compatibility = '(?i)older (kit|version|importer)|format|compat|schema'; 'trust boundary' = '(?i)secret|key|password|control char|sanitis|identity|SID|ACL'; lifecycle = '(?i)upgrade|interrupt|rollback|rerun|first install|lifecycle'; contract = '(?i)contract|assum|helper|parameter|return'; race = '(?i)race|order|atomic|concurren|revision'; ui = '(?i)legend|screen|key|width|UI'; test = '(?i)\btest' }
function Add-Count([hashtable]$H, [string]$K) { if($H.ContainsKey($K)) { $H[$K]++ } else { $H[$K] = 1 } }
function Get-Shape([string]$Cmd)
{
    $S = $Cmd -replace '[A-Za-z]:\\[^\s"'']+', '<path>' -replace '/[^\s"'']+', '<path>' -replace '\d{4}\.\d{2}\.\d{2}\.\d{4}', '<ver>' -replace '\d+', 'N'
    if($S.Length -gt 90) { $S = $S.Substring(0, 90) }
    return $S.Trim()
}
foreach($F in $Files)
{
    $Reader = [IO.StreamReader]::new($F.FullName, [Text.Encoding]::UTF8)
    try
    {
        while(-not $Reader.EndOfStream)
        {
            $Line = $Reader.ReadLine()
            if(-not $Line.StartsWith('{')) { continue }
            try { $J = $Line | ConvertFrom-Json } catch { $Unreadable++; continue }
            if($J.timestamp -and ([datetime]$J.timestamp) -lt $Since) { continue }
            $Type = [string]$J.type
            $Content = $J.message.content
            if($Type -eq 'user' -and $Content -is [string]) { $UserMsgs++; if($Content -match $CorrectionRx -and $Content.Length -lt 400) { $Corrections.Add($Content.Trim()) } ; if($Content -match '/compact') { $Compactions++ } }
            if($Content -is [array])
            {
                foreach($C in $Content)
                {
                    if($C.type -eq 'text' -and $Type -eq 'user' -and [string]$C.text -match $CorrectionRx -and ([string]$C.text).Length -lt 400) { $UserMsgs++; $Corrections.Add(([string]$C.text).Trim()) }
                    if($C.type -eq 'tool_use')
                    {
                        Add-Count $Tools ([string]$C.name)
                        if($C.name -in 'Bash', 'PowerShell') { Add-Count $Shapes (Get-Shape ([string]$C.input.command)) }
                        if($C.name -eq 'Skill') { Add-Count $Skills ([string]$C.input.skill) }
                    }
                    if($C.type -eq 'tool_result' -or $C.type -eq 'text')
                    {
                        $T = if($C.type -eq 'text') { [string]$C.text } else { [string]($C.content | ForEach-Object { if($_.text) { $_.text } else { $_ } }) }
                        foreach($M in [regex]::Matches($T, '(?m)^\s*(\d+) tests, (\d+) passed, (\d+) failed[^\r\n]*')) { $Runs.Add($M.Value.Trim()) }; foreach($M in [regex]::Matches($T, '(?m)^[= ]*((?:\d+ (?:failed|passed|skipped|errors?|deselected|xfailed|xpassed|warnings?)(?:, )?)+ in [\d.]+s)')) { $Runs.Add($M.Groups[1].Value) }; foreach($M in [regex]::Matches($T, '(?m)^FAILED (tests[/\\][^\s:]+::[A-Za-z0-9_]+)')) { Add-Count $FailNames $M.Groups[1].Value }
                        foreach($M in [regex]::Matches($T, '(?m)^\s{2}([A-Za-z0-9_]+(?: [^:\r\n]*)?): (?:FAIL|TIMEOUT|.*not recognized)')) { Add-Count $FailNames $M.Groups[1].Value }
                        foreach($M in [regex]::Matches($T, '(?m)^\s*(?:\d+\.\s*)?\*{0,2}\[(P[123])\][^\r\n]{10,160}'))
                        {
                            $Cat = 'other'; foreach($K in $CategoryRx.Keys) { if($M.Value -match $CategoryRx[$K]) { $Cat = $K; break } }
                            Add-Count $Findings $Cat
                        }
                    }
                }
            }
        }
    }
    finally { $Reader.Dispose() }
}
## Stale memory records.
$MemDir = Join-Path $Root 'memory'
$Stale = [System.Collections.Generic.List[string]]::new()
if(Test-Path -LiteralPath $MemDir)
{
    foreach($M in Get-ChildItem $MemDir -Filter '*.md' | Where-Object Name -ne 'MEMORY.md')
    {
        $T = [IO.File]::ReadAllText($M.FullName)
        if($T -match '(?i)description:.*\b(pending|in progress|implementing|approved)\b') { $Stale.Add("$($M.Name): description still says pending/in progress") }
        foreach($P in [regex]::Matches($T, '[A-Za-z]:\\[^\s)`]+\\plans\\[^\s)`]+\.md')) { if(-not (Test-Path $P.Value)) { $Stale.Add("$($M.Name): plan file missing $($P.Value)") } }
    }
}
$R = [System.Collections.Generic.List[string]]::new()
$R.Add("# Retrospective: $Project (last $Days days, $($Files.Count) transcripts, $UserMsgs user messages, $Compactions compactions, $Unreadable unreadable lines skipped)")
$R.Add(''); $R.Add('## Repeated command shapes (top 40)'); foreach($K in ($Shapes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 40)) { $R.Add(('- {0,4}  `{1}`' -f $K.Value, $K.Key)) }
$R.Add(''); $R.Add('## Tool and skill use'); foreach($K in ($Tools.GetEnumerator() | Sort-Object Value -Descending)) { $R.Add(('- {0,5}  {1}' -f $K.Value, $K.Key)) }; foreach($K in ($Skills.GetEnumerator() | Sort-Object Value -Descending)) { $R.Add(('- skill {0,3}  {1}' -f $K.Value, $K.Key)) }
$R.Add(''); $R.Add("## User corrections ($($Corrections.Count))"); foreach($C in $Corrections | Select-Object -First 60) { $R.Add('- ' + ($C -replace '\s+', ' ')) }
$R.Add(''); $R.Add('## Review findings by category'); foreach($K in ($Findings.GetEnumerator() | Sort-Object Value -Descending)) { $R.Add(('- {0,4}  {1}' -f $K.Value, $K.Key)) }
$R.Add(''); $R.Add("## Test runs ($($Runs.Count) summaries)"); foreach($X in $Runs | Select-Object -Last 30) { $R.Add("- $X") }
$R.Add(''); $R.Add('## Most frequent failing tests'); foreach($K in ($FailNames.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15)) { $R.Add(('- {0,4}  {1}' -f $K.Value, $K.Key)) }
$R.Add(''); $R.Add("## Stale memory records ($($Stale.Count))"); foreach($S in $Stale) { $R.Add("- $S") }
[IO.File]::WriteAllLines($OutFile, $R, [Text.UTF8Encoding]::new($false))
Write-Host "report: $OutFile ($($R.Count) lines)"
