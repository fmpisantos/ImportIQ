// Data-source dispatcher used by the routes. Routes import from here so the rest
// of the app is agnostic to which source is active:
//
//   mock      → deterministic sample listings (mobile.de adapter, no creds)
//   direct    → keyless scraping of AutoScout24 search pages (no token)
//   official  → real mobile.de Search API
//   apify     → live mobile.de + AutoScout24 + AutoUncle via Apify scrapers
//
// Selected by DATA_SOURCE (see config.js).

import { getDataSource } from '../config.js';
import {
  searchListings as searchMobiledeOrMock,
  listBrandsAndModels as listMobiledeBrands,
} from './mobilede.js';
import { searchListingsApify } from './apifySearch.js';
import {
  searchListingsDirect,
  searchListingsDirectPage,
  searchListingsDirectPageComputed,
  sortComputedNullsLast,
  enrichListingsDirect,
  enrichOneCached,
} from './directSearch.js';
import { POPULAR_BRANDS } from './brands.js';
import { missingListingFields } from '../engine/landedCost.js';

export async function searchListings(filters = {}, opts = {}) {
  const source = getDataSource();
  if (source === 'apify') return searchListingsApify(filters, opts);
  if (source === 'direct') return searchListingsDirect(filters, opts);
  return searchMobiledeOrMock(filters, opts); // handles both mock and official
}

/**
 * Paginated live search for the on-demand UI path. The `direct` source scrapes
 * exactly the requested page (cached per filter-set + page for 12h); every other
 * source has no native pagination, so we fetch its pool once and slice. Returns
 * the same envelope either way: `{ listings, page, pageSize, totalPages,
 * totalResults }`.
 */
export async function searchListingsPaged(filters = {}, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 50));

  if (getDataSource() === 'direct') {
    return searchListingsDirectPage(filters, { ...opts, page, pageSize });
  }

  // Non-direct sources: keep the legacy fetch-pool-then-slice behaviour.
  const pool = await searchListings(filters, opts);
  return {
    listings: pool.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(pool.length / pageSize)),
    totalResults: pool.length,
    totalAvailable: pool.length,
  };
}

/**
 * Paginated live search ordered by a *computed* key (saving/margin/landed).
 * These depend on our landed-cost + PT calc, which no source can sort by, so the
 * whole reachable pool must be costed and ranked before slicing a page. The
 * `direct` source does this with a 12h ranked-pool cache (see
 * searchListingsDirectPageComputed); other sources cost their (small) pool each
 * request. The engine/PT work is injected via callbacks so this stays
 * source-agnostic:
 *   - `costOne(listing) → Promise<computedResult>` (must never throw),
 *   - `sortValue(result) → number|null` + `desc` (ranking key/direction).
 *
 * @returns {Promise<{ results, page, pageSize, total, totalPages, totalAvailable }>}
 *   `results` are fully-computed result objects, already ranked + sliced.
 */
export async function searchListingsPagedComputed(filters = {}, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 50));
  const { costOne, sortValue } = opts;
  const desc = opts.desc === 1 || opts.desc === '1' || opts.desc === true;

  if (getDataSource() === 'direct') {
    return searchListingsDirectPageComputed(filters, { ...opts, page, pageSize });
  }

  // Non-direct: fetch the pool (already carries specs), cost all, rank, slice.
  const pool = await searchListings(filters, { now: opts.now });
  const costed = await Promise.all(pool.map((l) => costOne(l)));
  const computed = sortComputedNullsLast(costed, sortValue, desc);
  const total = computed.length;
  return {
    results: computed.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    totalAvailable: total,
  };
}

/**
 * Fill in any source-specific detail a *page* of listings still needs before
 * costing (currently AutoScout24 detail-page CO₂). Called by the route on just
 * the page slice so the expensive per-listing detail fetches happen lazily.
 * No-op for sources whose listings already carry the data (apify/official/mock).
 */
export async function enrichListings(listings, opts = {}) {
  if (getDataSource() === 'direct') return enrichListingsDirect(listings, opts);
  return listings;
}

export async function listBrandsAndModels(opts = {}) {
  const source = getDataSource();
  if (source === 'apify' || source === 'direct') return POPULAR_BRANDS;
  return listMobiledeBrands(opts);
}

/**
 * One single-attempt, status-returning enrich of a listing for the batch
 * ingestor (jobs/ingestDeals.js). AutoScout24 listings consult their detail
 * page (cached, one fetch, budget-aware); every other source already carries
 * its specs, so the status is read straight off the current fields and is
 * terminal (a missing field there is `source_missing`, never retried).
 *
 * @param {object} listing   normalised listing tagged with `source`
 * @param {object} [opts]    { now, fetchBudget } — fetchBudget caps live AS24
 *                          detail fetches across a run
 * @returns {Promise<{ listing, enrichStatus, missingFields }>}
 */
export async function tryEnrichListing(listing, opts = {}) {
  if (listing.source === 'autoscout24') return enrichOneCached(listing, opts);
  const missing = missingListingFields(listing);
  return {
    listing,
    enrichStatus: missing.length ? 'source_missing' : 'complete',
    missingFields: missing,
  };
}
