---
title: PT comparison matches wrong cars — null model + coarse cache key cross-contaminate
created: 2026-06-14
status: done
completed: 2026-06-14
priority: high
---

> **Outcome (2026-06-14):** Fixed in order requested (cache → model → trust gate).
> (2) **Removed the PT cache entirely** — redundant now the deals store persists
> each comparison; `pt_market_cache` table dropped in `db.js` migrate,
> `getPtCacheTtlMs` removed from `config.js`, `getComparison` (`ptmarket.js`)
> dispatches fresh per call. This alone caps cross-contamination blast radius at
> one car. (1) **Model recovery** — `mapListing`/new `deriveModel` fall back to
> `vehicle.variant` (body-type words stripped) when `model`/`modelGroup` are empty
> (intermittent on stripped commercial-vehicle cards). (3) **Trust gate** —
> `getComparisonCombined` short-circuits (no fetch) to a `reliable:false`,
> empty comparison when the listing has no model; `finalizeComparison` stamps
> `reliable`/`unreliableReason`; `attachComparison` withholds the verdict for any
> `reliable:false` comparison (verdict → 'unknown'). Repair: new reusable
> `jobs/recomputeDeals.js` recomputed the 40 provably-contaminated rows in place
> (37 null-model network-free via the gate + 3 fuel/transmission mismatches with a
> live re-fetch); the Transit Courier's bogus "Save €42,900" is now 'unknown'.
> Tests: +7 (`autoscout24Map`, trust-gate in `ptComparison`, unreliable-suppression
> in `landedCost`); suite 134/137 (same 3 pre-existing `settingsRoutes` reds).
> DB backed up to `data/importiq.db.bak-20260614-162041` before the repair.
>
> **Follow-up not done:** the 466 "apparently clean" rows weren't force-recomputed
> (would cost ~500 live PT fetches for undetectable same-fuel/model collisions);
> they self-heal as deals change/age out, or run `node src/jobs/recomputeDeals.js
> --all` to purge everything.

## What

Fix the two compounding bugs that let a €22,690 **petrol Ford Transit Courier**
(a small van) be compared against €70–75k **diesel/automatic Ford Ranger Raptor**
pickups, yielding a bogus "Save €42,900 (+59.58%)" verdict. This is the core of
the product, so it's high priority.

Concrete case (still in the store):
`deal_key = autoscout24:510a3c10-f101-4b02-bbb5-45b55c47a39c`.

## Why (root cause — evidenced from the live DB)

**Bug 1 — `model` is null for commercial vehicles.**
`mapListing` (`adapters/direct/autoscout24.js`) reads
`model: pick(vehicle.make→ , vehicle.model, vehicle.modelGroup)`. For AS24
commercial-vehicle cards (Transit/Tourneo/Ducato "Kasten") those fields are
empty, so `model` stores `null`. **37 / 509 deals (7%)** have null model — almost
all vans. The card title isn't stored either; the model survives only in the URL
slug (`ford-transit-courier-kasten-...`).

With `model = null`:
- `olxpt.js` / `standvirtual.js` drop the model query/enum entirely → they search
  **all Fords** in the year ±1 / mileage ±20k window.
- `comparableMatches` (`ptMarketClient.js`) skips its model gate
  (`if (listing.model && c.model)`), so nothing narrows by model.
- Field-tolerant matching is correct for a comparable missing one field, but when
  the **subject's** model is missing it removes the gate for **every** comparable.

**Bug 2 — the PT cache key collapses distinct cars together.**
`cacheKey` (`adapters/ptmarket.js`) = `v{VER}|brand|model|year|mileageBucket`.
It omits **fuelType and transmission**, and with `model=null` it becomes
`v6|ford||2026|0`. **15 distinct Ford-2026 vans** (petrol/diesel/electric,
manual/auto, €21k–€50k) share that ONE key → one cached comparison. Whichever van
was ingested first wins; all others inherit it. The cached entry was a
Diesel/Automatic Ranger set (`matchedCriteria {model:null, fuelType:"Diesel",
transmission:"Automatic"}`, marketValue €72,000) — so the petrol Transit Courier
got it. (Even with a non-null model, two same-model/year/mileage-bucket cars of
different fuel/gearbox can still cross-contaminate — latent bug.)

## Notes / fix plan

- **A. Recover model (root cause).** In `mapListing`, fall back to deriving model
  from the card title / `vehicle.modelVersionInput` / the URL slug (strip brand +
  trailing `cat_*`/uuid) when `vehicle.model`/`modelGroup` are empty. Also store
  the card `title` on the listing for later matching/repair.
- **B. Make the cache key safe.** Add `fuelType` + `transmission` to `cacheKey`;
  when `model` is null, do not bucket by empty model — include a distinguishing
  token or skip caching so distinct cars never share a comparison. Bump
  `CACHE_VERSION` (→ v7) to drop the contaminated v6 rows.
- **C. Trust gate.** If `model` (or fuel) couldn't be established, mark the
  comparison low-confidence / refuse to emit a verdict rather than show a
  confident wrong saving. Consider requiring a model match before averaging.
- **D. Repair existing data.** Bumping the cache version + a re-ingest (or a
  recompute over stored `listing_json`) refreshes the 37 affected rows.
- Files: `adapters/direct/autoscout24.js` (mapListing), `adapters/ptmarket.js`
  (cacheKey, CACHE_VERSION), `adapters/ptMarketClient.js` (comparableMatches /
  low-confidence), maybe `adapters/direct/olxpt.js` + `standvirtual.js`.
- Tests: null-model listing → comparison flagged low-confidence / not matched on
  brand-only; cache key differs by fuel+transmission; two distinct null-model
  cars don't share a cache entry; model recovered from slug/title.
