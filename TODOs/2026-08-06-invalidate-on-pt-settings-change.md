---
title: Invalidate stored deals + the ranked-pool cache when PT comparison settings change
created: 2026-08-06
status: todo
priority: medium
---

## What

Changing a PT comparison setting (today: `pt_mileage_range_km`) should invalidate
the results computed under the old one:

- `deals` rows carry a `saving_eur` / `result_json` computed at ingest time; they
  keep the old benchmark until the next sweep or a manual `recomputeDeals` run.
- `searchListingsDirectPageComputed` caches the ranked+costed pool for 12h keyed
  by filters + sort + **cost**-config version — the PT settings aren't in the key.

## Why

The store is the default search path, so after tightening the mileage band the
user still sees verdicts (and the un-benchmarked ranking tier) from the old,
wider band — with no signal that they're stale. The cost-config version already
solved exactly this problem for transport/legalisation edits; PT settings need
the same treatment.

## Notes

- Mirror `costConfigVersion()` in `db.js`: add a `ptConfigVersion()` fingerprint
  over `getPtComparisonConfig()` + `getPtSourcesConfig()`, fold it into
  `computedCacheKey()` (`adapters/directSearch.js`) and into the deals row's
  `config_version`, so a change re-costs on the next ingest.
- `jobs/recomputeDeals.js` is the manual escape hatch meanwhile; the Settings
  page's "Clear cache" already drops `listings_cache`.
- Acceptance: change the mileage range → next search reflects it without a
  manual cache clear.
