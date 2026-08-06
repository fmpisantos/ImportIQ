---
title: Make the PT comparison year window configurable (like the mileage range)
created: 2026-08-05
status: todo
priority: low
---

## What

Add a Settings field for the PT comparison **year** tolerance, mirroring the
mileage range shipped on 2026-08-05 (`pt_mileage_range_km`). Today the year
window is hardcoded at ±1 in `comparisonCriteria()`
(`server/src/adapters/ptMarketClient.js`).

## Why

The mileage band is now user-tunable, so a user tightening the benchmark hits an
asymmetry: they can say "only cars within ±10 000 km" but not "only cars from the
same model year". For fast-depreciating or facelifted models the year window
matters as much as mileage.

## Notes

- The plumbing already exists: `comparisonCriteria(listing, opts)` takes an opts
  object, `getComparison()` (`adapters/ptmarket.js`) resolves config once at the
  I/O boundary and threads it to every source. Add `yearToleranceYears` to
  `getPtComparisonConfig()` in `config.js`, the FIELDS catalogue in
  `routes/settings.js`, and the PT card in `web/src/pages/SettingsPage.jsx`.
- Same trade-off warning applies: tighter window → smaller sample → more
  comparisons fall under `MIN_RELIABLE_SAMPLE` (3) and withhold the verdict.
