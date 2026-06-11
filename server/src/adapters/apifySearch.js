// Multi-site search via Apify (DATA_SOURCE=apify).
//
// Runs each enabled site's actor in parallel, maps every result into the
// normalised listing shape, applies a defensive post-filter so the user only
// ever sees listings that actually match their filters, dedups, and tags each
// listing with its `source`. Per-site results are cached in SQLite so repeated
// searches don't re-pay Apify.

import { getApifyConfig } from '../config.js';
import { runActor } from './apifyClient.js';
import { getCached, setCached } from '../db.js';
import { matchesFilters } from './normalize.js';
import * as mobilede from './sites/mobilede.js';
import * as autoscout24 from './sites/autoscout24.js';
import * as autouncle from './sites/autouncle.js';

const SITES = { mobilede, autoscout24, autouncle };

// Only the fields that change the result set belong in the cache key.
function cacheKey(siteKey, filters) {
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
  return `apify:${siteKey}:${JSON.stringify(relevant)}`;
}

async function searchSite(site, filters, referenceYear, now) {
  const apifyConfig = getApifyConfig();
  const siteCfg = apifyConfig.siteConfig(site.key);
  const key = cacheKey(site.key, filters);

  const cached = getCached('listings_cache', key, apifyConfig.cacheTtlMs, now);
  let raw = cached;
  if (!raw) {
    const input = site.buildInput(filters, siteCfg);
    raw = await runActor(siteCfg.actorId, input, { maxItems: siteCfg.maxResults });
    setCached('listings_cache', key, raw, now);
  }

  return raw
    .map((item) => ({ ...site.mapItem(item, referenceYear), source: site.key }))
    .filter((listing) => matchesFilters(listing, filters));
}

/**
 * @param {object} filters  see PLAN.md §3
 * @param {object} [opts]   { now } epoch ms (testability)
 * @returns {Promise<object[]>} normalised, filtered, deduped listings
 */
export async function searchListingsApify(filters = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const referenceYear = filters.referenceYear ?? new Date(now).getFullYear();

  const enabled = getApifyConfig()
    .sites.map((k) => SITES[k])
    .filter(Boolean);

  // One slow/blocked site shouldn't sink the whole search — collect what works.
  const settled = await Promise.allSettled(
    enabled.map((site) => searchSite(site, filters, referenceYear, now))
  );

  const listings = [];
  const errors = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') listings.push(...r.value);
    else errors.push(`${enabled[i].key}: ${r.reason?.message ?? r.reason}`);
  }
  if (errors.length) console.warn('[apify] some sources failed:', errors.join('; '));
  // All sources failed → surface it rather than returning a silent empty list.
  if (!listings.length && errors.length === enabled.length) {
    throw new Error(`All Apify sources failed. ${errors.join('; ')}`);
  }

  return dedupe(listings);
}

// Drop obvious cross-source duplicates (AutoUncle aggregates the others). Key on
// brand+model+year+price+mileage; first occurrence wins.
function dedupe(listings) {
  const seen = new Set();
  const out = [];
  for (const l of listings) {
    const k = [l.brand, l.model, l.year, l.priceEur, l.mileageKm]
      .map((v) => String(v ?? '').toLowerCase())
      .join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}
