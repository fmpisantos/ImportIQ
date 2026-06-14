// One-off / maintenance recompute of stored deals — re-cost + re-compare from
// each deal's stored `listing_json`, WITHOUT re-scraping AutoScout24.
//
// Why this exists: the retired PT cache (see adapters/ptmarket.js) bucketed
// comparisons by brand|model|year|mileage. With a null model (commercial
// vehicles) many distinct cars collapsed onto one key and inherited each other's
// comparison — a petrol Transit Courier was scored against diesel Ranger
// pickups. The daily ingest's skip-unchanged guard would never recompute those
// rows (price + config_version unchanged), so this job force-recomputes them.
//
// It re-runs `getComparison` (now uncached + model-recovered + trust-gated):
//   - rows with a null model short-circuit (no PT fetch) to a reliable:false
//     comparison → verdict 'unknown' (no more bogus saving).
//   - rows whose stored comparison was for the wrong fuel/transmission get a
//     fresh, correct comparison.
//
// Defaults to recomputing only the *provably contaminated* rows so it stays
// network-light; pass { all: true } to refresh every active deal.

import {
  getDb,
  buildConfigView,
  getDeal,
  upsertDeal,
} from '../db.js';
import { getComparison } from '../adapters/ptmarket.js';
import { computeLandedCost, attachComparison } from '../engine/landedCost.js';
import { rowFrom } from './ingestDeals.js';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const lc = (s) => (s == null ? null : String(s).toLowerCase());

/**
 * A stored deal is "contaminated" if its persisted comparison was computed for a
 * different car than the listing: no model to match on, or the comparison's
 * matchedCriteria fuel/transmission disagrees with the listing's own.
 */
export function isContaminated(listing, result) {
  if (!listing.model || !String(listing.model).trim()) return true;
  const mc = result?.comparison?.matchedCriteria;
  if (!mc) return false;
  if (lc(listing.fuelType) && lc(mc.fuelType) && lc(listing.fuelType) !== lc(mc.fuelType)) return true;
  if (
    lc(listing.transmission) &&
    lc(mc.transmission) &&
    lc(listing.transmission) !== lc(mc.transmission)
  )
    return true;
  return false;
}

/**
 * Recompute stored deals in place.
 *
 * @param {object} [opts] { all=false, now, requestDelayMs=300, log }
 * @returns {Promise<{scanned:number, recomputed:number, fetched:number}>}
 */
export async function recomputeDeals(opts = {}) {
  const now = opts.now ?? Date.now();
  const requestDelayMs = opts.requestDelayMs ?? 300;
  const log = opts.log ?? ((m) => console.log(`[recompute] ${m}`));
  const config = buildConfigView();
  const d = new Date(now);
  const ref = { referenceYear: d.getFullYear(), referenceMonth: d.getMonth() + 1 };
  const haircutRow = config.byKey['resale.asking_to_sale_haircut_pct'];
  const resaleHaircutPct = haircutRow && haircutRow.enabled ? haircutRow.amount_eur : 0;

  const keys = getDb()
    .prepare("SELECT deal_key FROM deals WHERE status='active'")
    .all()
    .map((r) => r.deal_key);

  const stats = { scanned: 0, recomputed: 0, fetched: 0 };
  for (const key of keys) {
    const existing = getDeal(key);
    if (!existing) continue;
    stats.scanned++;
    const listing = JSON.parse(existing.listing_json);
    const prior = JSON.parse(existing.result_json);
    if (!opts.all && !isContaminated(listing, prior)) continue;

    const hasModel = Boolean(listing.model && String(listing.model).trim());
    let comparison = null;
    try {
      comparison = await getComparison(listing); // null-model short-circuits (no fetch)
    } catch (err) {
      log(`PT comparison failed for ${key}: ${err.message ?? err}`);
    }
    if (hasModel) {
      stats.fetched++;
      await sleep(requestDelayMs); // politeness only when we actually hit the network
    }
    const result = attachComparison(computeLandedCost(listing, config, ref), comparison, {
      resaleHaircutPct,
    });
    upsertDeal(
      rowFrom(listing, result, {
        enrichStatus: existing.enrich_status,
        missingFields: existing.missing_fields ? existing.missing_fields.split(',') : [],
        configVersion: existing.config_version,
        now,
        existing,
      })
    );
    stats.recomputed++;
  }

  log(
    `scanned ${stats.scanned} active deals, recomputed ${stats.recomputed} ` +
      `(${stats.fetched} needed a live PT fetch)`
  );
  return stats;
}

// CLI: `node src/jobs/recomputeDeals.js` (contaminated only) or `--all`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recomputeDeals({ all: process.argv.includes('--all') })
    .then((s) => {
      console.log('[recompute] done:', JSON.stringify(s));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[recompute] failed:', err);
      process.exit(1);
    });
}
