# Coding style

How I want Claude Code to work with me, with the reason behind each rule. My global `CLAUDE.md` imports this file,
so every session reads it. A project's own `CLAUDE.md` adds to these rules or overrides them for that project.

## Workflow

- **Plan before code.** For anything non-trivial, explain the approach first: the options, a recommendation, the
  files it touches. Write code only after I say "proceed". *Why: a wrong approach found in the plan costs a minute;
  found in the code it costs an hour.*
- **Small steps.** One change, one check, then the next change. *Why: a small diff is easy to review and easy to undo.*
- **No guessing.** When a path, version, setting, credential or name is unknown, look it up in the repo or ask me.
  *Why: a confident guess looks exactly like a fact.*
- **Stay in scope.** Fix what was asked. No unrequested refactoring, renames or clean-ups. *Why: unrelated changes
  hide the real change in the diff.*

## Questions

- Ask instead of guessing. Put several independent questions in one round, each with a recommended answer first.
- Never answer your own question and carry on as if I had decided.
- Answer my direct questions in the reply, not only inside a plan or a file.

## Verification

- **Test first.** Every new behaviour and every confirmed bug gets a test that fails without the change. Run it, see it
  fail, then make it pass. *Why: a test that never failed may not test anything.*
- **Check before "done".** Before saying a change is finished, run the tests and the checks you can reach yourself and
  report what was run and what was not. Never write "verified" or "works" for something that was not run.
- **Test plan.** When something needs me (a login, hardware, a judgement by eye), give numbered steps with the exact
  commands and the expected result of each step.
- **Read before you call.** Read a function's definition before calling or changing it; never assume its parameters
  or what it returns.

## Git

- **Short commits.** One short line per commit message, in English, imperative: `Fix login timeout`,
  `Add CSV export`. One logical change per commit.
- **Commit and push are separate steps.** Push only when I ask or when the project's rules say so.
- **Never commit secrets:** passwords, API keys, tokens, `.env` files, private keys, customer data. If one gets
  tracked, stop and tell me; removing it from history is my decision.
- **Look before you overwrite.** Check what a file holds before deleting or replacing it; never force-push without
  asking.

## Code

- **Comments explain why, not what.** Add one only for a hidden constraint, a workaround or a surprising rule.
- **Never fail silently.** A failed read, request or parse is shown or allowed to surface; it is never swallowed or
  counted as success.
- **Minimal scope.** No feature flags, compatibility layers or abstractions the task does not need.

## Safety

- **No secrets in chat, plans, memory or commits.** Refer to where a secret lives (a file name, a vault entry), never
  to its value.
- **Ask before destructive actions:** deleting files, dropping data, changing permissions, anything that cannot be
  undone. Also ask before adding, removing or weakening a confirmation step.
- **Follow my organization's rules** on what data may be given to an AI service. When unsure, ask me first.

## Communication

- Short and direct: one or two sentences per update, no long summary at the end.
- No emoji.
