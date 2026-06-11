---
title: Automated tests for the search orchestrators (directSearch.js first)
created: 2026-06-11
status: todo
priority: high
---

## What
Add automated test coverage for the search orchestration layer. Primary target
is `server/src/adapters/directSearch.js` — the default live path — with
`apifySearch.js` covered second (its `searchSiteApify` is reused by the
mobile.de hybrid). Cover:

- **Post-filter integration** — listings that don't match the filters are
  dropped after mapping (`matchesFilters`).
- **Dedupe** — cross-source duplicates (brand+model+year+price+mileage)
  collapse to one (`dedupeListings`).
- **mobile.de hybrid gating** — no key saved → AS24-only search; key present →
  mobile.de joins; official credentials take precedence over an Apify token.
- **Partial failure** — mobile.de throwing still returns AS24 results
  (graceful degradation), and vice-versa; total failure raises an aggregated
  error, not a silent empty array.
- **Caching** — a second identical search reads `listings_cache` and does not
  re-fetch; the cache key normalises filter order (`fuelTypes` sorted).
- **CO₂ detail enrichment** — AS24 listings missing `co2GKm` get enriched from
  the (stubbed) detail page, and each enrichment is cached individually.

## Why
This is the orchestration layer that guarantees correctness (filtering, dedupe,
graceful degradation, polite caching). It has the most branching logic and zero
tests today — and since the direct-mode pivot it is the code every real search
runs through. Supersedes the 2026-06-10 "Apify aggregator tests" task, which
targeted only the now-secondary `apify` mode.

## Notes
- Stub the network layer (`fetch` for AS24/OLX, `runActor` for the mobile.de
  actor) via injection or module-mock so tests stay offline.
- Use an in-memory / temp SQLite db for the cache assertions, or stub
  `getCached`/`setCached`.
- Follow the existing `node:test` style in `server/test/`.
- Mapping-level tests already exist (`apifyAdapters.test.js`,
  `mobiledeMap.test.js`, `ptMarket.test.js`) — don't duplicate those.
