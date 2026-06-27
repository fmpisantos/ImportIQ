---
title: Fan out the batch deal-sweep across brand/price segments
created: 2026-06-27
status: done
completed: 2026-06-27
priority: medium
---

> Outcome: Default `sweepQueries` now fans out across 5 market-wide price bands +
> 12 popular brands (17 segments) instead of one `[{}]` query. `resolveSweepQueries`
> already crosses these with the day's rotated sorts (34 searches/run) and
> `runIngest`'s `seen` set dedupes overlap, so no orchestrator change was needed.
> Added `SWEEP_PRICE_BANDS` + `buildDefaultSweepQueries()` in config.js (built
> from `POPULAR_BRANDS`). `INGEST_SWEEP_QUERIES` still overrides. Verified live:
> the `{priceMin:60000}` band alone exposes 62,172 cars the old cheapest-first
> broad sweep could never reach in its first 400. All tests pass (182/185; 3
> pre-existing settingsRoutes failures unrelated). Dedup-by-content_key NOT done
> — identical-spec cars from different sellers are legitimately distinct, so
> blind dedup would hide real inventory; left as-is.

## What
Replace the single unfiltered batch sweep (`INGEST_SWEEP_QUERIES` default `[{}]`)
with a segmented set of queries — e.g. one per popular brand, and/or per price
band — so the daily `deals` store covers far more than the same extreme windows.

## Why
AutoScout24 hard-caps any search at 20 pages / 400 cards. A single broad query
can therefore only ever reach ~2,400 cars total (the extremes of the 6 sort
orders), re-read on a 3-day cycle. This was the root cause of "always the same
cars" in the **store** path. The live path was fixed separately (see
DONE/2026-06-27-paginated-live-search.md) by paginating per request, but the
batch-filled store still needs segmented sweeps to broaden its own coverage.

## Notes
- `INGEST_SWEEP_QUERIES` already exists (config.js `getIngestConfig`) — a JSON
  array of filter objects. Just unset today.
- Reuse `adapters/brands.js` POPULAR_BRANDS for a per-brand fan-out; consider
  crossing with price bands (e.g. <15k / 15-30k / 30-50k / >50k).
- Watch per-run cost: more queries × `sortsPerRun` × detail fetches. May need to
  raise `INGEST_MAX_DETAIL_FETCHES` / lower `sortsPerRun`, or rotate which
  segments run each day (like SWEEP_SORTS rotates by day index).
- Also seen during the investigation: 15 duplicate `content_key` rows in the
  UI-visible store — consider deduping by `content_key` in `getDealsPage` or at
  upsert time.
