---
title: Daily batch deal-ingestion pipeline (decouple search from live scraping)
created: 2026-06-13
status: done
completed: 2026-06-14
priority: high
---

> **Outcome (2026-06-14):** Implemented. New `deals` table + helpers in `db.js`
> (`upsertDeal`, `getDeal`, `getDealsPage`, `markDealsLastSeen`, `ageOutDeals`,
> `purgeOldSoldDeals`, `getDealsNeedingEnrichment`, `costConfigVersion`). New
> orchestrator `server/src/jobs/ingestDeals.js` (`npm run ingest`) with the
> backlog-drain → rotating-sort sweep → age-out flow, a per-run detail-fetch
> budget, and bounded concurrency. `enrichListing` now returns
> `{ listing, enrichStatus, missingFields }` distinguishing `enrich_pending`
> (retry) from `source_missing` (terminal); `tryEnrichListing`/`enrichOneCached`
> share the cached single-attempt path with the live route. `POST /api/search`
> reads the store by default with a `?live=1` escape hatch. Sweep sort orders
> (`SWEEP_SORTS`) + `getIngestConfig` added to `config.js`; optional in-process
> scheduler in `index.js` (env-gated, off by default). Tests: `dealsStore`,
> `enrichStatus`, `ingestDeals` (127/130 suite green; the 3 reds pre-existed in
> `settingsRoutes`).
>
> **Decisions taken (with the user):** cross-source dupes — keep both rows,
> `content_key` stored for deferred collapse; v1 sweep — broad unfiltered query
> across rotating sort orders; retention — sold rows purged after 90 days.
>
> **Follow-ups not done here:** frontend copy still says "Run Bot to query
> mobile.de" (search is now instant/DB-backed); no admin "recompute all" /
> "re-check terminals" button; cross-source collapse at read time deferred.

## What

Replace the current "scrape-and-compute on every UI search" model with a
**persistent, batch-filled deals store**. A scheduled job runs daily (and
on-demand), fetches listings from the sources, computes the full landed-cost +
PT-comparison verdict for each *new or changed* listing, and **upserts the
result into a new `deals` table**. The UI search then reads from that table
(plain SQL filter/sort/paginate) instead of triggering a live scrape.

The product behaviour the user sees (how good/bad a deal is) is unchanged —
only *where* the computed result comes from changes (DB, not live).

Crucially, the batch must **reach far more than 150 cars over time** and must
**not keep re-reading and re-computing the same 150**. The store accumulates
unique deals across runs; re-seeing a known unchanged car is cheap (skip), and
the daily sweep widens the net so coverage grows toward the full inventory.

## Why

Today `POST /api/search` fetches a pool of only `maxResults` (default **150**)
cards live, then fully computes just **one 50-car page**, and only enriches CO₂
for **25** of those (`DIRECT_ENRICH_LIMIT`). We are blind to every good deal
outside that thin, per-request window. Because each search re-scrapes the same
top-of-results cards, we burn request budget re-reading cars we've already seen
while never reaching deeper inventory.

Moving ingestion to a batch lets us:
- **Reach more cars** — sweep many queries / sort orders / pages over time and
  accumulate, instead of one 150-card slice per UI request.
- **Compute everything up front, and track what's still missing** — no
  25-CO₂-per-page enrich ceiling; the batch enriches across the whole pool (one
  polite attempt per car per run). A car whose enrich attempt fails is stored
  with a `enrich_status` flag and **retried on the next run**, not re-hammered in
  the same run (avoids IP blocks). A stored `incomplete` is never permanent until
  it's provably terminal — the source itself never published the field. See §9.
- **Make the UI instant** — search becomes a DB query over thousands of
  pre-scored deals, not a multi-second scrape.
- **Detect new deals as they appear** — daily diff is the foundation for the
  alerting in `2026-06-10-scheduler-and-email-alerts.md`.

## Design

### 1. New persistent table: `deals` (`db.js` migrate)

One row per **unique listing**, keyed by a stable identity, holding the full
computed result plus extracted columns for cheap SQL filter/sort:

