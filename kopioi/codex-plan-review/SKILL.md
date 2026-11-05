---
name: codex-plan-review
description: Send an implementation plan to Codex (gpt-6-astra, medium effort, read-only) for an independent review before it is implemented for the first time, then verify the findings against the code, fix confirmed plan errors and ask the user about the design choices. Use when a plan is ready to implement for the first time (before the plan is shown for approval), or when the user asks for a Codex review of a plan.
---

# codex-plan-review

After any plan is ready for the first time, send it to a Codex review and apply the results to the plan; ask the user where
needed. Skip Codex when its usage is spent. Later rounds only when the user asks.

Prerequisite: the OpenAI Codex CLI (`codex`) on PATH and signed in (`npm install -g @openai/codex`, then `codex login`).

## Steps

1. **Plan ready** (questions answered, /plan-review done, plan file written). Tell the user in one line that the plan is going to Codex.
2. **Run the review in the background** from the project folder (it takes minutes; the plan file and the repo are read, nothing is changed):
   ```
   pwsh -NoProfile -File "$HOME/.claude/skills/codex-plan-review/codex-review.ps1" -PlanPath <plan file> -OutFile <temp folder>/codex-review-<plan name>.md
   ```
   - The working folder is the git root of the current folder; pass `-Root <folder>` to change it.
   - Run it in the background with a long timeout (60 min). Exit 0 = result written, 1 = `codex` missing from PATH, 2 = Codex failed or
     the result is empty (log next to the output file). Exit 2 whose final Codex error in the log explicitly says the account usage or quota is
     exhausted: say so in one line and continue without Codex, no retry (text quoted from the plan or a review does not count).
     Exit 1, a temporary rate limit, a context-length limit, an auth or network error, a missing log, an empty result or anything
     ambiguous: tell the user with the log line and ask whether to continue without the Codex review.
3. **Show Codex's response to the user first**: when the run returns plan findings or changes, put the whole
   response from the output file on screen in the reply, unedited (a quoted block), before any verdict.
4. **Process the result like /review-intake**: verify every finding against the code and the rules; confirmed plan errors are fixed in
   the plan file directly; wrong findings get a one-line reason.
5. **Design choices** Codex raised (and findings that change behaviour) go to the user as questions, recommendation
   first; independent ones in one round. Update the plan with each answer.
6. **Re-run /plan-review** on the updated plan, then show it for approval. In the approval message, include a short verdict table
   (finding, verdict, what changed in the plan).
7. Delete the output file when the plan is approved (the plan file holds the outcome).

## Notes

- Defaults: model `gpt-6-astra`, effort `medium`. Override `-Model` / `-Effort` only when the user asks.
- Codex reads the working folder's `AGENTS.md` (which may point to `CLAUDE.md`), so it applies the project's rules.
- The review costs Codex usage: never for small fixes or one-line changes.
