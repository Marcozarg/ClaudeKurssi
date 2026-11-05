---
description: Bump version, update CHANGELOG.md, commit and push a release
argument-hint: <patch|minor|major> "<change>" ["<change>" ...]
allowed-tools: Read, Edit, Glob, Grep, Bash(git *)
---

Generic release command for any project that tracks its version in a file and keeps a `CHANGELOG.md`. Commit and push
rules come from the Git section of `~/.claude/coding-style.md` and from the project's own CLAUDE.md.

Parse `$ARGUMENTS`: **bump** (`patch` | `minor` | `major`) and one or more
**changes** (each quoted string is one change). If either is missing, stop
and ask.

Run this as the last edit, after code review and /done-check fixes.

---

## Versioning rules

| Bump | When to use |
|---|---|
| `patch` | Bug fix, comment, typo, cosmetic, UX tweak that does not change behaviour |
| `minor` | Feature, behaviour change |
| `major` | Breaking change: API, protocol or file format |

If the bump type seems inconsistent with the description, say so before proceeding.

---

## Step 1 - Find the current version

Look for the version string in order of priority:
1. `package.json` -> `"version": "x.y.z"`
2. `pyproject.toml` -> `version = "x.y.z"`
3. A `VERSION` file containing only the semver string
4. A `__version__ = "x.y.z"` line in a `.py` file
5. A `<Version>x.y.z</Version>` element in a `.csproj`

If the project uses date versions or documents its own release procedure in CLAUDE.md, stop: that procedure applies.
If none is found, stop and ask the user where the version is defined.

Report: **Releasing `<project>` `<old>` -> `<new>`**

---

## Step 2 - Compute new version

Apply the bump:
- patch: increment Z (e.g. 1.2.3 -> 1.2.4)
- minor: increment Y, reset Z to 0 (e.g. 1.2.3 -> 1.3.0)
- major: increment X, reset Y and Z to 0 (e.g. 1.2.3 -> 2.0.0)

If the project uses a `V` prefix (e.g. `V2.3.1`), preserve it.

---

## Step 3 - Update the version source

Before editing, grep the repo for the old version string and update every other hard-coded copy of it too (docs, tests
that pin the version). Edit the file found in Step 1 to replace the old version string with the new one. That file is the
single source of truth - do not hardcode the version anywhere new.

---

## Step 4 - Update CHANGELOG.md

Find the project's `CHANGELOG.md` (it may sit next to the version source). Prepend a new entry immediately after the
first heading (or at the top if no heading exists), one line per change:

```
### Vx.y.z - YYYY-MM-DD
- <change>
- <change>
```

Use today's date. Do not modify existing entries.

---

## Step 5 - Commit and push

Stage only the files changed above (version source + CHANGELOG.md) plus the files of the change being released.
Never stage secrets.

```
git add <version-file> CHANGELOG.md
git commit -m "<Component> Vx.y.z: <summary of the changes>"
```

Push only when the user's rules (`~/.claude/coding-style.md` or the project's CLAUDE.md) say to push, and then only to
the project's own remote. Otherwise leave the commit local and say so. Commit and push are separate commands.

Leave out `<Component>` in a single-component project.

Report: old version -> new version, files changed, commit hash.
