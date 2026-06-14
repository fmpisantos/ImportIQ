// Daily batch deal-ingestion (TODO: 2026-06-13-daily-batch-deal-ingestion).
//
// Replaces "scrape-and-compute on every UI search" with a persistent, batch-
// filled `deals` store. This orchestrator fetches listings from the live
// source, computes the full landed-cost + PT-comparison for each NEW or CHANGED
// listing, and upserts the result into `deals`. The UI search then reads that
// table (plain SQL) instead of triggering a live scrape.
//
// It reuses ALL existing engine + adapter code unchanged — it's just a new
// orchestrator that persists instead of returning over HTTP. Two phases per run:
//
//   (a) drain the enrich backlog — cars whose detail fetch failed on a prior run
//       get ONE fresh attempt before anything else (the across-run retry, §9).
//   (b) sweep for new/changed inventory across rotating sort orders (§5), so
//       coverage grows toward the full inventory instead of re-reading the same
//       150 top cards every time.
//
// Politeness is load-bearing: one detail fetch per car per run (never an in-run
// retry loop), a hard per-run fetch ceiling, and bounded concurrency — so we
// never hammer AutoScout24 into an IP block.

import {
  buildConfigView,
  getDeal,
  upsertDeal,
  markDealsLastSeen,
  ageOutDeals,
  purgeOldSoldDeals,
  getDealsNeedingEnrichment,
  countDealsNeedingEnrichment,
} from '../db.js';
import { searchListings, tryEnrichListing } from '../adapters/source.js';
import { getComparison } from '../adapters/ptmarket.js';
import { computeLandedCost, attachComparison } from '../engine/landedCost.js';
import { getIngestConfig, SWEEP_SORTS } from '../config.js';
import { pathToFileURL } from 'node:url';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Stable per-listing identity for the deals store: `${source}:${id}`. */
export function dealKey(listing) {
  return `${listing.source ?? 'unknown'}:${listing.id}`;
}

/** Content fingerprint (same shape as dedupeListings) for future cross-source collapse. */
function contentKey(l) {
  return [l.brand, l.model, l.year, l.priceEur, l.mileageKm].map(norm).join('|');
}

/** Cheap change-detector: a price change flips this, forcing a recompute. */
function priceHash(l) {
  return String(l.priceEur ?? '');
}

/**
 * Bucket a computed result into a coarse verdict for the `verdict` column /
 * cheap SQL filtering. `incomplete` (no costable total) and `unknown` (costable
 * but no PT comparison) are distinct from the saving-based buckets.
 */
export function verdictOf(result) {
  if (result.incomplete) return 'incomplete';
  if (result.savingEur == null) return 'unknown';
  const pct = result.savingPct ?? 0;
  if (pct >= 10) return 'good_deal';
  if (pct >= 0) return 'fair';
  return 'overpriced';
}

/** Build the full deals row from a listing + its computed result. */
function rowFrom(listing, result, { enrichStatus, missingFields, configVersion, now, existing }) {
  return {
    deal_key: dealKey(listing),
    source: listing.source ?? 'unknown',
    listing_id: String(listing.id),
    url: listing.url ?? null,
    content_key: contentKey(listing),
    brand: listing.brand ?? null,
    model: listing.model ?? null,
    year: listing.year ?? null,
    mileage_km: listing.mileageKm ?? null,
    fuel_type: listing.fuelType ?? null,
    country: listing.location?.country ?? null,
    price_eur: listing.priceEur ?? null,
    total_landed_eur: result.totalLandedCostEur ?? null,
    market_value_eur: result.comparison?.marketValueEur ?? result.comparison?.avgPriceEur ?? null,
    saving_eur: result.savingEur ?? null,
    margin_eur: result.marginEur ?? null,
    verdict: verdictOf(result),
    incomplete: result.incomplete ? 1 : 0,
    enrich_status: enrichStatus,
    missing_fields: missingFields?.length ? missingFields.join(',') : null,
    // Only a successful (terminal) attempt stamps enriched_at; a pending row
    // keeps its prior stamp so the backlog drains oldest-first.
    enriched_at: enrichStatus === 'enrich_pending' ? existing?.enriched_at ?? null : now,
    listing_json: JSON.stringify(listing),
    result_json: JSON.stringify(result),
    price_hash: priceHash(listing),
    config_version: configVersion,
    first_seen_at: existing?.first_seen_at ?? now,
    last_seen_at: now,
    computed_at: now,
    status: 'active',
  };
}

