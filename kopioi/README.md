# Kopioitavat

Generalized copies of the course instructor's own Claude Code tools. Each folder is one tool: its files, a
`manifest.json` (files, install target under `%USERPROFILE%\.claude\`, prerequisites, hook) and, when it has one,
`hook.json`, the fragment to merge by hand into `%USERPROFILE%\.claude\settings.json`. The Finnish install and
uninstall steps are on the course pages (Moduuli 9 and Moduuli 10).

| Folder | What it is |
|---|---|
| `coding-style` | `coding-style.md` template and a global `CLAUDE.md` that imports it |
| `align-style`, `done-check`, `plan-review`, `review-intake`, `release` | Slash commands |
| `codex-plan-review` | Skill: a second review of a plan by the OpenAI Codex CLI |
| `retrospective` | Skill: mines a project's Claude Code history for repeated work and corrections |
| `optimize-testsuite` | Skill: measures a pytest suite and cuts proven overhead (pytest-only edition) |
| `routing` | Model routing: `/routing` command, rule, prices, three agents and a SessionStart hook |

Tested on Windows 11 with Claude Code 2.1.318, PowerShell 7.6.9 and Python 3.14.7 (pytest 9.2.0), November 2026.

Licence: MIT.
