---
name: plan-review
description: Self-review a plan before it is shown for approval - answer a fixed checklist (trust boundary, lifecycle, compatibility, automation, environment facts, failure handling, destructive actions, simplicity, scope, verification) plus the project's own plan items, write a Self-review section into the plan file and turn every gap into a question. Use when the user types /plan-review, or after the plan is drafted and before it is shown for approval.
---

Review the current plan before it is shown for approval.

## Procedure
1. Read the plan file. Answer every item below for THIS plan - check the code or the environment facts where an answer
   depends on them (CLAUDE.md, the repo, the machine), do not answer from memory.
2. If the project has a checklist file (for example `.claude/checklists.md`), answer its "Plan review" items too, and its
   UI items for plans that change screens or texts.
3. Write a `## Self-review` section at the end of the plan file: one line per item, `OK - <why>` or `GAP - <what>`.
   Items that do not apply: `n/a`.
4. Every GAP becomes a question to the user (independent ones in one round, recommended answer first) or a plan fix when
   the answer is obvious from the code. Update the plan with the answers before showing it for approval.

## Checklist
- **Trust boundary:** who can write each input the plan reads (files, directories, databases, packages, other tools)? Untrusted input
  validated? Secrets and keys stay where they belong? Every security claim no broader than what the code enforces?
- **Lifecycle:** first install on a fresh environment, upgrade from old versions, interrupted or partial runs, rerun
  (idempotent?), rollback, cancel at every confirmation. Cached or derived results invalidated when their source changes,
  and cleared only when verified, not when merely attempted.
- **Compatibility:** old and new versions side by side, mixed deployments, publish or deploy order.
- **Automate:** list every manual step the plan leaves to the user - can the script do it? Derive values from
  the environment (existing installation, machine name, config) instead of asking.
- **Environment facts:** hosts, rights, server editions, who creates what - taken from CLAUDE.md or the user, never assumed.
- **Failure handling:** unavailable dependencies (network share, database, mail, remote host) - retry, show it on screen,
  stop; no silent hang, no slow start.
- **Destructive actions:** anything that deletes, overwrites or removes a confirmation gate -> ask the user explicitly.
- **Simplicity:** fewer folders, steps, settings and screens for the user; no settings for things that should always
  happen.
- **Scope:** only what was asked; other files and scripts are reference-only; answers to the user's direct questions are
  stated in chat, not only in the plan.
- **Verification:** the plan names how each change is tested and what only the real environment can show.