/**
 * Compute a result WITHOUT a PT fetch — used for enrich_pending rows, which are
 * deliberately not (re)costed this run. Yields a valid `incomplete` result
 * object so the UI still gets a consistent shape.
 */
function incompleteResult(listing, config, ref) {
  return attachComparison(computeLandedCost(listing, config, ref), null);
}

/**
 * Ingest one listing: skip-if-unchanged, else one polite enrich attempt, then
 * cost + PT-compare + persist. Never retries the enrich in-run.
 *
 * @returns {Promise<'skipped'|'pending'|'ingested'>}
 */
async function ingestOne(listing, ctx) {
  const { config, ref, now, resaleHaircutPct, fetchBudget } = ctx;
  const key = dealKey(listing);
  const existing = getDeal(key);

  // Unchanged price, same config, and not awaiting an enrich retry → just touch
  // freshness. The enrich_pending guard is what lets a previously-failed car get
  // its retry this run instead of being skipped (§4/§9).
  if (
    existing &&
    existing.price_hash === priceHash(listing) &&
    existing.config_version === config.version &&
    existing.enrich_status !== 'enrich_pending'
  ) {
    markDealsLastSeen([key], now);
    return 'skipped';
  }

  const { listing: enriched, enrichStatus, missingFields } = await tryEnrichListing(listing, {
    now,
    fetchBudget,
  });

  if (enrichStatus === 'enrich_pending') {
    // Detail fetch failed (or was deferred for budget) — flag and retry next
    // run; cost it without a PT fetch so the row still carries a result object.
    const result = incompleteResult(enriched, config, ref);
    upsertDeal(rowFrom(enriched, result, { enrichStatus, missingFields, configVersion: config.version, now, existing }));
    return 'pending';
  }

  // A PT-source hiccup for one car shouldn't sink the whole sweep — cost it
  // anyway and store it without a comparison (saving stays null).
  let comparison = null;
  try {
    comparison = await getComparison(enriched, { now });
  } catch (err) {
    if (ctx.log) ctx.log(`PT comparison failed for ${dealKey(listing)}: ${err.message ?? err}`);
  }
  const result = attachComparison(computeLandedCost(enriched, config, ref), comparison, {
    resaleHaircutPct,
  });
  upsertDeal(rowFrom(enriched, result, { enrichStatus, missingFields, configVersion: config.version, now, existing }));
  return 'ingested';
}

