---
name: review-intake
description: Process an external review the user pastes back (code review or plan review) - verify every finding against the code, fix confirmed bugs, ask about the rest, report a verdict table. Use when the user pastes review findings such as "Check these", "Fix these", "Found N issues", "[P1] ...", "I would revise the plan", or asks whether review points are relevant.
---

The user has pasted review findings. Handle them with this procedure.

## 1. Classify
- **Code review** (findings about delivered code) or **plan review** (findings about a plan not yet implemented).
- If the user asks for a plan ("Plan for fixes", "Make plan for these", "Are these relevant?"), enter plan mode and use the
  verdicts as the plan input instead of editing code.

## 2. Verify every finding
Number the findings as the reviewer did. For each one open the cited code (Grep for the symbol, Read a narrow range) and
check the reasoning against the current code, including callers and the paths the reviewer describes. Verdict:
- **Confirmed bug** - the failure scenario really happens.
- **Not a bug** - the reasoning does not hold (say why, with file:line).
- **Already fixed** - the current code no longer has it.
- **Behaviour change** - the "fix" would change what the user sees or how the program works.
- **Unclear** - cannot be decided from the code (needs the real environment); say what would decide it.

## 3a. Code review
- Fix every Confirmed bug directly, without asking about scope.
- Ask about each Not a bug / Behaviour change / Unclear item, one question per item (several in one round), recommended
  option first. Never silently skip one.
- Add a regression test for each confirmed bug when the project has tests.
- Run /done-check (tests, project rules), then raise the version once for the batch as the last edit if the project
  versions its releases: /release Steps 1-4 only (version source and CHANGELOG.md), never its Step 5.
- Do not commit or push until the user says so; say in the report that the changes wait, because the user tests review
  fixes first.

## 3b. Plan review
- Verify each point in the code (step 2), then ask about every resulting plan change separately (one question per
  change, independent ones in one round, recommendation first) before rewriting the plan. Rewrite the plan only after the answers.

## 4. Report
Start with the table, answer in chat (never only inside a plan file):

| # | Finding (short) | Verdict | Action | Test |
|---|---|---|---|---|

Then one line per open question or remaining risk.

## 5. Later rounds
When the same reviewer sends a new round, keep the previous table. A finding that comes back is **reopened**: say why the
first fix missed it (wrong path, partial fix, missing test) before fixing it again.