```sql
CREATE TABLE IF NOT EXISTS deals (
  deal_key        TEXT PRIMARY KEY,   -- stable identity: `${source}:${id}` (see §3)
  source          TEXT NOT NULL,      -- autoscout24 | mobilede | olxpt | standvirtual
  listing_id      TEXT NOT NULL,      -- source-native id
  url             TEXT,
  -- extracted, indexed columns for filtering/sorting in the UI:
  brand           TEXT,
  model           TEXT,
  year            INTEGER,
  mileage_km      INTEGER,
  fuel_type       TEXT,
  country         TEXT,               -- DE | PT (ties into pt-listings TODO)
  price_eur       INTEGER,            -- German/source asking price
  total_landed_eur REAL,             -- null when incomplete
  market_value_eur REAL,
  saving_eur      REAL,               -- verdict saving vs PT market (null if incomplete)
  margin_eur      REAL,
  verdict         TEXT,               -- good_deal | fair | overpriced | incomplete …
  incomplete      INTEGER NOT NULL DEFAULT 0,
  -- enrichment tracking (§9) — so a failed detail-fetch is retried next run, not lost:
  enrich_status   TEXT NOT NULL DEFAULT 'pending', -- complete | enrich_pending | source_missing
  missing_fields  TEXT,               -- csv of required fields still null (audit/UI)
  enriched_at     INTEGER,            -- epoch ms of the last successful enrich attempt
  -- full payloads so the UI gets exactly today's computed object:
  listing_json    TEXT NOT NULL,      -- normalised + enriched listing
  result_json     TEXT NOT NULL,      -- computeLandedCost + attachComparison output
  -- lifecycle / freshness:
  price_hash      TEXT,               -- detect price changes → recompute (see §4)
  config_version  TEXT,               -- cost-config version this was computed under (§6)
  first_seen_at   INTEGER NOT NULL,   -- epoch ms — when we first ingested it
  last_seen_at    INTEGER NOT NULL,   -- epoch ms — last batch run that still saw it live
  computed_at     INTEGER NOT NULL,   -- when result_json was last (re)computed
  status          TEXT NOT NULL DEFAULT 'active'  -- active | stale | sold
);
CREATE INDEX IF NOT EXISTS idx_deals_verdict   ON deals(status, saving_eur DESC);
CREATE INDEX IF NOT EXISTS idx_deals_brand     ON deals(status, brand, model);
CREATE INDEX IF NOT EXISTS idx_deals_price      ON deals(status, price_eur);
-- pull the retry backlog cheaply at the start of each run (§9):
CREATE INDEX IF NOT EXISTS idx_deals_enrich     ON deals(enrich_status);
```

Add read/write helpers in `db.js`: `upsertDeal(row)`, `getDealsPage(filters,
sort, page, pageSize)`, `markDealsLastSeen(keys, now)`, `ageOutDeals(now,
staleAfterMs, soldAfterMs)`, and `getDealsNeedingEnrichment(limit)` (rows with
`enrich_status='enrich_pending'`, oldest `enriched_at`/`last_seen_at` first).

### 2. The batch job (`server/src/jobs/ingestDeals.js`, new)

Pseudo-flow per run:

```
config   = buildConfigView()               // once per run

// (a) FIRST drain the enrich backlog from prior runs — one fresh attempt each,
//     same politeness budget as a sweep. This is the across-run retry (§9).
for each deal in getDealsNeedingEnrichment(limit):       // enrich_status='enrich_pending'
  ingestOne(listingFrom(deal.listing_json), config, now) // re-attempt enrich → recompute/flag

// (b) THEN sweep for new/changed inventory.
queries  = resolveSweepQueries()           // §5 — the set of searches to cover
for each query (politely, bounded concurrency):
  pool   = searchListings(query)           // reuse adapters/source.js as-is
  for each listing in pool:
    seen.add(dealKey(listing))
    ingestOne(listing, config, now)

ageOutDeals(now): rows whose last_seen_at < now - STALE  → status='stale';
                  < now - SOLD → status='sold' (hidden from UI)

// One car → one polite enrich attempt → persist. Never retries in-run.
function ingestOne(listing, config, now):
  key      = dealKey(listing)              // §3
  existing = getDeal(key)
  if existing && existing.price_hash == priceHash(listing)
      && existing.config_version == config.version
      && existing.enrich_status != 'enrich_pending':   // don't skip a known-incomplete car
    markLastSeen(key, now)                 // unchanged & complete → touch freshness, NO recompute
    return
  { enriched, enrichStatus, missingFields } = tryEnrich(listing)  // §9 — ONE attempt
  if enrichStatus == 'enrich_pending':     // fetch failed → flag, retry next run, no recompute now
    upsertDeal(enrichPendingRow(listing, existing, missingFields, now))
    return
  result = attachComparison(computeLandedCost(enriched, config, ref),
                            await getComparison(enriched), {resaleHaircutPct})
  upsertDeal(rowFrom(enriched, result, enrichStatus, missingFields, config.version, now))
```

