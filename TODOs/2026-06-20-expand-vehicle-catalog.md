---
title: Vehicle catalog — refresh cadence & residual Wikidata noise
created: 2026-06-20
status: todo
priority: low
---

## What
The fuzzy matcher's catalog is now built from public datasets by
`scripts/build-vehicle-catalog.mjs` (`npm run catalog:build`) into
`server/src/data/vehicleCatalog.generated.json` (committed; seeded into SQLite by
`db.js`). Two follow-ups remain:

1. **Refresh cadence.** Re-run `catalog:build` periodically (e.g. yearly, or when
   new models launch) so 2010+ coverage stays current. Optionally wire it into the
   existing job scheduler in `server/src/index.js` like the ISV-table refresh.
2. **Residual Wikidata historic noise.** Deep-history European marques sourced
   from Wikidata (Peugeot, Renault, Škoda, Citroën) still carry some legacy
   variants ("205 GTI", "Clio V6 Renault Sport", "120 GLS") because Wikidata's
   production dates are ~90% empty and can't be filtered by year. This does NOT
   hurt real queries (modern names dominate and resolve correctly) but bloats
   those brands' lists. Tighten the cleanup heuristics if it becomes an issue.

## Why
No single free/public dataset is both European-complete AND recency-accurate:
the US year-indexed sets (abhionlyone, vPIC, back4app) omit Opel/Peugeot/Citroën/
Škoda/SEAT/Dacia/Renault entirely; Wikidata covers them but lacks usable dates.
The build script is the hybrid that reconciles them — see its header comment for
the full rationale. Completeness of 2010+ models is achieved; the open items are
freshness and tidiness, not correctness.

## Notes
- Build: `npm run catalog:build` (root). Output is committed so the app runs
  without re-building; `db.js` replaces the `vehicle_catalog` table when the
  content hash changes.
- Sources: US dataset `github.com/abhionlyone/us-car-models-data` (per-year CSVs,
  2010+), Wikidata SPARQL (`query.wikidata.org`), curated overlay
  `server/src/data/vehicleCatalog.js` (aliases + submodels + EU-only models).
- `SsangYong` currently fails Wikidata label resolution (renamed "KG Mobility");
  add it to the curated seed or a QID override in the script if needed.
- Matcher: `server/src/engine/vehicleMatch.js`; API `GET /api/vehicles/match`;
  UI test bench = the **Matcher** tab. Tests: `test/vehicleMatch.test.js`,
  `test/vehicleCatalog.test.js`.
