## Sends an implementation plan to Codex (OpenAI Codex CLI) for an independent review before it is implemented.
## Codex reads the repository read-only (read-only sandbox) and writes its findings to -OutFile.
## Exit 0 = result written, 1 = codex not found on PATH, 2 = Codex failed or the result is empty (log: -OutFile + ".log").
## Working folder: -Root, otherwise the git root of the current folder, otherwise the current folder.
param(
    [Parameter(Mandatory = $true)][string]$PlanPath,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Model = 'gpt-6-astra',
    [string]$Effort = 'medium',
    [string]$Root = ''
)
$ErrorActionPreference = 'Stop'
$Cmd = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $Cmd)
{
    [Console]::Error.WriteLine('Codex CLI (codex) was not found on PATH. Install OpenAI Codex CLI (npm install -g @openai/codex), sign in once with: codex login')
    exit 1
}
if(-not $Root)
{
    $Root = (Get-Location).Path
    try { $Top = & git -C $Root rev-parse --show-toplevel 2>$null; if($LASTEXITCODE -eq 0 -and $Top) { $Root = [System.IO.Path]::GetFullPath([string]$Top) } } catch { }
}
Write-Host "Working folder $Root"
$Plan = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $PlanPath).Path)
$Prompt = @"
You are an independent reviewer. Review the implementation plan below for this repository BEFORE it is implemented.

Read first, when present: AGENTS.md and CLAUDE.md (project rules), .claude/checklists.md (section "## Plan review"), and the design docs that
CLAUDE.md or the plan points to for the areas the plan touches. Then check the plan against the actual code in this repository (quote file:line).

Look for: wrong assumptions about the existing code, security and trust-boundary gaps (keys, credentials, elevation, untrusted input),
lifecycle gaps (first install on an empty system, upgrade, interrupted run, rerun, rollback), compatibility and deploy-order problems,
violations of the project's hard rules, missing tests, and anything the plan claims that the code does not support.

Output (Markdown, in English):
1. Findings ranked [P1] (wrong behaviour, security or data risk), [P2] (gap or unclear contract), [P3] (nit). For each: the claim, file:line
   evidence, a concrete failure scenario and a concrete fix.
2. Decisions the plan owner must make (design choices, not bugs), each with options and your recommendation.
3. What you did NOT check.
Do not edit any file, do not run anything against production systems, do not publish, commit or push.

<plan>
$Plan
</plan>
"@
$Log = "$OutFile.log"
$Dir = Split-Path -Parent $OutFile
if($Dir -and -not (Test-Path -LiteralPath $Dir)) { [void](New-Item -ItemType Directory -Path $Dir -Force) }
if(Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
$Sw = [System.Diagnostics.Stopwatch]::StartNew()
# Codex writes progress to stderr, which would abort the script under Stop, so the native call runs under Continue.
$ErrorActionPreference = 'Continue'
$Prompt | & $Cmd.Source exec -m $Model -c "model_reasoning_effort=`"$Effort`"" -s read-only -C $Root --skip-git-repo-check -o $OutFile - 2>&1 | ForEach-Object { if($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } } | Out-File -LiteralPath $Log -Encoding utf8
$Code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$Sw.Stop()
if($Code -ne 0 -or -not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -eq 0)
{
    [Console]::Error.WriteLine("Codex failed (exit $Code, $([math]::Round($Sw.Elapsed.TotalMinutes, 1)) min) - log: $Log")
    exit 2
}
Write-Host "Codex review ($Model, $Effort, $([math]::Round($Sw.Elapsed.TotalMinutes, 1)) min): $OutFile" -ForegroundColor Green
Write-Host '===== Codex response ====='
Write-Host ([System.IO.File]::ReadAllText($OutFile))
exit 0