- Reuses **all existing engine + adapter code** unchanged — the batch is just a
  new orchestrator that persists instead of returning over HTTP.
- Politeness: keep `requestDelayMs`, bound concurrency (reuse `mapPool`), cap
  total fetches per run so we never hammer AS24 into a block.
- Idempotent + resumable: keyed upserts mean a re-run or crash mid-sweep is safe.

### 3. Stable dedupe identity (avoid duplicates) — IMPORTANT

The existing `dedupeListings` keys on **content**
(`brand|model|year|price|mileage`) — fine within one response, but it would
treat a *price drop on the same car* as a brand-new deal. For the persistent
store use a **stable per-listing id**: `deal_key = `${source}:${listing.id}``
(AS24 exposes `card.id`; each adapter already sets `listing.id`). Then:
- Same car re-seen → same `deal_key` → upsert, not insert. No duplicates.
- Across sources (AS24 vs mobile.de listing the same car) → keep the
  content-hash `dedupeListings` as a **secondary** collapse at *read* time, or
  store a `content_key` column and prefer the cheapest-landed duplicate. Decide
  during impl; primary key stays source-native id.

### 4. Don't re-read / re-compute the same cars

- **Skip-unchanged:** `price_hash = hash(price_eur)` (extend later to mileage/
  status). If a known `deal_key` returns with an unchanged hash, the same
  `config_version`, **and** `enrich_status != 'enrich_pending'`, **only bump
  `last_seen_at`** — no enrich, no PT fetch, no recompute. The enrich-pending
  guard means a car we failed to enrich before is *not* skipped: it gets its one
  retry attempt this run (see §9). This is what makes daily re-runs cheap while
  still letting the budget reach *new* inventory.
- **Reach deeper, not the same top cards (see §5):** vary sort order and
  paginate so each run pulls a different slice; accumulate across days.

### 5. Reaching MORE deals — the sweep strategy

A single `sort=standard` query always returns the same top cards, so naive
re-runs never progress. To widen coverage:

- **Multiple sort orders per query** — AS24 supports price asc/desc, age,
  mileage, newest (`sort=` / `desc=` params in `buildSearchUrl`). Each ordering
  surfaces a different ~400-card window (MAX_PAGES=20 × 20). Rotate orders
  across days so we eventually page through the whole result set.
- **Paginate to `MAX_PAGES`** in the batch (the UI no longer pays for this), and
  raise/keep `direct_max_results` high since cost is amortised, not per-request.
- **Query fan-out** — sweep a configured list of segments (popular brand/model,
  body type, price bands). Source the list from `POPULAR_BRANDS` +
  user-saved searches (ties into the scheduler TODO). Narrower queries dodge the
  20-page cap and reach cars a broad query buries.
- **Natural rotation** — inventory turns over daily; persisting across runs means
  new listings accrete into the store while sold ones age out (§2 `ageOutDeals`).

Document any coverage cap with a `log`/warn (no silent truncation): "swept N
queries, ingested X new, skipped Y unchanged, Z aged out."

### 6. Config-version invalidation (load-bearing)

Stored `total_landed_eur` goes stale when the user edits ISV/transport/
legalisation in the Config UI. Stamp each row with a `config_version` — a hash of
the cost-config rows + active transport method (derive in `buildConfigView`).
When the batch sees `existing.config_version != config.version`, it **recomputes**
even if the price is unchanged. Optionally a "recompute all" admin action / a
post-config-save trigger re-runs costing over stored `listing_json` without
re-scraping (cheap — no network).

### 7. Wire the UI search to the store (`routes/search.js`)

- `POST /api/search` → `getDealsPage(filters, sort, page, pageSize)` against
  `deals` (status='active'), returning the same response envelope (`results`,
  `total`, `totalPages`, …) so the frontend is unchanged.
- Keep a `?live=1` escape hatch (or a small "refresh this search now" button)
  that runs the old live path for a single query on demand.
- `annotateGermanPriceSanity` currently compares within a page — move it into the
  batch (compare each car against its stored same-model peers) so the flag is
  computed at ingest, or keep it as a read-time pass over the page.

### 8. Scheduling

- Run via `node src/jobs/ingestDeals.js` behind an npm script
  (`npm run ingest`), plus an in-process daily timer when the server runs
  long-lived. Make cadence configurable (`INGEST_CRON` / a Settings row).
- This is the concrete backend the `scheduler-and-email-alerts` TODO needs;
  the daily diff (new `active` rows since last run) feeds alerts later.