// Bounded-concurrency map (mirrors directSearch's mapPool) so per-listing work
// — enrich + PT — runs a few at a time, low enough to look like a person.
async function mapPool(items, concurrency, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

/**
 * The set of `{ filters, sort }` searches this run covers: each configured sweep
 * query crossed with the sort orders selected for today. Sort orders rotate by
 * day so successive runs page through different windows of the same result set.
 */
export function resolveSweepQueries(cfg, now) {
  const dayIndex = Math.floor(now / (24 * 60 * 60 * 1000));
  const n = Math.min(cfg.sortsPerRun, SWEEP_SORTS.length);
  const sorts = Array.from({ length: n }, (_, i) => SWEEP_SORTS[(dayIndex + i) % SWEEP_SORTS.length]);
  const out = [];
  for (const filters of cfg.sweepQueries) {
    for (const s of sorts) out.push({ filters, sort: s.sort, desc: s.desc });
  }
  return out;
}

/**
 * Run one ingestion pass. Idempotent and resumable — keyed upserts make a re-run
 * or a crash mid-sweep safe.
 *
 * @param {object} [opts]   { now } epoch ms (testability)
 * @returns {Promise<object>} run stats
 */
export async function runIngest(opts = {}) {
  const now = opts.now ?? Date.now();
  const cfg = getIngestConfig();
  const config = buildConfigView();
  const d = new Date(now);
  const ref = { referenceYear: d.getFullYear(), referenceMonth: d.getMonth() + 1 };
  const haircutRow = config.byKey['resale.asking_to_sale_haircut_pct'];
  const resaleHaircutPct = haircutRow && haircutRow.enabled ? haircutRow.amount_eur : 0;

  // Shared live-fetch budget — caps AutoScout24 detail fetches across the whole
  // run (backlog + sweep). Cars over the cap are stored enrich_pending and
  // picked up next run, keeping per-run request volume predictable.
  const fetchBudget = {
    remaining: cfg.maxDetailFetchesPerRun,
    tryConsume() {
      if (this.remaining <= 0) return false;
      this.remaining--;
      return true;
    },
  };
  const log = opts.log ?? ((m) => console.log(`[ingest] ${m}`));
  const ctx = { config, ref, now, resaleHaircutPct, fetchBudget, log };

  const stats = { backlogDrained: 0, backlogStillPending: 0, swept: 0, ingested: 0, skipped: 0, pending: 0 };

  // (a) Drain the enrich backlog from prior runs — one fresh attempt each.
  const backlog = getDealsNeedingEnrichment(cfg.enrichBacklogLimit);
  await mapPool(backlog, cfg.concurrency, async (deal) => {
    const r = await ingestOne(deal.listing, ctx);
    stats.backlogDrained++;
    if (r === 'ingested') stats.ingested++;
    else if (r === 'pending') stats.pending++;
  });
  stats.backlogStillPending = countDealsNeedingEnrichment();
  log(
    `drained ${backlog.length} enrich-pending (limit ${cfg.enrichBacklogLimit}); ` +
      `${stats.backlogStillPending} still pending`
  );

  // (b) Sweep for new/changed inventory across rotating sort orders.
  const queries = resolveSweepQueries(cfg, now);
  const seen = new Set();
  for (const q of queries) {
    let pool;
    try {
      pool = await searchListings(q.filters, {
        now,
        sort: q.sort,
        desc: q.desc,
        maxResults: cfg.maxResults,
      });
    } catch (err) {
      log(`sweep query failed (sort=${q.sort} desc=${q.desc}): ${err.message ?? err}`);
      continue;
    }
    // Don't re-ingest a car already handled this run (overlapping sort windows).
    const fresh = pool.filter((l) => {
      const k = dealKey(l);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    await mapPool(fresh, cfg.concurrency, async (listing) => {
      const r = await ingestOne(listing, ctx);
      stats.swept++;
      if (r === 'ingested') stats.ingested++;
      else if (r === 'skipped') stats.skipped++;
      else if (r === 'pending') stats.pending++;
    });
    await sleep(cfg.requestDelayMs);
  }

  // Age out / purge by freshness.
  const { stale, sold } = ageOutDeals(now, cfg.staleAfterMs, cfg.soldAfterMs);
  const purged = purgeOldSoldDeals(now, cfg.purgeAfterMs);

  if (fetchBudget.remaining <= 0) {
    log('detail-fetch budget exhausted this run — remaining gaps deferred to next run');
  }
  log(
    `swept ${queries.length} queries over ${seen.size} unique cards: ` +
      `${stats.ingested} ingested, ${stats.skipped} unchanged, ${stats.pending} enrich-pending; ` +
      `${stale} → stale, ${sold} → sold, ${purged} purged`
  );

  return { ...stats, queries: queries.length, uniqueCards: seen.size, stale, sold, purged, ranAt: now };
}

// CLI entry: `npm run ingest` (server workspace) / `node src/jobs/ingestDeals.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIngest()
    .then((s) => {
      console.log('[ingest] done:', JSON.stringify(s));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest] failed:', err);
      process.exit(1);
    });
}
