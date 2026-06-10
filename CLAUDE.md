# ImportIQ — agent guide

Search mobile.de / AutoScout24 / AutoUncle for used cars, compute the full
Portuguese landed cost (ISV, transport, legalisation), and compare against the
PT market. See `README.md` for the stack and `PLAN.md` for the product spec.

## Task tracking — TODOs/ and DONE/ (READ THIS EVERY REQUEST)

This project tracks outstanding work as Markdown files in two folders at the repo
root. Treat them as the single source of truth for "what's left to do".

- **`TODOs/`** — one file per pending task.
- **`DONE/`** — completed tasks, moved here from `TODOs/`.

Follow these rules on every request:

1. **When the user asks "what's next" (or what's left / the backlog):** list the
   files in `TODOs/`. Read the relevant ones and summarise them, newest-first by
   the `created` date in the front-matter. If `TODOs/` is empty, say the backlog
   is clear.

2. **When work surfaces a follow-up** (something that should be done next but
   isn't being done now — a deferred fix, a known gap, a "TODO" you'd otherwise
   only mention in chat): **write a new file to `TODOs/`** using the template
   below. Do this proactively, then tell the user you logged it.

3. **When a task is completed:** **move its file from `TODOs/` to `DONE/`**
   (`git mv` if the repo is tracked, otherwise a plain move). Append a
   `completed:` date and a short outcome note to the file's front-matter/body.
   Do not delete task files — moving preserves history.

4. Keep file names descriptive and kebab-case, prefixed with the creation date
   for natural sorting: `YYYY-MM-DD-short-slug.md`
   (e.g. `2026-06-09-emission-standard-override.md`).

### Task file template

```markdown
---
title: <one-line title>
created: <YYYY-MM-DD>
status: todo            # todo | in-progress | done
priority: low | medium | high
---

## What
<what needs to happen>

## Why
<why it matters / context>

## Notes
<pointers: files, links, acceptance criteria>
```

When moving to `DONE/`, set `status: done` and add `completed: <YYYY-MM-DD>` plus
a one-line outcome under the body.
