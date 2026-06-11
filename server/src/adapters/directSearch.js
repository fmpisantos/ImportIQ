// Keyless live search (DATA_SOURCE=direct).
//
// Scrapes AutoScout24's public search pages directly (see direct/autoscout24.js)
// — no Apify token, no partner credentials. Results are cached in SQLite per
// filter-set, post-filtered defensively, and listings missing CO₂ are enriched
// from their detail pages (each detail cached individually — a listing's specs
// never change) so the ISV environmental component can be computed.
//
// mobile.de blocks plain scraping (Akamai 403), so it joins the search only
// when a key for it is saved — dealer credentials (official Search API) win
// over an Apify token (pay-per-result scraper actor); with neither, the
// search runs on AutoScout24 alone.

import { getDirectConfig, getApifyConfig, getMobiledeConfig } from '../config.js';
import { getCached, setCached } from '../db.js';
import { matchesFilters, dedupeListings } from './normalize.js';
import { searchAutoScout24, enrichListing } from './direct/autoscout24.js';
import { searchSiteApify } from './apifySearch.js';
import { searchListingsViaOfficialApi } from './mobilede.js';

// A listing's published specs are immutable — cache enriched details for long.
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(filters) {
  const relevant = {
    brand: filters.brand ?? null,
    model: filters.model ?? null,
    bodyType: filters.bodyType ?? null,
    priceMin: filters.priceMin ?? null,
    priceMax: filters.priceMax ?? null,
    yearFrom: filters.yearFrom ?? null,
    maxMileageKm: filters.maxMileageKm ?? null,
    fuelTypes: [...(filters.fuelTypes ?? [])].sort(),
    transmission: filters.transmission ?? null,
  };
  return `direct:autoscout24:${JSON.stringify(relevant)}`;
}

// Run `worker` over items with bounded concurrency — enough to keep detail
// enrichment quick, low enough to look like a person browsing.
async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Which mobile.de path the saved keys allow: 'official' (dealer credentials),
 * 'apify' (token), or null (skip mobile.de). Also drives the Settings UI/test.
 */
export function mobiledeAccess() {
  const { username, password } = getMobiledeConfig();
  if (username && password) return 'official';
  if (getApifyConfig().token) return 'apify';
  return null;
}

async function searchMobilede(filters, referenceYear, now) {
  const access = mobiledeAccess();
  if (!access) return [];
  if (access === 'official') {
    const listings = await searchListingsViaOfficialApi(filters, { now });
    return listings
      .map((l) => ({ ...l, source: 'mobilede' }))
      .filter((l) => matchesFilters(l, filters));
  }
  // Apify path: cached, mapped, post-filtered and tagged by apifySearch.
  return searchSiteApify('mobilede', filters, referenceYear, now);
}

async function enrichMissingCo2(listings, cfg, now) {
  // Only AutoScout24 listings can be enriched from their detail page; don't
  // let other sources' gaps eat the enrich budget.
  const needs = listings.filter((l) => l.co2GKm == null && l.url && l.source === 'autoscout24');
  const targets = needs.slice(0, cfg.enrichLimit);
  if (needs.length > targets.length) {
    console.warn(
      `[direct] ${needs.length} listings missing CO₂; enriching first ${targets.length} (DIRECT_ENRICH_LIMIT)`
    );
  }

  const enrichedById = new Map();
  await mapPool(targets, 3, async (listing) => {
    const key = `direct:as24:detail:${listing.id}`;
    const cached = getCached('listings_cache', key, DETAIL_TTL_MS, now);
    if (cached) {
      enrichedById.set(listing.id, { ...listing, ...cached });
      return;
    }
    const enriched = await enrichListing(listing);
    const { co2GKm, powerKw, displacementCm3 } = enriched;
    setCached('listings_cache', key, { co2GKm, powerKw, displacementCm3 }, now);
    enrichedById.set(listing.id, enriched);
  });

  return listings.map((l) => enrichedById.get(l.id) ?? l);
}

async function searchAs24Cached(filters, cfg, referenceYear, now) {
  const key = cacheKey(filters);
  let listings = getCached('listings_cache', key, cfg.cacheTtlMs, now);
  if (!listings) {
    listings = await searchAutoScout24(filters, {
      maxResults: cfg.maxResults,
      country: cfg.autoscout24Country,
      requestDelayMs: cfg.requestDelayMs,
      referenceYear,
    });
    setCached('listings_cache', key, listings, now);
  }
  return listings
    .map((l) => ({ ...l, source: 'autoscout24' }))
    .filter((l) => matchesFilters(l, filters));
}

/**
 * @param {object} filters  see PLAN.md §3
 * @param {object} [opts]   { now } epoch ms (testability)
 * @returns {Promise<object[]>} normalised, filtered, deduped listings tagged
 *   with source (autoscout24, plus mobilede when a key is saved)
 */
export async function searchListingsDirect(filters = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const referenceYear = filters.referenceYear ?? new Date(now).getFullYear();
  const cfg = getDirectConfig();

  // One blocked/failing source shouldn't sink the search — collect what works.
  const [as24, mobilede] = await Promise.allSettled([
    searchAs24Cached(filters, cfg, referenceYear, now),
    searchMobilede(filters, referenceYear, now),
  ]);

  const errors = [];
  if (as24.status === 'rejected') errors.push(`autoscout24: ${as24.reason?.message ?? as24.reason}`);
  if (mobilede.status === 'rejected')
    errors.push(`mobilede (${mobiledeAccess()}): ${mobilede.reason?.message ?? mobilede.reason}`);
  if (errors.length) console.warn('[direct] some sources failed:', errors.join('; '));
  // Without a mobile.de key, AS24 is the only real source — its failure is fatal.
  const mobiledeUsable = mobiledeAccess() != null && mobilede.status === 'fulfilled';
  if (as24.status === 'rejected' && !mobiledeUsable) {
    throw new Error(`All direct sources failed. ${errors.join('; ')}`);
  }

  const listings = dedupeListings([
    ...(as24.status === 'fulfilled' ? as24.value : []),
    ...(mobilede.status === 'fulfilled' ? mobilede.value : []),
  ]);

  return enrichMissingCo2(listings, cfg, now);
}
