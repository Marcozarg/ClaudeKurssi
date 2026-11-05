---
name: done-check
description: Pre-delivery verification before reporting a code change as finished - map every request point to a change, parse and test what changed, trace user-visible paths, grep for leftovers, apply the project's own checklist, and report what was and was NOT verified with a test plan. Run automatically before saying a code change is done, and when the user types /done-check.
---

Run before reporting a code change as finished, and before commit and push.

## Steps
1. **Request coverage:** list every point of the user's request (all of them, not just the last). Each maps to a change
   or an explicit "not done - why". For a ticket, re-read the ticket and its parent spec and make a checklist of every
   acceptance criterion and every UI behaviour it implies (open and close, empty, error and disabled states). Mark each
   item with the specific test that covers it or the manual check that was run; flag every item with neither as
   UNVERIFIED in the report.
2. **Build:** parse or compile every changed code file with the project's real toolchain (for example the PowerShell
   parser for .ps1 files, the compiler or linter for other languages).
3. **Tests:** run the tests that cover the changed code. Every new behaviour and confirmed bug has a test that fails
   without the change. A failing test is reported with its output, never hidden or re-run to see if it passes.
4. **Diff review:** for a change over about 50 lines, or one that touches storage, security or data formats, read the whole
   diff once more (or run a read-only review agent if the project has one) and fix confirmed problems before the final
   version bump.
5. **Trace:** for every user-visible change, follow the code path in the mode the user will actually test (first start on an
   empty environment, every language the UI has, the modes the project's CLAUDE.md names). A feature that is not
   reachable there is not done. For a screen change, look at a screenshot at desktop and phone width; a page that
   scrolls sideways is a bug.
6. **Leftovers:** Grep for old names, duplicate messages, debug output, texts or keys that no longer exist.
7. **Project items:** if the project has a checklist file (for example `.claude/checklists.md`), apply its "Before done"
   section, and its UI section when screen code or screen texts changed.
8. **Report** (short):
   - Done: what changed (one line per request point); for a ticket, the checklist from step 1 with its test or
     check per item and the UNVERIFIED ones.
   - I ran: which parse, tests, traces and test-plan steps ran, with results. Run every step you can reach first.
   - For you / NOT verified: only what needs the user (hardware, their login or a secret, a judgement by eye, a
     decision) or the real environment. A runnable check is never listed here. Never write "verified" or "works" for
     anything that was not actually run.
   - Test plan: numbered steps with exact copy-paste commands (full paths), expected result per step, cleanup, then the
     concrete next step.
