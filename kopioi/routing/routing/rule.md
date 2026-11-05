# Model routing (on)

You stay the planner; hand suitable work to a cheaper agent when that costs less than doing it inline.
Delegation pays only while the agent's model is cheaper than the session's: in a session on Sonnet, skip `implementer`
and the `model: sonnet` overrides; `scout` and `runner` on Haiku still pay.

| Agent | Model / effort | Delegate |
|---|---|---|
| `scout` | Haiku / low | A search across many files or an unknown location. It returns paths and line numbers. |
| `runner` | Haiku / low | Running tests, builds or checks whose output is long. It returns failures verbatim. |
| `implementer` | Sonnet / medium | One well-specified ticket with its tests. Brief it with the goal, the files, the acceptance check and what is ruled out. |

Reviewers a skill starts as sub-agents (the Standards and Spec reviewers of `mattpocock-skills:code-review`) run with `model: sonnet`.
You aggregate their reports.

## With mattpocock skills

| Skill step | Route |
|---|---|
| `implement`, a ticket with nothing left to ask the user and its seams and files given by the ticket or by existing code (a page from an approved mockup, a new parser label) | `implementer` does the whole test-first loop. Brief it with the ticket text, the files, the seams, the test command, the answers the user already gave and what is ruled out. |
| `implement`, any other ticket; `diagnosing-bugs` | Main session. Ask the user first; a ticket that becomes mechanical after the answers may then go to `implementer`. |
| A fact from the code for `grilling`, `to-spec`, `to-tickets`, `triage` or plan mode | `scout`. Where plan mode requires `Explore`, start it with `model: haiku`. |
| The background agent of `research`; the codebase walk of `improve-codebase-architecture` | `model: sonnet`. |
| The design-it-twice agents of `codebase-design`; the `Plan` agent | Main model. |

After `implementer` returns, nothing is committed yet. Check its diff and that a new test fails without its change.
Then run `mattpocock-skills:code-review` on the working tree: give both reviewers the ticket and the whole change against the commit
the work started from, added files included (`git status --short`, `git diff <start>`, and each new file), since
`git diff <start>...HEAD` is empty before the commit. Then run your own final check of the change, and commit only when the user has asked.

## Everything else

The table above decides for the skill steps it names. For anything else, stay inline when the work is a few tool
calls or a lookup whose place you already know.
Planning, grilling, design, hard debugging, an inline review and the final check always stay in the main session.

Check every delegated result before using it. When it fails the check:

1. Redo it once, one tier up: `scout` or `runner` again with `model: sonnet`; a failed `implementer` ticket or reviewer report you finish yourself.
2. Say in the reply that it was escalated.
3. Log it:
   `pwsh -NoProfile -File "$HOME/.claude/routing/routing.ps1" log -Agent <agent> -Model <model> -Task "<what was asked>" -Problem "<what went wrong>"`

The user turns this off with `/routing off`; from then on none of this applies in the session.
