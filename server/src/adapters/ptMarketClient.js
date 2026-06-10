// Portuguese market client — fetches comparable listings from an official PT
// source and reduces them to an average asking price. Pure averaging logic
// (`summarise`) is separated from I/O so it can be unit-tested with fixtures.
//
// IMPORTANT — read-access caveat (see README): the official PT APIs (OLX
// Portugal Partner API, Standvirtual API) are primarily for managing your OWN
// ads. Whether they permit searching OTHER sellers' listings for market
// comparison must be confirmed per account. The request/response shapes below
// are best-effort and tolerant; adjust the field paths once the granted API's
// real schema is known.

import { ptMarketConfig, requireCreds } from '../config.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** PLAN.md §5 comparison window: same brand+model, year ±1, mileage ±20,000 km. */
export function comparisonCriteria(listing) {
  return {
    brand: listing.brand,
    model: listing.model,
    yearRange: [listing.year - 1, listing.year + 1],
    mileageRangeKm: [Math.max(0, listing.mileageKm - 20000), listing.mileageKm + 20000],
  };
}

/**
 * Reduce a set of comparable PT listings to the comparison object the rest of
 * the app expects. Pure — unit-testable.
 *
 * @param {Array<{priceEur:number}>} listings
 * @param {string} source
 * @param {object} criteria
 * @returns {{ avgPriceEur: number|null, sampleSize: number, source: string, criteria: object }}
 */
export function summarise(listings, source, criteria) {
  const prices = listings
    .map((l) => Number(l.priceEur ?? l.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  return { avgPriceEur: avg, sampleSize: prices.length, source, criteria };
}

async function httpGetJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PT market request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// --- OLX Portugal ----------------------------------------------------------
async function fetchOlx(listing, criteria) {
  const { baseUrl, apiKey } = ptMarketConfig.olx;
  requireCreds('OLX', { OLX_API_KEY: apiKey });
  const params = new URLSearchParams({
    category: 'cars',
    query: `${listing.brand} ${listing.model}`.trim(),
    'year.from': String(criteria.yearRange[0]),
    'year.to': String(criteria.yearRange[1]),
    'mileage.to': String(criteria.mileageRangeKm[1]),
    limit: '50',
  });
  const payload = await httpGetJson(`${baseUrl}/listings?${params}`, {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  });
  const items = payload?.data ?? payload?.listings ?? payload?.items ?? [];
  return items.map((it) => ({ priceEur: it.price?.value ?? it.price?.amount ?? it.price }));
}

// --- Standvirtual ----------------------------------------------------------
async function fetchStandvirtual(listing, criteria) {
  const { baseUrl, token } = ptMarketConfig.standvirtual;
  requireCreds('Standvirtual', { STANDVIRTUAL_TOKEN: token });
  const params = new URLSearchParams({
    make: listing.brand ?? '',
    model: listing.model ?? '',
    'firstRegistrationYear.from': String(criteria.yearRange[0]),
    'firstRegistrationYear.to': String(criteria.yearRange[1]),
    'mileage.to': String(criteria.mileageRangeKm[1]),
  });
  const payload = await httpGetJson(`${baseUrl}/listings?${params}`, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'ImportIQ/0.1',
  });
  const items = payload?.adverts ?? payload?.results ?? payload?.data ?? [];
  return items.map((it) => ({ priceEur: it.price?.amount ?? it.price?.value ?? it.price }));
}

/**
 * Live PT comparison for one listing.
 * @returns {Promise<object>} comparison object (see summarise)
 */
export async function getComparisonOfficial(listing) {
  const criteria = comparisonCriteria(listing);
  const provider = ptMarketConfig.provider;
  const items =
    provider === 'standvirtual'
      ? await fetchStandvirtual(listing, criteria)
      : await fetchOlx(listing, criteria);
  return summarise(items, `official:${provider}`, criteria);
}
