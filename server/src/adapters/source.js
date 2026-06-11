// Data-source dispatcher used by the routes. Routes import from here so the rest
// of the app is agnostic to which source is active:
//
//   mock      → deterministic sample listings (mobile.de adapter, no creds)
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
import { POPULAR_BRANDS } from './brands.js';

export async function searchListings(filters = {}, opts = {}) {
  if (getDataSource() === 'apify') return searchListingsApify(filters, opts);
  return searchMobiledeOrMock(filters, opts); // handles both mock and official
}

export async function listBrandsAndModels(opts = {}) {
  if (getDataSource() === 'apify') return POPULAR_BRANDS;
  return listMobiledeBrands(opts);
}
