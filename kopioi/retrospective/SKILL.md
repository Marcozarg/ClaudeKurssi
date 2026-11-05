---
name: retrospective
description: Mine a project's Claude Code history (transcripts, plans, memory, review findings) for repeated manual work, corrections, brittle tests and stale records, and turn them into skills, hooks, rules and a cleanup list. Use when the user asks what could be made faster, more accurate or what is stale, or every few weeks of heavy work on a project.
---

# retrospective

What this produces: a short report with counts and evidence, then a plan (questions to the user, independent ones in one round) for the skills,
hooks, agents, test changes and deletions that follow. Nothing is deleted or created without the plan being approved.

## 1. Mine the history (script)

```
pwsh -NoProfile -File "$HOME/.claude/skills/retrospective/mine-transcripts.ps1" -Project <project folder name> [-Days 30] [-OutFile <temp folder>/retro.md]
```

`-Project` = the folder name under `~/.claude/projects/` (Claude Code names it after the project's path, with the separators
replaced by dashes). `-ProjectsDir` points the script at another projects folder. The script reads every
`*.jsonl` transcript newer than `-Days` and the memory folder, and writes a markdown report with:

- **Repeated commands by shape** (Bash/PowerShell calls with paths and numbers normalised): the top of this list is the skill or
  hook candidate; anything run by hand more than ~20 times is a script.
- **User corrections**: user messages containing "still", "again", "doesn't work", "don't want", "i dont", "broken", "wrong",
  "not what" - with the message text, so the pattern behind them can be named.
- **Review findings** pasted or produced by a reviewer (`[P1]`/`[P2]` lines) grouped by the category words in them (fail-open,
  compatibility, trust boundary, lifecycle, contract, race, UI, test).
- **Test runs**: every "N tests, N passed, N failed" summary and every pytest summary ("N passed, N failed in N s") with
  its duration; the most frequent failing test names (pytest's `FAILED tests/...::name` lines too).
- **Skill and tool usage**: which skills were invoked how often; plan edits and compaction counts.
- **Stale records**: memory files whose description says "pending"/"in progress" although a later memory records the outcome;
  memory lines pointing to plan files that no longer exist or hold a different plan (plan file names are reused per conversation);
  counts in memories that disagree with the repo (tests, versions).

## 2. Read with the questions

For each of the user's questions, answer from the counts, not from impressions:

- *Skills/agents*: what was done by hand repeatedly (top shapes), what needed the same reading every time (helper contracts, file
  ranges), what review classes kept coming back (an agent with that checklist).
- *Faster/more accurate methods*: what caused rework (encoding, whole-file reads and compactions, stale literal counts in tests,
  misread helpers), and the rule or hook that removes the class, not the instance.
- *Testing*: wall time and where it goes (sequential? database?), the tests that fail for reasons unrelated to the change, what is
  selected by memory instead of by impact.
- *Stale data*: memories superseded by docs, finished plans, snapshots and archives, settings text with old names, doc headers.

## 3. Plan it

Ask the user (independent questions in one round, recommendation first) about scope, where skills live, which
deletions are allowed, and the test-runner design. Before any deletion: a hash-verified zip of everything to be deleted plus an
inventory file, kept 30 days. Secrets (keys, ini files) never go into the zip. Then /plan-review, and implement.

## Notes

- Transcripts are large (tens of thousands of lines); the script streams them line by line and never loads one into the context.
  Do not Read a transcript directly.
