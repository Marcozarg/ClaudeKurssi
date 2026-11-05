---
name: align-style
description: Align the current project with your coding style (~/.claude/coding-style.md) - find conflicts, duplicates of global rules, stale facts and missing pieces in its CLAUDE.md, AGENTS.md, git files and .claude folder, ask about each decision, plan and implement. Use when the user types /align-style or asks to bring a project in line with the coding style.
---

Align this project with the coding style in `~/.claude/coding-style.md`.

1. Read `~/.claude/coding-style.md` (all of it). If it does not exist, stop and tell the user to install it first.
2. Compare this project against it: CLAUDE.md, AGENTS.md, .gitignore, .gitattributes, and the project's `.claude` folder
   (settings.json, commands, skills, agents). List every conflict, duplicate of a global rule, stale fact (check versions,
   paths and files on disk) and missing piece, with file:line.
3. Check the repo's visibility (`gh repo view`) before proposing to track CLAUDE.md or AGENTS.md, and scan both for IPs,
   hostnames, personal paths and secrets first.
4. Ask the user about every decision (several independent questions in one round, recommended answer first), then write the
   plan. Wait for approval.
5. Implement, run /done-check, and commit per the project's rules (see the Git section of the coding style).
