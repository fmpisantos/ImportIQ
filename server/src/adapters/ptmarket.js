// Portugal market comparison adapter (PLAN.md §5).
//
// Dispatches on DATA_SOURCE (see config.js):
//   - `mock`     → deterministic synthesised average (below), no credentials.
//   - `official` → real OLX/Standvirtual query (./ptMarketClient.js), with a
//                  24h cache (PLAN.md §9: PT prices are slow-moving).
//
// Both expose the same `getComparison(listing)` shape.

import { isOfficial, PT_CACHE_TTL_MS } from '../config.js';
import { getComparisonOfficial } from './ptMarketClient.js';
import { getCached, setCached } from '../db.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Cache key bucketed to match the comparison window (year, 20k-km bracket) so
// equivalent cars share a cached average (PLAN.md §5).
function cacheKey(listing) {
  const mileageBucket = Math.round((listing.mileageKm ?? 0) / 20000);
  return [listing.brand, listing.model, listing.year, mileageBucket].join('|').toLowerCase();
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
 * PT market comparison for one listing. Mock returns immediately; official
 * checks the 24h cache, fetches on miss, and caches the result.
 *
 * @param {object} listing  normalised mobile.de listing
 * @param {object} [opts]   { now } epoch ms, for cache freshness
 * @returns {Promise<{ avgPriceEur: number|null, sampleSize: number,
 *                     source: string, criteria: object }>}
 */
export async function getComparison(listing, opts = {}) {
  if (!isOfficial) return getComparisonMock(listing);

  const now = opts.now ?? Date.now();
  const key = cacheKey(listing);
  const cached = getCached('pt_market_cache', key, PT_CACHE_TTL_MS, now);
  if (cached) return cached;

  const comparison = await getComparisonOfficial(listing);
  setCached('pt_market_cache', key, comparison, now);
  return comparison;
}
