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
import { searchListingsDirect, enrichListingsDirect } from './directSearch.js';
import { POPULAR_BRANDS } from './brands.js';

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
