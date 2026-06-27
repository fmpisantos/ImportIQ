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
import {
  searchAutoScout24,
  fetchAutoScout24Page,
  enrichListing,
  PAGE_SIZE as AS24_PAGE_SIZE,
  MAX_PAGES as AS24_MAX_PAGES,
} from './direct/autoscout24.js';
import { searchSiteApify } from './apifySearch.js';
import { searchListingsViaOfficialApi } from './mobilede.js';
import { missingListingFields, missingTaxRefinements } from '../engine/landedCost.js';

/** An AS24 listing whose detail page could fill a required field OR a tax refinement. */
function needsDetailFetch(l) {
  return (
    l.source === 'autoscout24' &&
    !!l.url &&
    (missingListingFields(l).length > 0 || missingTaxRefinements(l).length > 0)
  );
}

// A listing's published specs are immutable — cache enriched details for long.
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A scraped result page is short-lived inventory — re-scrape similar searches at
// most every 12h (per filter-set AND page; see searchListingsDirectPage).
const LIVE_PAGE_TTL_MS = 12 * 60 * 60 * 1000;

// The filter fields that actually change AutoScout24's result set. Shared by the
// pool cache and the per-page live cache so identical searches collapse to one
// key; `extra` carries sort/desc (and the page for the live cache).
function relevantFilters(filters, extra = {}) {
  return {
    brand: filters.brand ?? null,
    model: filters.model ?? null,
    bodyType: filters.bodyType ?? null,
    priceMin: filters.priceMin ?? null,
    priceMax: filters.priceMax ?? null,
    yearFrom: filters.yearFrom ?? null,
    maxMileageKm: filters.maxMileageKm ?? null,
    fuelTypes: [...(filters.fuelTypes ?? [])].sort(),
    transmission: filters.transmission ?? null,
    ...extra,
  };
}

function cacheKey(filters, { sort = 'standard', desc = 0 } = {}) {
  // Each sort order surfaces a different result window, so they cache apart.
  return `direct:autoscout24:${JSON.stringify(relevantFilters(filters, { sort, desc }))}`;
}

function livePageCacheKey(filters, { sort = 'standard', desc = 0, page = 1, pageSize = 50 } = {}) {
  // The page is part of the key — paging Next re-scrapes a *different* window,
  // but re-opening the same page within 12h is served from cache.
  return `direct:as24:livepage:${JSON.stringify(relevantFilters(filters, { sort, desc, page, pageSize }))}`;
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

  // Only a car a detail fetch could actually improve (missing required field or
  // tax refinement) spends a fetch; guard the budget around that case.
  const missing = missingListingFields(listing);
  const willFetch = (missing.length > 0 || missingTaxRefinements(listing).length > 0) && !!listing.url;
  if (willFetch && fetchBudget && !fetchBudget.tryConsume()) {
    return { listing, enrichStatus: 'enrich_pending', missingFields: missing };
  }

  const result = await enrichListing(listing);
  if (result.enrichStatus !== 'enrich_pending') {
    // Persist every field the detail fetch can fill — not just CO₂ — so a cache
    // hit reconstructs the full ISV/VAT input set (month, particles, EV regime).
    const {
      co2GKm, powerKw, displacementCm3,
      firstRegMonth, electricRangeKm, particleEmissionsGKm, qualifiesForEvRegime,
    } = result.listing;
    setCached(
      'listings_cache',
      key,
      { co2GKm, powerKw, displacementCm3, firstRegMonth, electricRangeKm, particleEmissionsGKm, qualifiesForEvRegime },
      now
    );
  }
  return result;
}

