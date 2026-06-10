---
title: Automated tests for the Apify aggregator (apifySearch.js)
created: 2026-06-10
status: todo
priority: high
---

## What
Add automated test coverage for `server/src/adapters/apifySearch.js`. The
per-site builders/mappers and `normalize.js` are tested, but the aggregator
itself is not. Cover:

- **Post-filter integration** — listings that don't match the filters are
  dropped after mapping.
- **Dedupe** — cross-source duplicates (brand+model+year+price+mileage) collapse
  to one, first-source-wins.
- **`source` tagging** — every returned listing carries its site key.
- **Partial failure** — one site throwing still returns the others'
  results (`Promise.allSettled` path).
- **Total failure** — when every site fails, a single aggregated error is thrown
  (not a silent empty array).
- **Caching** — a second identical search reads `listings_cache` and does not
  re-invoke the actor.

## Why
This is the orchestration layer that guarantees correctness (filtering, dedupe,
graceful degradation). It has the most branching logic and zero tests today.

## Notes
- Stub `runActor` (inject or module-mock) so tests don't hit the network.
- Use an in-memory / temp SQLite db for the cache assertions, or stub
  `getCached`/`setCached`.
- Follow the existing `node:test` style in `server/test/`.
- Pair with `2026-06-10-validate-apify-actor-mappings.md` (that one is live-token
  verification; this one is offline automated coverage).
