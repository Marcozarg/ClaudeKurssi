---
name: optimize-testsuite
description: Measure a project's test suite, cut the overhead the measurements show, prove the suite is still stable and report before/after timings with evidence. Use when the user asks to speed up or optimize tests, or asks to act on a Test-suite advisory.
---

# optimize-testsuite

What this produces: before/after medians of comparable full runs, each change with the gain it showed before it was applied, a
stability result and an accepted baseline. The project changes only on approval, one change at a time.

`ts` below is `& $HOME\.claude\skills\optimize-testsuite\testsuite.ps1`, called from PowerShell (a list such as
`-RunnerArgs @('-q', '-n', '12')`). It writes one report per run to `$HOME\.claude\test-suite-metrics\<hash of root>\`:
`<id>.summary.json`, `<id>.cases.json` (per test: outcome and setup, call, teardown seconds) and `<id>.log`. Nothing is written
into the project. A run is stopped at `-TimeoutSec`, else at the larger of the default (600 s) and three
times the median of the last three runs. `measure` stops at the first run that is not clean.

## 1. Baseline

Take the full-suite command from the project's CLAUDE.md and run it; measuring changes nothing in the project.

- pytest from `<root>\.venv`: `ts measure -Root <root> -RunnerArgs '-q' -Repeat 3` (`-RunnerArgs` = what the project writes after
  `pytest`; a partial run adds `-Selection focused`). Without that venv, pass `-Python <path to python.exe>`; the
  interpreter needs pytest.

Done when three runs are `completed` with exit 0 and `ts status -Root <root>` shows a recent median. A failed or timed-out run is
a finding: go to step 6. A run is never repeated to get a pass.

## 2. Find the cost

From the newest `cases.json`: seconds per phase, per file, and the twenty slowest tests. Decide which shape it is: a few slow
tests, or overhead times N (median setup per test times the number of tests). For pytest read
`$HOME\.claude\skills\optimize-testsuite\python.md` first. Done when the three largest costs are named with their seconds.

## 3. Prototype

Measure what each candidate would save with the project untouched (python.md: outside plugin, process split). Done when every
candidate has a measured gain or is dropped.

## 4. Change

One AskUserQuestion, multi-select: every candidate with its measured gain, the marked test that keeps running the real path, and
the effect on isolation. Apply and measure the chosen ones one at a time. Speed comes from setup, fixtures, waits and shutdown;
every test case stays unless the user approves its removal by name. Build it by the project's own rules.

## 5. Stability

`ts measure -Root <root> -RunnerArgs <the same as step 1> -Repeat 5`, then one run in shuffled order (python.md) with
`-Selection focused`, so it never mixes into the full runs. Done when all five are `completed` with exit 0 and the same number of
tests as the baseline or more. A hang, timeout or failure goes to step 6, and no gain is reported from a suite that is not stable:
faster setup changes timing and exposes races that were always there.

## 6. Defect found

Stop optimizing. Show the evidence: the failing output or the stack dump in `<id>.log`. Ask with AskUserQuestion:

- fix it now with a regression test in its own commit (recommended), then start again at step 1 for a new baseline;
- or record it and end: report the evidence, the before numbers and "stability not reached", without accept-baseline. Done when
  that report is given.

## 7. Report and baseline

A before/after table (median, range, number of tests, seconds per phase), every test id present before and absent after (expected:
none), and what was not measured (CI, other machines). In the same AskUserQuestion as the report, ask to accept the new baseline,
then `ts accept-baseline -Root <root>` (it prints its three source runs); `-AllowFewerTests` only for removals the user approved.
Done when `ts status -Root <root>` shows the baseline accepted in this run.

## Notes

- A "Test-suite advisory" comes from the daily hook (`ts evaluate`), which only reads reports. It advises when the median of the
  last three comparable full runs is over 60 s, or 25 percent and 10 s over the baseline, once per project per day; an accepted
  baseline counts as advised at its median.
- Runs are comparable when the command, runner version, runtime and number of pytest-xdist workers match and the number of
  tests, and of skipped plus xfailed tests, differs by at most max(5, 5 percent). A run with no counted tests is not valid.
  `ts status -Root <root>` says why runs are not compared; a slow advisory says when the regression check is off.
