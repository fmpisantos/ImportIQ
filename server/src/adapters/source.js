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
import { searchListingsDirect, enrichListingsDirect, enrichOneCached } from './directSearch.js';
import { POPULAR_BRANDS } from './brands.js';
import { missingListingFields } from '../engine/landedCost.js';

export async function searchListings(filters = {}, opts = {}) {
  const source = getDataSource();
  if (source === 'apify') return searchListingsApify(filters, opts);
  if (source === 'direct') return searchListingsDirect(filters, opts);
  return searchMobiledeOrMock(filters, opts); // handles both mock and official
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
