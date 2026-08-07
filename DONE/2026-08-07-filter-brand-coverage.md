---
title: Filter brand list covers the whole catalog (Porsche, Ferrari, Alpina, …)
created: 2026-08-07
completed: 2026-08-07
status: done
priority: medium
---

## What
The Brand dropdown offered only 12 marques (a hardcoded `POPULAR_BRANDS` map in
`adapters/brands.js`), so Porsche and every other premium/niche brand was
unfilterable even though the matcher already knew them. Make the filter list
derive from the curated vehicle catalog, and add the marques the curated seed was
missing so filter list and matcher can't drift apart.

## Why
The filter list was a second, much smaller source of truth for "what brands
exist". Anything absent from it was invisible in the UI regardless of what the
scrapers and the matcher could actually handle.

## Notes
- `adapters/brands.js`: `FILTER_BRANDS` is now derived from `VEHICLE_CATALOG`
  (56 brands) and feeds `GET /api/brands`. The ingest sweep keeps its own short
  `SWEEP_BRANDS` list — every brand there costs one more 400-card sweep per run.
- Curated only, deliberately: the generated catalog's Wikidata half carries
  pre-war noise ("Peugeot Type 172") that would bury the real picks.
- Added to `data/vehicleCatalog.js`: Abarth, Alpina, Alpine, Aston Martin,
  Bentley, BYD, Ferrari, Genesis, Infiniti, Lada, Lamborghini, Lancia, Lotus,
  Maserati, Maybach, McLaren, MG, Rolls-Royce, Saab, SsangYong, Subaru.
- `vehicleCatalog.loader.js` now overlays the curated seed onto the generated
  catalog at load time, so a curated addition reaches the matcher without
  re-running `catalog:build` (which needs network access).
- Brand equality is now accent/separator-insensitive (`brandKey`,
  `brandSpellings` in `adapters/normalize.js`), used by the defensive
  post-filter and the deals-store SQL — the catalog spells it "Škoda" while
  AutoScout24 stores "Skoda", and an exact match dropped every result.
- Tests: `test/filterBrands.test.js`, plus a spelling case in
  `test/dealsStore.test.js`.
