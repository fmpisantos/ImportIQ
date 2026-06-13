---
title: Fix PT market average — match comparable vehicles accurately
created: 2026-06-13
status: done
completed: 2026-06-13
priority: high
---

> **Outcome (2026-06-13):** Implemented all four phases in
> `adapters/direct/olxpt.js` + `adapters/ptMarketClient.js`. OLX queries now send
> the verified `filter_enum_combustivel` fuel slug and a model-*family* free-text
> query (`normalizeModelKey`: "116i"→"116"); results are defensively post-filtered
> on each offer's structured `params` (modelo/combustivel/gearbox, missing fields
> kept) and run through IQR outlier rejection (`rejectPriceOutliers`) before
> averaging. The comparison now carries `matchedCriteria` + `lowConfidence`
> (sample < 5), surfaced in the PT-market popover. The `filter_enum_modelo` slug
> filter was intentionally deferred to the post-filter (per-brand OLX model slugs
> are unverified and a wrong slug would zero out results). Covered by new tests
> in `test/olxpt.test.js` and `test/ptMarket.test.js`. The low German-price note
> below split into its own TODO.
>
> **Correction (2026-06-13):** the first pass shipped the logic but the BMW 116
> still showed €28,920 / 50 listings in the UI. Root cause: `getComparison()` in
> `adapters/ptmarket.js` serves a 24h `pt_market_cache` *before* calling the
> corrected fetch, and the payload shape changed (added `matchedCriteria` +
> `lowConfidence`) without bumping `CACHE_VERSION` — so pre-fix v3 rows kept
> being served. Fixed by bumping `CACHE_VERSION` 3 → 4 (invalidates old rows) and
> purging the existing cache. Re-verified live: BMW 116 (2013, petrol, manual) now
> averages €11,663 over 3 comparables, `lowConfidence: true`.

## What
The PT market average (`adapters/direct/olxpt.js` + `ptMarketClient.js`) is wildly
inflated because it averages **every** listing OLX returns for a loose free-text
`query=<model>` with no filtering. Example: BMW 116 (2013, petrol) showed a PT
average of €28,920 — the "comparables" included M4 (€50,990), 1M Coupé (€69,950),
Z4, X3, 320d, etc. A structured query returns 51 real 116s at €6,250–€15,950
(avg ≈ €10k).

## Why
Accurate PT average is the core value of the product. A wrong average makes the
landed-cost saving meaningless.

## Notes
Root causes:
1. Free-text `query` matches "116" anywhere in ad text (power "116 cv", mileage
   "116.000 km", price, phone). Should use OLX structured filters.
2. `summarise()` keeps only price/url/title and discards the structured `params`
   OLX returns per listing — so no post-filtering on model/fuel/transmission.
3. No outlier rejection.

OLX API findings (verified live 2026-06-13):
- Each item carries `params`: `modelo` {key,label}, `combustivel`
  (diesel|gasolina|plugin-hybrid|electrico), `gearbox` (manual|automatic),
  `engine_power` (cv), `engine_capacity` (cm³), `body_type`, `year`, `quilometros`.
- OLX accepts query filters `filter_enum_modelo[0]=`, `filter_enum_combustivel[0]=`,
  etc. NOTE: petrol enum key is `gasolina` (not `petrol`).

Plan:
- Phase 1: query with `filter_enum_modelo` + `filter_enum_combustivel` (fuel map
  Petrol→gasolina, Diesel→diesel, PHEV→plugin-hybrid, Electric→electrico). Add a
  model-key normalizer to strip fuel/trim suffix ("320d"→"320", "116i"→"116").
- Phase 2: defensive post-filter on returned `params` (model/fuel/transmission),
  mirroring `normalize.js#matchesFilters`. Items missing a field aren't dropped.
- Phase 3: outlier rejection (IQR / trimmed mean) in `summarise()`.
- Phase 4: surface real matched criteria in the popover; flag low confidence when
  post-filtered sample < 5.

Files: `server/src/adapters/direct/olxpt.js`, `server/src/adapters/ptMarketClient.js`,
tests `server/test/olxpt.test.js`, `server/test/ptMarket.test.js`.

Separate follow-up: German price of €4,590 for a 2013 BMW 116 is suspiciously low
(possible damage/parts listing or price-parse bug on the German adapter side).
