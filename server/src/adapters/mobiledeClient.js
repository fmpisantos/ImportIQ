// mobile.de Search API HTTP client. Handles auth, pagination, and the refdata
// (make/model) lookup. Node 22 provides global `fetch`, so no HTTP dependency
// is needed. Pure mapping lives in ./mobiledeMap.js.

import { mobiledeConfig, requireCreds } from '../config.js';
import { buildSearchParams, mapAd } from './mobiledeMap.js';

const ACCEPT_JSON = 'application/vnd.de.mobile.api+json';
const PAGE_SIZE = 100; // API max
const MAX_ADS = 2000; // API hard cap across paginated pages

function authHeader() {
  const { username, password } = mobiledeConfig;
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

async function apiGet(path, params) {
  requireCreds('mobile.de', {
    MOBILEDE_USER: mobiledeConfig.username,
    MOBILEDE_PASS: mobiledeConfig.password,
  });
  const qs = params ? `?${params.toString()}` : '';
  const res = await fetch(`${mobiledeConfig.baseUrl}${path}${qs}`, {
    headers: { Authorization: authHeader(), Accept: ACCEPT_JSON },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mobile.de ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// The search response wraps ads under different keys across API versions; be
// tolerant about where the array lives and the total count.
function extractAds(payload) {
  return (
    payload?.ads?.ad ??
    payload?.searchResult?.ads?.ad ??
    payload?.ads ??
    payload?.items ??
    []
  );
}
function extractTotal(payload) {
  return Number(payload?.total ?? payload?.searchResult?.total ?? 0) || null;
}

/**
 * Resolve a brand (+ optional model) to a mobile.de `classification` refdata
 * path using the cached make/model tree. Returns null when the brand is unknown
 * (the search then runs unclassified / by other filters).
 *
 * @param {object} tree   refdata tree: { [makeName]: { key, models: { [modelName]: key } } }
 */
export function resolveClassification(tree, brand, model) {
  if (!brand || !tree) return null;
  const make = tree[brand] ?? tree[brand?.toUpperCase()];
  if (!make) return null;
  let path = `refdata/classes/Car/makes/${make.key}`;
  if (model) {
    const modelKey = make.models?.[model] ?? make.models?.[model?.toUpperCase()];
    if (modelKey) path += `/models/${modelKey}`;
  }
  return path;
}

/**
 * Fetch the make/model reference-data tree from mobile.de. Slow-moving data —
 * callers should cache it (see db.js refdata_cache). Shape:
 *   { [makeName]: { key, models: { [modelName]: modelKey } } }
 */
export async function fetchRefdataTree() {
  const makesPayload = await apiGet('/refdata/classes/Car/makes');
  const makes = makesPayload?.makes?.make ?? makesPayload?.makes ?? [];
  const tree = {};
  for (const m of makes) {
    const name = m.name ?? m.localized ?? m.key;
    tree[name] = { key: m.key, models: {} };
    try {
      const modelsPayload = await apiGet(`/refdata/classes/Car/makes/${m.key}/models`);
      const models = modelsPayload?.models?.model ?? modelsPayload?.models ?? [];
      for (const md of models) {
        tree[name].models[md.name ?? md.localized ?? md.key] = md.key;
      }
    } catch {
      // A single make's models failing shouldn't sink the whole tree.
    }
  }
  return tree;
}

/**
 * Search listings against the live API.
 *
 * @param {object} filters
 * @param {object} opts
 * @param {object} [opts.refdataTree]   cached make/model tree for classification
 * @param {number} [opts.referenceYear] year for ageYears (default current year)
 * @returns {Promise<object[]>} normalised listings
 */
export async function searchListingsOfficial(filters = {}, opts = {}) {
  const { refdataTree = null, referenceYear = new Date().getFullYear() } = opts;
  const classification = resolveClassification(refdataTree, filters.brand, filters.model);

  const collected = [];
  let pageNumber = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = buildSearchParams(filters, classification);
    params.set('page.number', String(pageNumber));
    params.set('page.size', String(PAGE_SIZE));

    const payload = await apiGet('/search', params);
    const ads = extractAds(payload);
    for (const ad of ads) collected.push(mapAd(ad, referenceYear));

    const total = extractTotal(payload);
    const reachedEnd = ads.length < PAGE_SIZE;
    if (reachedEnd || collected.length >= Math.min(total ?? MAX_ADS, MAX_ADS)) break;
    pageNumber += 1;
  }

  // Model is matched via classification when known; apply a defensive
  // client-side model filter when only free-text was provided.
  if (filters.model && !classification) {
    const needle = filters.model.toLowerCase();
    return collected.filter((l) => String(l.model ?? '').toLowerCase().includes(needle));
  }
  return collected;
}
