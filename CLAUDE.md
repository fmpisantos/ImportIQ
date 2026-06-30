# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ImportIQ searches mobile.de / AutoScout24 / AutoUncle for used cars, computes the
full Portuguese landed cost (ISV, transport, legalisation), and compares against
the PT market. See `README.md` for the stack and `PLAN.md` for the product spec.

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

## Commands

Run from the repo root (npm workspaces: `server` + `web`).

```bash
npm install          # installs both workspaces
npm run dev          # backend on :3001, frontend on :5173 (Vite proxies /api → :3001)
npm test             # server unit tests (node --test)
npm run build        # production build of the web app
npm start            # run the API alone (node src/index.js)
```

Tests use the built-in Node test runner (`node --test`), no framework. To run a
single file or filter by name, run from `server/`:

```bash
cd server
node --test test/isv.test.js                 # one file
node --test --test-name-pattern "diesel"     # by test name
```

Requires Node ≥ 20. `npm install` rebuilds `better-sqlite3` (native module).

## Architecture

Two workspaces. The backend is the substance; the frontend is a thin React SPA
over the REST API.

### Request flow (`POST /api/search`)

`routes/search.js` orchestrates one bot run (PLAN.md §9):

1. `buildConfigView()` (`db.js`) loads cost config once per run.
2. `searchListings(filters)` (`adapters/source.js`) fetches normalised listings.
3. Per listing: `computeLandedCost()` then `attachComparison()` with the PT
   comparison from `adapters/ptmarket.js`.

### Data-source dispatcher — the key seam

`adapters/source.js` is the single switch the rest of the app goes through, so
nothing else knows which source is live. `DATA_SOURCE` (resolved in `config.js`)
selects one of four modes:

- **`mock`** — deterministic sample data, no credentials.
- **`direct`** (default) — keyless live scraping: AutoScout24 search pages
  (`adapters/direct/autoscout24.js`, JSON embedded in `__NEXT_DATA__`) for
  listings, orchestrated by `adapters/directSearch.js`. PT comparison is
  multi-source — OLX.pt's open API (`adapters/direct/olxpt.js`) + Standvirtual
  (`adapters/direct/standvirtual.js`) merged in `adapters/direct/ptComparison.js`
  (`PT_SOURCES`, default `olx,standvirtual`). Recommended real-data path, and the
  default — keep `config.js` getDataSource() and the `routes/settings.js` field
  catalogue in sync if this changes.
- **`official`** — real mobile.de Search API (`adapters/mobilede.js`, B2B creds).
- **`apify`** — paid scraping of mobile.de / AutoScout24 / AutoUncle via Apify
  Store actors (`adapters/apifySearch.js` + `adapters/sites/*.js`).

Every adapter returns the **same normalised listing shape**; `adapters/normalize.js`
holds the shared I/O-free cleaners (localized prices, fuel/transmission labels,
"03/2019" dates) so each site adapter only describes *where* fields live. Apify
results pass through a **defensive post-filter** so loosely-honoured actor params
never leak non-matching listings.

### Config resolution — Settings UI overrides env

`config.js` resolves every setting in priority order **Settings UI (SQLite) →
`.env` → built-in default**, read fresh per request (no restart needed). The
Settings page writes `runtime.*` rows into `active_settings`; `getRuntimeSettings()`
strips the prefix and `config.js` layers them over env. So `DATA_SOURCE` and all
credentials can be changed from the browser.

### ISV engine — pure & deterministic

`engine/isv.js` + `engine/isvTables.js` compute ISV from the official OE2025/2026
tables — no I/O, no config dependency. `engine/landedCost.js` composes the total:

```
Total landed cost = German price + ISV + VAT* + Transport + Legalisation fees
```

`VAT*` (`engine/vat.js`) is 23% IVA added **only** for a "new means of transport"
(≤6 months or ≤6,000 km); when unconfirmable from the year alone it's flagged
"suspect" and not added. The PT comparison yields a robust `marketValueEur`
(mileage regression → median → mean); `attachComparison` takes the verdict
against it and, with a configured resale haircut, also reports the expected
resale margin. `engine/priceSanity.js` flags implausibly-low German prices.

**Completeness invariant (load-bearing):** every component must resolve to a real
computed/configured value. If a required value is missing — no CO₂/displacement
on the listing, no active transport method, no enabled legalisation fee — the
result is flagged `incomplete` with `missingConfig` listed, and `totalLandedCostEur`
is `null`. Never fill a gap with an estimate; that defeats the product's purpose.
IUC (`engine/iuc.js`) is an annual figure shown separately, never added to the total.

### Config store (SQLite, `db.js`)

`better-sqlite3` at `server/data/importiq.db` (override with `IMPORTIQ_DB`).
Tables: `cost_config` (editable transport/legalisation amounts), `active_settings`
(active transport method + `runtime.*` overrides), plus three caches
(`pt_market_cache`, `refdata_cache`, `listings_cache`). Schema is created and
seeded idempotently on first `getDb()` — seeds use `INSERT OR IGNORE` so user
edits are never clobbered. Seed rows live in `config/seed.js` (placeholders — the
user fills real values on the Config page).

### Frontend (`web/`)

React + Vite SPA, three routes (`App.jsx`): Search, Configuration, Settings.
`web/src/api.js` calls the backend via relative `/api` URLs (proxied in dev).

## Conventions & gotchas

- ESM throughout (`"type": "module"`); use `.js` extensions in imports.
- ISV tables are statutory — change once a year per OE, never estimate them.
- Diesel ISV tables in `isvTables.js` currently mirror gasoline as a placeholder
  (see `TODOs/`). Don't trust diesel results until replaced.
- Emission standard (WLTP/NEDC) is inferred from registration year (2019+ ⇒ WLTP)
  and flagged `emissionStandardInferred`; a UI override is a known gap.
- PT official read-access (OLX/Standvirtual) for *searching other sellers* is
  unverified — see the README caveat before relying on `official` PT data.
- Real API calls (live mobile.de / PT) are unverified pending credentials; the
  mapping/averaging logic is covered by fixture tests in `server/test/`.
