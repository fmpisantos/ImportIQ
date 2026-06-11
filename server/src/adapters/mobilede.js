// mobile.de data adapter (PLAN.md §9).
//
// Dispatches between two implementations based on DATA_SOURCE (see config.js):
//   - `mock`     → deterministic sample listings (below), no credentials.
//   - `official` → real mobile.de Search API (./mobiledeClient.js).
//
// Both expose the same `searchListings(filters)` / `listBrandsAndModels()`
// shape, so the routes, ISV engine, and UI are agnostic to the source.

import { isOfficial } from '../config.js';
import {
  searchListingsOfficial,
  fetchRefdataTree,
} from './mobiledeClient.js';
import { getCached, setCached } from '../db.js';

// Refdata (make/model tree) is slow-moving — cache it for 30 days.
const REFDATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function getRefdataTree(now) {
  const cached = getCached('refdata_cache', 'mobilede', REFDATA_TTL_MS, now);
  if (cached) return cached;
  const tree = await fetchRefdataTree();
  setCached('refdata_cache', 'mobilede', tree, now);
  return tree;
}

const SAMPLE_LISTINGS = [
  {
    id: 'mde-1001',
    brand: 'BMW',
    model: '320i',
    year: 2019,
    firstRegYear: 2019,
    mileageKm: 68000,
    fuelType: 'Petrol',
    transmission: 'Automatic',
    bodyType: 'Saloon',
    priceEur: 18500,
    displacementCm3: 1998,
    co2GKm: 132,
    emissionStandard: 'WLTP',
    location: { zip: '80331', country: 'DE' },
    thumbnailUrl: 'https://placehold.co/320x180?text=BMW+320i',
    url: 'https://www.mobile.de/listing/mde-1001',
  },
  {
    id: 'mde-1002',
    brand: 'Audi',
    model: 'A4 Avant',
    year: 2018,
    firstRegYear: 2018,
    mileageKm: 95000,
    fuelType: 'Diesel',
    transmission: 'Automatic',
    bodyType: 'Estate',
    priceEur: 16900,
    displacementCm3: 1968,
    co2GKm: 118,
    emissionStandard: 'WLTP',
    particleEmissionsGKm: 0.0005,
    location: { zip: '50667', country: 'DE' },
    thumbnailUrl: 'https://placehold.co/320x180?text=Audi+A4',
    url: 'https://www.mobile.de/listing/mde-1002',
  },
  {
    id: 'mde-1003',
    brand: 'Tesla',
    model: 'Model 3',
    year: 2021,
    firstRegYear: 2021,
    mileageKm: 42000,
    fuelType: 'Electric',
    transmission: 'Automatic',
    bodyType: 'Saloon',
    priceEur: 28900,
    displacementCm3: 0,
    co2GKm: 0,
    emissionStandard: 'WLTP',
    location: { zip: '10115', country: 'DE' },
    thumbnailUrl: 'https://placehold.co/320x180?text=Tesla+Model+3',
    url: 'https://www.mobile.de/listing/mde-1003',
  },
  {
    id: 'mde-1004',
    brand: 'Mercedes-Benz',
    model: 'C 300 e',
    year: 2020,
    firstRegYear: 2020,
    mileageKm: 71000,
    fuelType: 'PHEV',
    transmission: 'Automatic',
    bodyType: 'Saloon',
    priceEur: 24500,
    displacementCm3: 1991,
    co2GKm: 38,
    emissionStandard: 'WLTP',
    qualifiesForEvRegime: true,
    location: { zip: '70173', country: 'DE' },
    thumbnailUrl: 'https://placehold.co/320x180?text=Mercedes+C300e',
    url: 'https://www.mobile.de/listing/mde-1004',
  },
  {
    id: 'mde-1005',
    brand: 'Volkswagen',
    model: 'Golf',
    year: 2017,
    firstRegYear: 2017,
    mileageKm: 112000,
    fuelType: 'Petrol',
    transmission: 'Manual',
    bodyType: 'Small',
    priceEur: 12400,
    displacementCm3: 1395,
    co2GKm: 120,
    emissionStandard: 'NEDC',
    location: { zip: '38440', country: 'DE' },
    thumbnailUrl: 'https://placehold.co/320x180?text=VW+Golf',
    url: 'https://www.mobile.de/listing/mde-1005',
  },
];

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Mock implementation — filters the in-memory sample set.
 *
 * @param {object} filters  see PLAN.md §3
 * @returns {Promise<object[]>} normalised listings, each with an `ageYears`
 *   field derived from `referenceYear` (defaults to the current year).
 */
export async function searchListingsMock(filters = {}) {
  const {
    brand,
    model,
    bodyType,
    priceMin,
    priceMax,
    yearFrom,
    maxMileageKm,
    fuelTypes, // array
    transmission,
    referenceYear = new Date().getFullYear(),
  } = filters;

  const fuelSet = Array.isArray(fuelTypes) && fuelTypes.length
    ? new Set(fuelTypes.map(norm))
    : null;

  return SAMPLE_LISTINGS.filter((l) => {
    if (brand && norm(l.brand) !== norm(brand)) return false;
    if (model && !norm(l.model).includes(norm(model))) return false;
    if (bodyType && norm(l.bodyType) !== norm(bodyType)) return false;
    if (priceMin != null && l.priceEur < priceMin) return false;
    if (priceMax != null && l.priceEur > priceMax) return false;
    if (yearFrom != null && l.year < yearFrom) return false;
    if (maxMileageKm != null && l.mileageKm > maxMileageKm) return false;
    if (fuelSet && !fuelSet.has(norm(l.fuelType))) return false;
    if (transmission && norm(transmission) !== 'any' && norm(l.transmission) !== norm(transmission))
      return false;
    return true;
  }).map((l) => ({
    ...l,
    ageYears: Math.max(0, referenceYear - l.firstRegYear),
  }));
}

function listBrandsAndModelsMock() {
  const map = {};
  for (const l of SAMPLE_LISTINGS) {
    (map[l.brand] ??= new Set()).add(l.model);
  }
  return Object.fromEntries(
    Object.entries(map).map(([brand, models]) => [brand, [...models]])
  );
}

// --- Public dispatchers -----------------------------------------------------

/**
 * Search mobile.de listings. Routes to the mock or the official Search API
 * depending on DATA_SOURCE.
 *
 * @param {object} filters  see PLAN.md §3
 * @param {object} [opts]   { now } epoch ms, used for refdata cache freshness
 * @returns {Promise<object[]>} normalised listings
 */
export async function searchListings(filters = {}, opts = {}) {
  if (!isOfficial()) return searchListingsMock(filters);
  const now = opts.now ?? Date.now();
  const refdataTree = await getRefdataTree(now);
  return searchListingsOfficial(filters, {
    refdataTree,
    referenceYear: filters.referenceYear ?? new Date(now).getFullYear(),
  });
}

/**
 * Brand → models map for the filter dropdowns. Mock returns the sample set;
 * official returns the cached mobile.de refdata tree flattened to brand→[model].
 *
 * @returns {Promise<Record<string, string[]>>}
 */
export async function listBrandsAndModels(opts = {}) {
  if (!isOfficial()) return listBrandsAndModelsMock();
  const now = opts.now ?? Date.now();
  const tree = await getRefdataTree(now);
  return Object.fromEntries(
    Object.entries(tree).map(([brand, { models }]) => [brand, Object.keys(models ?? {})])
  );
}
