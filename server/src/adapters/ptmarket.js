// Portugal market comparison adapter (PLAN.md §5).
//
// Dispatches on DATA_SOURCE (see config.js):
//   - `mock`             → deterministic synthesised average (below), no creds.
//   - `direct` / `apify` → real PT asking prices via OLX.pt's open public JSON
//                          API (./direct/olxpt.js) — no key needed.
//   - `official`         → partner OLX/Standvirtual API (./ptMarketClient.js).
//
// Live results share a 24h cache (PLAN.md §9: PT prices are slow-moving).
// All paths expose the same `getComparison(listing)` shape.

import { getDataSource, getPtCacheTtlMs } from '../config.js';
import { getComparisonOfficial } from './ptMarketClient.js';
import { getComparisonCombined } from './direct/ptComparison.js';
import { getCached, setCached } from '../db.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Bump when the comparison payload shape OR its computation changes — older
// cached entries must not be served. v6: fixed canonicalisation of accented PT
// labels ("Automática"/"Elétrico"/"Híbrido" were dropped, starving the sample)
// and Standvirtual now contributes via the verified model-enum filter, so v5
// rows hold artificially small samples. v5: multi-source orchestration (OLX.pt +
// Standvirtual) + robust market-value estimate (marketValueEur/method/median) +
// per-source breakdown. v4 rows hold OLX-only mean averages. v3 rows hold the
// pre-fix unfiltered averages (a BMW 116 averaged at €28,920 across M4s/Z4s).
const CACHE_VERSION = 6;

// Cache key bucketed to match the comparison window (year, 20k-km bracket) so
// equivalent cars share a cached average (PLAN.md §5).
function cacheKey(listing) {
  const mileageBucket = Math.round((listing.mileageKm ?? 0) / 20000);
  return [`v${CACHE_VERSION}`, listing.brand, listing.model, listing.year, mileageBucket]
    .join('|')
    .toLowerCase();
}

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
 * PT market comparison for one listing. Mock returns immediately; live modes
 * check the 24h cache, fetch on miss, and cache the result.
 *
 * @param {object} listing  normalised listing
 * @param {object} [opts]   { now } epoch ms, for cache freshness
 * @returns {Promise<{ avgPriceEur: number|null, sampleSize: number,
 *                     source: string, criteria: object }>}
 */
export async function getComparison(listing, opts = {}) {
  const source = getDataSource();
  if (source === 'mock') return getComparisonMock(listing);

  const now = opts.now ?? Date.now();
  const key = cacheKey(listing);
  const cached = getCached('pt_market_cache', key, getPtCacheTtlMs(), now);
  if (cached) return cached;

  const comparison =
    source === 'official'
      ? await getComparisonOfficial(listing)
      : await getComparisonCombined(listing); // direct + apify: keyless OLX.pt + Standvirtual

  // Don't cache an empty result (every source failed/blocked, or zero
  // comparables) — that would pin "no comparison" for the full TTL. Let the next
  // request retry instead.
  if (comparison && comparison.avgPriceEur != null) {
    setCached('pt_market_cache', key, comparison, now);
  }
  return comparison;
}
