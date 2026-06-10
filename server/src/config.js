// Runtime configuration & credentials.
//
// All secrets come from the environment (see .env.example) — nothing is
// hardcoded. `DATA_SOURCE` selects which adapter implementation the search and
// comparison endpoints use:
//
//   mock      → deterministic sample data (default; no credentials needed)
//   official  → real mobile.de Search API + official PT source
//   apify     → live mobile.de + AutoScout24 + AutoUncle via Apify scrapers
//
// The app intentionally defaults to `mock` so it runs end-to-end before any
// accounts/keys exist. Flip to `official` or `apify` once credentials are set.

export const DATA_SOURCE = (process.env.DATA_SOURCE ?? 'mock').toLowerCase();

export const isOfficial = DATA_SOURCE === 'official';
export const isApify = DATA_SOURCE === 'apify';

export const mobiledeConfig = {
  baseUrl: process.env.MOBILEDE_BASE_URL ?? 'https://services.mobile.de/search-api',
  username: process.env.MOBILEDE_USER ?? null,
  password: process.env.MOBILEDE_PASS ?? null,
};

// --- Apify (live scraping of mobile.de / AutoScout24 / AutoUncle) -----------
// Each site is scraped by an Apify Actor. Actor ids and per-site options can be
// overridden via env; sensible defaults point at maintained Store actors.
const bool = (v, dflt) => (v == null || v === '' ? dflt : /^(1|true|yes)$/i.test(v));

export const apifyConfig = {
  token: process.env.APIFY_TOKEN ?? null,
  // Which sites to query, in order. Comma-separated env overrides the default.
  sites: (process.env.APIFY_SITES ?? 'mobilede,autoscout24,autouncle')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // Route actor traffic through Apify Proxy to beat anti-bot (recommended).
  useProxy: bool(process.env.APIFY_USE_PROXY, true),
  // Max listings to pull per site per search.
  maxResults: Number(process.env.APIFY_MAX_PER_SITE ?? 50),
  // Abort a single actor run after this long.
  runTimeoutMs: Number(process.env.APIFY_RUN_TIMEOUT_MS ?? 120000),
  // Cache each site's results per filter-set this long (default 6h) to avoid
  // re-paying for identical searches.
  cacheTtlMs: Number(process.env.APIFY_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000),

  // Per-site actor ids + options. Override the actor only if you prefer another.
  actors: {
    mobilede: process.env.APIFY_MOBILEDE_ACTOR ?? '3x1t/mobile-de-scraper',
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

export const ptMarketConfig = {
  // 'olx' | 'standvirtual' — which official PT source to query. Read access for
  // market comparison is provider-dependent (see README); both are wired so the
  // working one can be selected without code changes.
  provider: (process.env.PT_PROVIDER ?? 'olx').toLowerCase(),
  olx: {
    baseUrl: process.env.OLX_BASE_URL ?? 'https://api.olxgroup.com',
    apiKey: process.env.OLX_API_KEY ?? null,
  },
  standvirtual: {
    baseUrl: process.env.STANDVIRTUAL_BASE_URL ?? 'https://www.standvirtual.com/api',
    token: process.env.STANDVIRTUAL_TOKEN ?? null,
  },
};

// How long PT market comparisons stay fresh in the cache (PLAN.md §9: PT prices
// are slow-moving, refreshed daily).
export const PT_CACHE_TTL_MS = Number(process.env.PT_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);

/**
 * Throw a clear, actionable error if `official` mode is selected without the
 * credentials a given adapter needs. Called lazily by the real adapters so the
 * mock path never requires any of this.
 */
export function requireCreds(label, values) {
  const missing = Object.entries(values)
    .filter(([, v]) => v == null || v === '')
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `DATA_SOURCE=${DATA_SOURCE} but ${label} credentials are missing: ${missing.join(
        ', '
      )}. Set them in your environment (see .env.example) or use DATA_SOURCE=mock.`
    );
  }
}