async function enrichMissingCo2(listings, cfg, now) {
  // Only AutoScout24 listings can be enriched from their detail page; don't
  // let other sources' gaps eat the enrich budget. A car qualifies when the
  // detail page could fill a required field (CO₂/displacement) or a tax
  // refinement (diesel particles, PHEV range).
  const needs = listings.filter(needsDetailFetch);
  const targets = needs.slice(0, cfg.enrichLimit);
  if (needs.length > targets.length) {
    console.warn(
      `[direct] ${needs.length} listings need detail enrichment; enriching first ${targets.length} (DIRECT_ENRICH_LIMIT)`
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

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** The AS24 native page numbers that make up UI page `uiPage` (1-based). */
function as24PagesForUiPage(uiPage, pagesPerUiPage) {
  const start = (uiPage - 1) * pagesPerUiPage + 1;
  const out = [];
  for (let i = 0; i < pagesPerUiPage; i++) {
    const p = start + i;
    if (p > AS24_MAX_PAGES) break; // AS24 won't serve past page 20
    out.push(p);
  }
  return out;
}

/**
 * Scrape the contiguous block of AS24 native pages that backs one UI page,
 * concatenating their cards. Carries AS24's result totals from whichever page
 * reported them. If the first page comes back empty for a brand+model search,
 * the model slug was probably wrong — retry the whole window brand-only and let
 * the post-filter narrow by model (mirrors searchAutoScout24's fallback).
 */
async function fetchAs24Window(filters, { pageNums, sort, desc, country, requestDelayMs, referenceYear }) {
  const listings = [];
  let numberOfResults = null;
  let numberOfPages = null;
  let includeModel = true;

  for (let idx = 0; idx < pageNums.length; idx++) {
    const opts = { page: pageNums[idx], sort, desc, country, referenceYear, includeModel };
    let res = await fetchAutoScout24Page(filters, opts);
    if (idx === 0 && !res.listings.length && includeModel && filters.brand && filters.model) {
      includeModel = false;
      res = await fetchAutoScout24Page(filters, { ...opts, includeModel });
    }
    if (res.numberOfResults != null) numberOfResults = res.numberOfResults;
    if (res.numberOfPages != null) numberOfPages = res.numberOfPages;
    listings.push(...res.listings);
    // A page can legitimately map to <20 listings (AS24 interleaves sponsored /
    // OCS cards that drop out), so only an *empty* page means we've run past the
    // end — breaking on "<20" would skip the rest of the window.
    if (!res.listings.length) break;
    if (idx < pageNums.length - 1) await sleep(requestDelayMs);
  }
  return { listings, numberOfResults, numberOfPages };
}

/**
 * True paginated live search: scrape only the page the UI asked for (a window of
 * AS24 native pages), cached per filter-set AND page for 12h. Unlike
 * searchListingsDirect (fetch a pool, slice), paging Next reaches deeper
 * inventory instead of re-reading the same top cards — up to AS24's 20-page /
 * 400-card hard cap.
 *
 * mobile.de (when a key is saved) isn't page-addressable here, so it joins only
 * on page 1 to avoid repeating its listings on every page.
 *
 * @param {object} filters  see PLAN.md §3
 * @param {object} [opts]   { now, page, pageSize, sort, desc }
 * @returns {Promise<{ listings, page, pageSize, totalPages, totalResults }>}
 */
export async function searchListingsDirectPage(filters = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const referenceYear = filters.referenceYear ?? new Date(now).getFullYear();
  const cfg = getDirectConfig();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 50));
  const sort = opts.sort ?? 'standard';
  const desc = opts.desc === 1 || opts.desc === '1' ? 1 : 0;
  const pagesPerUiPage = Math.max(1, Math.round(pageSize / AS24_PAGE_SIZE));

  // 12h cache, keyed by filters + sort + page (the expensive part is the scrape;
  // landed-cost + PT comparison are recomputed per request against live config).
  const key = livePageCacheKey(filters, { sort, desc, page, pageSize });
  let window = getCached('listings_cache', key, LIVE_PAGE_TTL_MS, now);
  if (!window) {
    const pageNums = as24PagesForUiPage(page, pagesPerUiPage);
    window = await fetchAs24Window(filters, {
      pageNums,
      sort,
      desc,
      country: cfg.autoscout24Country,
      requestDelayMs: cfg.requestDelayMs,
      referenceYear,
    });
    setCached('listings_cache', key, window, now);
  }

  let listings = window.listings
    .map((l) => ({ ...l, source: 'autoscout24' }))
    .filter((l) => matchesFilters(l, filters));

  // mobile.de joins page 1 only (not page-addressable through this path).
  if (page === 1) {
    try {
      listings = listings.concat(await searchMobilede(filters, referenceYear, now));
    } catch {
      /* one source failing shouldn't sink the page */
    }
  }

  // AS24 reports a generous numberOfPages but only serves the first 20 — clamp
  // the reachable pages to that so the UI's Next button stops at real inventory.
  const reachablePages = Math.min(AS24_MAX_PAGES, window.numberOfPages ?? AS24_MAX_PAGES);
  const totalPages = Math.max(1, Math.ceil(reachablePages / pagesPerUiPage));
  return {
    listings: dedupeListings(listings),
    page,
    pageSize,
    totalPages,
    totalResults: window.numberOfResults ?? listings.length,
  };
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
