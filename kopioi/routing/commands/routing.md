---
description: Turn model routing on or off, show its state, or show the cost report
argument-hint: <on|off|status|report [days]>
---

Run this and show its output:

```
pwsh -NoProfile -File "$HOME/.claude/routing/routing.ps1" $ARGUMENTS
```

- `on`: the output contains the routing rule. Follow it for the rest of this session.
- `off`: for the rest of this session stop delegating to `scout`, `runner` and `implementer`, and start the
  sub-agents of skills and of plan mode without a model override.
- `status` (also when no argument is given): report the state in one line.
- `report [days]` (default 14): show the tables as printed, then at most three sentences on what stands out: an
  agent with logged problems, an agent whose Saved $ is small or negative next to its Cost $, a skill whose
  main-session cost dominates, the most expensive model in a main session or an agent, or a difference in $/session between routing on
  and off. Suggest a change to an agent only when the numbers or the logged problems support it.

If the script fails, show the error. Do not work around it.
