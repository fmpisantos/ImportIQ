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
import { missingListingFields } from '../engine/landedCost.js';

// A listing's published specs are immutable — cache enriched details for long.
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(filters, { sort = 'standard', desc = 0 } = {}) {
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
    // Each sort order surfaces a different result window, so they cache apart.
    sort,
    desc,
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

/**
 * One polite, cached, single-attempt enrich of an AutoScout24 listing. The
 * detail-page cache (7 days — specs never change) is consulted first; on a miss
 * we do exactly one detail fetch and classify the outcome via `enrichListing`.
 * Terminal outcomes (`complete`/`source_missing`) are cached; a transient
 * failure (`enrich_pending`) is left uncached so it's retried.
 *
 * `fetchBudget` (optional) caps live fetches across a batch run: when a car
 * would need a network fetch but the budget is spent, it's returned
 * `enrich_pending` without fetching — picked up next run. The live search path
 * passes no budget (it's already bounded by DIRECT_ENRICH_LIMIT).
 *
 * @returns {Promise<{ listing, enrichStatus, missingFields }>}
 */
export async function enrichOneCached(listing, { now = Date.now(), fetchBudget = null } = {}) {
  const key = `direct:as24:detail:${listing.id}`;
  const cached = getCached('listings_cache', key, DETAIL_TTL_MS, now);
  if (cached) {
    const merged = { ...listing, ...cached };
    const missing = missingListingFields(merged);
    return {
      listing: merged,
      enrichStatus: missing.length ? 'source_missing' : 'complete',
      missingFields: missing,
    };
  }

  // Only a missing-field car with a detail page actually spends a live fetch;
  // guard the budget around that case so we don't defer cars we wouldn't fetch.
  const missing = missingListingFields(listing);
  const willFetch = missing.length > 0 && !!listing.url;
  if (willFetch && fetchBudget && !fetchBudget.tryConsume()) {
    return { listing, enrichStatus: 'enrich_pending', missingFields: missing };
  }

  const result = await enrichListing(listing);
  if (result.enrichStatus !== 'enrich_pending') {
    const { co2GKm, powerKw, displacementCm3 } = result.listing;
    setCached('listings_cache', key, { co2GKm, powerKw, displacementCm3 }, now);
  }
  return result;
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
    const { listing: enriched } = await enrichOneCached(listing, { now });
    enrichedById.set(listing.id, enriched);
  });

  return listings.map((l) => enrichedById.get(l.id) ?? l);
}

async function searchAs24Cached(filters, cfg, referenceYear, now, sweep = {}) {
  const sort = sweep.sort ?? 'standard';
  const desc = sweep.desc ?? 0;
  const maxResults = sweep.maxResults ?? cfg.maxResults;
  const key = cacheKey(filters, { sort, desc });
  let listings = getCached('listings_cache', key, cfg.cacheTtlMs, now);
  if (!listings) {
    listings = await searchAutoScout24(filters, {
      maxResults,
      country: cfg.autoscout24Country,
      requestDelayMs: cfg.requestDelayMs,
      referenceYear,
      sort,
      desc,
    });
    setCached('listings_cache', key, listings, now);
  }
  return listings
    .map((l) => ({ ...l, source: 'autoscout24' }))
    .filter((l) => matchesFilters(l, filters));
}

/**
 * Fetch the full pool of matching listings (search cards), deduped and tagged
 * by source — but NOT yet enriched with detail-page CO₂. Enrichment (a detail
 * fetch per listing) and the PT comparison are the expensive steps, so the route
 * runs them only for the page it's about to show (see enrichListingsDirect).
 *
 * @param {object} filters  see PLAN.md §3
 * @param {object} [opts]   { now } epoch ms (testability); { sort, desc,
 *   maxResults } let the batch sweep rotate AS24 sort orders and page deeper
 *   than a UI request would (see jobs/ingestDeals.js).
 * @returns {Promise<object[]>} normalised, filtered, deduped pool tagged with
 *   source (autoscout24, plus mobilede when a key is saved)
 */
export async function searchListingsDirect(filters = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const referenceYear = filters.referenceYear ?? new Date(now).getFullYear();
  const cfg = getDirectConfig();
  const sweep = { sort: opts.sort, desc: opts.desc, maxResults: opts.maxResults };

  // One blocked/failing source shouldn't sink the search — collect what works.
  const [as24, mobilede] = await Promise.allSettled([
    searchAs24Cached(filters, cfg, referenceYear, now, sweep),
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

  return dedupeListings([
    ...(as24.status === 'fulfilled' ? as24.value : []),
    ...(mobilede.status === 'fulfilled' ? mobilede.value : []),
  ]);
}

/**
 * Fill in detail-page CO₂ (and exact kW/displacement) for a *subset* of
 * listings — called by the route on just the page being shown, so detail
 * fetches scale with what the user actually views, not the whole pool. Only
 * AutoScout24 listings are enrichable; everything else passes through. Each
 * detail is cached 7 days (specs never change).
 *
 * @param {object[]} listings  the page slice to enrich
 * @param {object} [opts]      { now } epoch ms (testability)
 */
export async function enrichListingsDirect(listings, opts = {}) {
  const now = opts.now ?? Date.now();
  return enrichMissingCo2(listings, getDirectConfig(), now);
}
