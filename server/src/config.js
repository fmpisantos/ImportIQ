// Runtime configuration & credentials.
//
// Values resolve in priority order: **Settings UI (SQLite) → environment
// (.env) → built-in default**. The Settings page (`/api/settings`) writes
// overrides into the `runtime.*` rows of `active_settings`, so the data source
// and credentials can be changed from the browser without editing `.env` or
// restarting the server. Anything not set in the UI falls back to the
// environment, then to a sensible default.
//
// `DATA_SOURCE` selects which adapter implementation the search and comparison
// endpoints use:
//
//   mock      → deterministic sample data (default; no credentials needed)
//   direct    → keyless live scraping: AutoScout24 listings + OLX.pt comparison
//   official  → real mobile.de Search API + official PT source
//   apify     → live mobile.de + AutoScout24 + AutoUncle via Apify scrapers
//
// The app intentionally defaults to `mock` so it runs end-to-end before any
// accounts/keys exist. `direct` needs no credentials either — flip to it from
// the Settings page for real data, or to `official`/`apify` once keys are set.

import { getRuntimeSettings } from './db.js';

// Read a UI override (stored in SQLite) for `key`, falling back to the supplied
// env/default value when the override is unset/blank. Read fresh every call so a
// settings change takes effect on the next request — no restart.
function rt(key, fallback) {
  const v = getRuntimeSettings()[key];
  return v != null && v !== '' ? v : fallback;
}

const bool = (v, dflt) => (v == null || v === '' ? dflt : /^(1|true|yes)$/i.test(v));

/** The active data-source mode: 'mock' | 'direct' | 'official' | 'apify'. */
export function getDataSource() {
  return String(rt('data_source', process.env.DATA_SOURCE ?? 'direct')).toLowerCase();
}

export const isOfficial = () => getDataSource() === 'official';
export const isApify = () => getDataSource() === 'apify';

// --- Direct (keyless scraping: AutoScout24 pages + OLX.pt public API) -------
export function getDirectConfig() {
  return {
    // Max listings to pull per search (AS24 serves 20 per page).
    maxResults: Number(rt('direct_max_results', process.env.DIRECT_MAX_RESULTS ?? 60)),
    // Cache each filter-set's results this long.
    cacheTtlMs: Number(process.env.DIRECT_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000),
    // Pause between successive search-page fetches (politeness).
    requestDelayMs: Number(process.env.DIRECT_REQUEST_DELAY_MS ?? 300),
    // Cap detail-page fetches per search when filling in missing CO₂.
    enrichLimit: Number(process.env.DIRECT_ENRICH_LIMIT ?? 25),
    // AutoScout24 search country code (D = Germany).
    autoscout24Country: process.env.DIRECT_AS24_COUNTRY ?? 'D',
  };
}

export function getMobiledeConfig() {
  return {
    baseUrl: process.env.MOBILEDE_BASE_URL ?? 'https://services.mobile.de/search-api',
    username: rt('mobilede_user', process.env.MOBILEDE_USER ?? null),
    password: rt('mobilede_pass', process.env.MOBILEDE_PASS ?? null),
  };
}

// --- Apify (live scraping of mobile.de / AutoScout24 / AutoUncle) -----------
// Each site is scraped by an Apify Actor. Actor ids and per-site options can be
// overridden via env; sensible defaults point at maintained Store actors.
export function getApifyConfig() {
  const sites = String(rt('apify_sites', process.env.APIFY_SITES ?? 'mobilede,autoscout24,autouncle'))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    token: rt('apify_token', process.env.APIFY_TOKEN ?? null),
    // Which sites to query, in order.
    sites,
    // Route actor traffic through Apify Proxy to beat anti-bot (recommended).
    useProxy: bool(rt('apify_use_proxy', process.env.APIFY_USE_PROXY), true),
    // Max listings to pull per site per search.
    maxResults: Number(rt('apify_max_per_site', process.env.APIFY_MAX_PER_SITE ?? 50)),
    // Abort a single actor run after this long.
    runTimeoutMs: Number(process.env.APIFY_RUN_TIMEOUT_MS ?? 120000),
    // Cache each site's results per filter-set this long (default 6h) to avoid
    // re-paying for identical searches.
    cacheTtlMs: Number(process.env.APIFY_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000),

    // Per-site actor ids + options. Override the actor only if you prefer another.
    actors: {
      // Pay-per-result variant ($0.80/1k results) — works with just a token, no
      // monthly rental. The same dev's '3x1t/mobile-de-scraper' is a $9.99/month
      // rental + compute, cheaper only above ~20k results/month.
      mobilede: process.env.APIFY_MOBILEDE_ACTOR ?? '3x1t/mobile-de-scraper-ppr',
      autoscout24: process.env.APIFY_AUTOSCOUT24_ACTOR ?? 'automation-lab/autoscout24-scraper',
      autouncle: process.env.APIFY_AUTOUNCLE_ACTOR ?? 'lofomachines/autouncle-scraper',
    },
    // AutoScout24 search country code (D = Germany).
    autoscout24Country: process.env.APIFY_AUTOSCOUT24_COUNTRY ?? 'D',
    // AutoUncle locale path; pair the base domain with its localized list segment.
    autouncleBaseUrl: process.env.APIFY_AUTOUNCLE_BASE_URL ?? 'https://www.autouncle.de',
    autouncleListPath: process.env.APIFY_AUTOUNCLE_LIST_PATH ?? '/de/gebrauchtwagen',

    /** Resolved per-site config object passed to a site adapter's buildInput(). */
    siteConfig(siteKey) {
      const base = { actorId: this.actors[siteKey], maxResults: this.maxResults };
      if (siteKey === 'autoscout24') return { ...base, country: this.autoscout24Country };
      if (siteKey === 'autouncle') {
        return { ...base, baseUrl: this.autouncleBaseUrl, listPath: this.autouncleListPath };
      }
      return base;
    },
  };
}

export function getPtMarketConfig() {
  return {
    // 'olx' | 'standvirtual' — which official PT source to query. Read access for
    // market comparison is provider-dependent (see README); both are wired so the
    // working one can be selected without code changes.
    provider: String(rt('pt_provider', process.env.PT_PROVIDER ?? 'olx')).toLowerCase(),
    olx: {
      baseUrl: process.env.OLX_BASE_URL ?? 'https://api.olxgroup.com',
      apiKey: rt('olx_api_key', process.env.OLX_API_KEY ?? null),
    },
    standvirtual: {
      baseUrl: process.env.STANDVIRTUAL_BASE_URL ?? 'https://www.standvirtual.com/api',
      token: rt('standvirtual_token', process.env.STANDVIRTUAL_TOKEN ?? null),
    },
  };
}

// How long PT market comparisons stay fresh in the cache (PLAN.md §9: PT prices
// are slow-moving, refreshed daily).
export function getPtCacheTtlMs() {
  return Number(process.env.PT_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
}

/**
 * Throw a clear, actionable error if a real mode is selected without the
 * credentials a given adapter needs. Called lazily by the real adapters so the
 * mock path never requires any of this.
 */
export function requireCreds(label, values) {
  const missing = Object.entries(values)
    .filter(([, v]) => v == null || v === '')
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `DATA_SOURCE=${getDataSource()} but ${label} credentials are missing: ${missing.join(
        ', '
      )}. Set them on the Settings page (or in .env), or switch the data source to mock.`
    );
  }
}
