// Portugal market comparison adapter (PLAN.md §5).
//
// Dispatches on DATA_SOURCE (see config.js):
//   - `mock`             → deterministic synthesised average (below), no creds.
//   - `direct` / `apify` → real PT asking prices via OLX.pt's open public JSON
//                          API (./direct/olxpt.js) — no key needed.
//   - `official`         → partner OLX/Standvirtual API (./ptMarketClient.js).
//
// All paths expose the same `getComparison(listing)` shape.
//
// NO per-listing cache: the daily batch (jobs/ingestDeals.js) already persists
// the computed comparison per deal in the `deals` table, so each changed listing
// is compared at most once per run. The old `pt_market_cache` bucketed by
// brand|model|year|mileage — with a null model (commercial vehicles) it collapsed
// many distinct cars onto one key and cross-contaminated their comparisons (a
// petrol Transit Courier served a diesel Ranger's average). Computing fresh per
// listing removes that whole failure mode.

import { getDataSource } from '../config.js';
import { getComparisonOfficial } from './ptMarketClient.js';
import { getComparisonCombined } from './direct/ptComparison.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Deterministic pseudo "PT premium over German price" so the same listing
// always yields the same comparison (no Math.random — keeps results stable).
function ptPremiumFactor(listing) {
  const seed = String(listing.id)
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  // 1.18 .. 1.34 premium band
  return 1.18 + (seed % 17) / 100;
}

/** Mock implementation — synthesised average from a deterministic premium. */
export async function getComparisonMock(listing) {
  const factor = ptPremiumFactor(listing);
  const avg = round2(listing.priceEur * factor);
  // Sample size also derived deterministically.
  const sampleSize = 4 + (listing.mileageKm % 11);

  return {
    avgPriceEur: avg,
    sampleSize,
    sampleListings: [], // synthesised average — there are no real listings to link
    source: 'mock:standvirtual',
    criteria: {
      brand: listing.brand,
      model: listing.model,
      yearRange: [listing.year - 1, listing.year + 1],
      mileageRangeKm: [
        Math.max(0, listing.mileageKm - 20000),
        listing.mileageKm + 20000,
      ],
    },
  };
}

// --- Public dispatcher ------------------------------------------------------

/**
 * PT market comparison for one listing. Computed fresh every call (no cache —
 * the deals store is the persistence layer now; see the file header).
 *
 * @param {object} listing  normalised listing
 * @returns {Promise<{ avgPriceEur: number|null, sampleSize: number,
 *                     source: string, criteria: object }>}
 */
export async function getComparison(listing) {
  const source = getDataSource();
  if (source === 'mock') return getComparisonMock(listing);
  if (source === 'official') return getComparisonOfficial(listing);
  // direct + apify: keyless OLX.pt + Standvirtual
  return getComparisonCombined(listing);
}