### 9. Enrichment completeness — track-and-retry, never re-hammer (the fix)

The goal: it must not be *possible* for a car to sit permanently un-enriched
because of a transient failure — **without** retrying in-run (which risks an IP
block). The store itself is the retry queue.

Today `enrichListing` (`adapters/direct/autoscout24.js`) swallows every failure
into "keep the original (null) value," so a failed fetch is indistinguishable
from a car the source genuinely has no CO₂ for. The batch can't act on a gap it
can't see. So:

- **Distinguish the two failure modes.** Change `enrichListing` to return a
  status, not just a listing — e.g. `{ listing, enrichStatus, missingFields }`:
  - `complete` — every field the ISV calc needs is present (from the card or the
    detail page).
  - `enrich_pending` — the detail fetch/parse **failed** (network, 403, no
    `__NEXT_DATA__`). Data probably exists; we just didn't get it this time.
  - `source_missing` — the detail page **loaded fine** but genuinely omits the
    field. No retry can ever fix this; it's a legitimate terminal `incomplete`.

- **One attempt per car per run.** `tryEnrich` does a single detail fetch (reuse
  the existing politeness: bounded `mapPool` concurrency + `requestDelayMs`). No
  in-run backoff/retry loop — that's the whole point.

- **Persist the gap, retry next run.** On `enrich_pending`, upsert the row with
  `enrich_status='enrich_pending'` and `missing_fields` set; its `result_json`
  stays `incomplete` for now. The next run's step (a) drains
  `getDealsNeedingEnrichment()` and gives each one **one fresh attempt** before
  the new-inventory sweep. Inventory turns over slowly, so the backlog is small
  and the daily cadence closes gaps within a day or two at zero extra burst load.

- **Terminal is terminal.** `source_missing` rows are stored `incomplete` and
  **not** re-fetched every run (the index/query only pulls `enrich_pending`), so
  we don't waste budget re-confirming a car the source will never describe. (A
  rare manual "re-check terminals" sweep can be a later admin action.)

- **Cap the backlog drain.** `getDealsNeedingEnrichment(limit)` is bounded per
  run and `log`s what it couldn't reach ("re-enriched N, M still pending") — no
  silent truncation, and the per-run request ceiling stays predictable.

Net result: a stored `incomplete` deal now means exactly one thing —
`source_missing`, the data doesn't exist. Anything fetchable is fetched,
eventually, across runs, at flat request volume.

## Notes / files

- New: `server/src/jobs/ingestDeals.js`, `deals` table + helpers in
  `server/src/db.js`, sweep-query builder (sort-order params in
  `adapters/direct/autoscout24.js#buildSearchUrl`).
- Reuse unchanged: `engine/landedCost.js`, `adapters/ptmarket.js`,
  `engine/priceSanity.js`, `adapters/source.js#searchListings`.
- Touch: `routes/search.js` (read from DB), `db.js` (migrate + helpers),
  `config.js` (sweep + ingest config, `config_version`), and
  `adapters/direct/autoscout24.js#enrichListing` — return
  `{ listing, enrichStatus, missingFields }` instead of just a listing, so the
  batch can tell a failed fetch (`enrich_pending`, retry next run) from a
  genuinely-absent field (`source_missing`, terminal). §9. Keep the old
  drop-in-replacement behaviour for the live `enrichListingsDirect` path, or
  adapt that caller too.
- Tests (`server/test/`): `deals` upsert/dedupe by stable key; skip-unchanged
  vs recompute-on-price-change; config-version invalidation; `ageOutDeals`
  lifecycle; sweep-query sort-order URL building; search route reads DB.
  Enrichment guarantee (§9): a failed enrich → row stored `enrich_pending` (not
  silently complete); a successful detail page missing CO₂ → `source_missing`
  (terminal, not re-queued); next run drains `getDealsNeedingEnrichment` and a
  now-succeeding attempt flips the row to `complete` with a real
  `total_landed_eur`; `enrich_pending` rows are NOT skipped by skip-unchanged.
- Interacts with: `pt-listings-as-buy-candidates` (the `country` column +
  no-import path should be ingested too) and `scheduler-and-email-alerts`
  (consumes the daily diff). Cross-link when implementing.
- Open decisions to confirm with the user before building:
  - Cross-source duplicate handling (collapse AS24/mobile.de same car, or keep
    both and show cheapest?).
  - Sweep scope for v1 (all `POPULAR_BRANDS`? user-saved searches only? a fixed
    seed list?) — drives run time and request volume.
  - Retention: how long to keep `sold` rows (history vs DB growth).
