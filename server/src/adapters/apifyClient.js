// Thin Apify REST client. Runs an Actor and returns its dataset items in one
// call via the run-sync-get-dataset-items endpoint, so callers don't have to
// poll for run status. Node 22 provides global `fetch`.
//
// Docs: https://docs.apify.com/api/v2#/reference/actors/run-actor-synchronously-with-input-and-get-dataset-items

import { getApifyConfig, requireCreds } from '../config.js';

const BASE_URL = 'https://api.apify.com/v2';

/**
 * Run an Apify Actor synchronously and return its default dataset items.
 *
 * @param {string} actorId   e.g. "3x1t/mobile-de-scraper" (slash is URL-encoded for us)
 * @param {object} input     the actor's input object (its own schema)
 * @param {object} [opts]
 * @param {number} [opts.maxItems]   cap items pulled from the dataset
 * @param {number} [opts.timeoutMs]  abort the HTTP call after this long
 * @returns {Promise<object[]>} dataset items (raw, unmapped)
 */
export async function runActor(actorId, input, opts = {}) {
  const apifyConfig = getApifyConfig();
  requireCreds('Apify', { APIFY_TOKEN: apifyConfig.token });

  const { maxItems, timeoutMs = apifyConfig.runTimeoutMs } = opts;
  // Actor id in the path uses `~` instead of `/` (user~actor-name).
  const actorPath = String(actorId).replace('/', '~');
  const params = new URLSearchParams({ token: apifyConfig.token });
  if (maxItems != null) params.set('maxItems', String(maxItems));
  // Cap the server-side run too, so a slow actor can't hang the request.
  params.set('timeout', String(Math.ceil((timeoutMs ?? 120000) / 1000)));

  const url = `${BASE_URL}/acts/${actorPath}/run-sync-get-dataset-items?${params}`;

  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify actor ${actorId} failed (${res.status}): ${body.slice(0, 400)}`);
    }
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Apify actor ${actorId} timed out after ${timeoutMs} ms`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Apify standard proxy config object, or undefined when disabled. */
export function proxyInput() {
  return getApifyConfig().useProxy ? { useApifyProxy: true } : undefined;
}
