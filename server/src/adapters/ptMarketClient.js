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

import { getPtMarketConfig, requireCreds } from '../config.js';
import { normalizeModelKey } from './normalize.js';

const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s ?? '').trim().toLowerCase();

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
 * Every listing that carries a `url` (and optionally `title`) is surfaced in
 * `sampleListings` so the UI can show each PT comparable behind the average.
 *
 * @param {Array<{priceEur:number, url?:string, title?:string}>} listings
 * @param {string} source
 * @param {object} criteria
 * @returns {{ avgPriceEur: number|null, sampleSize: number, source: string,
 *             criteria: object,
 *             sampleListings: Array<{priceEur:number, url:string, title?:string}> }}
 */
export function summarise(listings, source, criteria) {
  const valid = listings
    .map((l) => ({ ...l, priceEur: Number(l.priceEur ?? l.price) }))
    .filter((l) => Number.isFinite(l.priceEur) && l.priceEur > 0);
  const avg = valid.length
    ? round2(valid.reduce((a, l) => a + l.priceEur, 0) / valid.length)
    : null;
  const sampleListings = valid
    .filter((l) => typeof l.url === 'string' && l.url)
    .map((l) => ({ priceEur: l.priceEur, url: l.url, ...(l.title ? { title: l.title } : {}) }));
  return { avgPriceEur: avg, sampleSize: valid.length, source, criteria, sampleListings };
}

/**
 * Drop price outliers from a comparable set using the Tukey IQR fence
 * (prices outside [Q1 − 1.5·IQR, Q3 + 1.5·IQR]). Loose free-text searches drag
 * in non-comparable cars (a base 116 set polluted by an M4 at €50k); the fence
 * trims those without hand-tuned thresholds. Pure — unit-testable.
 *
 * No-ops below 4 priced items (too few to locate quartiles meaningfully) and
 * returns the input untouched. Once there are enough, only items with a valid
 * in-fence price survive — unpriced items wouldn't count toward the average
 * anyway, so dropping them here keeps the surfaced sample honest.
 *
 * @param {Array<{priceEur?:number, price?:number}>} items
 * @returns {Array} the subset within the IQR fence (or all, if too few)
 */
export function rejectPriceOutliers(items) {
  const priceOf = (l) => Number(l.priceEur ?? l.price);
  const valid = items.filter((l) => Number.isFinite(priceOf(l)) && priceOf(l) > 0);
  if (valid.length < 4) return items;

  const sorted = valid.map(priceOf).sort((a, b) => a - b);
  const quantile = (p) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;

  return items.filter((l) => {
    const p = priceOf(l);
    return Number.isFinite(p) && p > 0 && p >= low && p <= high;
  });
}

// --- Comparable matching (shared by every PT source) ------------------------

// A comparable matches the subject within these engine tolerances when BOTH
// sides publish the field; a missing field never drops the comparable.
const POWER_TOLERANCE = 0.2; // ±20% on engine power (kW)
const DISPLACEMENT_TOLERANCE = 0.15; // ±15% on displacement (cm³)

/** Symmetric tolerance check; null/zero on either side ⇒ pass (field-tolerant). */
function withinTolerance(a, b, tol) {
  if (a == null || b == null || !(a > 0) || !(b > 0)) return true;
  return Math.abs(a - b) <= tol * Math.max(a, b);
}

/**
 * Does a PT comparable actually match the subject listing? Narrows on model
 * family, fuel, transmission, engine power and displacement — but only on
 * fields BOTH sides publish (mirrors normalize.js#matchesFilters: we can't drop
 * a comparable for a field it doesn't expose). Model matching is lenient — the
 * listing's name and its stripped family key are both tried, and either
 * containing the other counts ("320d" listing ↔ OLX "320"). Pure.
 *
 * Comparable shape: { priceEur, model?, fuel?, transmission?, powerKw?,
 *   displacementCm3? }. The subject is a normalised listing (powerKw in kW).
 */
export function comparableMatches(c, listing) {
  if (listing.model && c.model) {
    const cm = norm(c.model);
    const candidates = [norm(listing.model), norm(normalizeModelKey(listing.model))];
    if (!candidates.some((x) => x && (cm.includes(x) || x.includes(cm)))) return false;
  }
  if (listing.fuelType && c.fuel && norm(c.fuel) !== norm(listing.fuelType)) return false;
  if (
    listing.transmission &&
    c.transmission &&
    norm(c.transmission) !== norm(listing.transmission)
  )
    return false;
  if (!withinTolerance(listing.powerKw, c.powerKw, POWER_TOLERANCE)) return false;
  if (!withinTolerance(listing.displacementCm3, c.displacementCm3, DISPLACEMENT_TOLERANCE))
    return false;
  return true;
}

/**
 * Is a comparable inside the PLAN §5 window (year ±1, mileage ±20k)? For
 * sources that can't constrain year/mileage server-side (scraped HTML). A
 * comparable missing the field passes (field-tolerant). Pure.
 */
export function withinComparisonWindow(c, criteria) {
  if (
    c.year != null &&
    (c.year < criteria.yearRange[0] || c.year > criteria.yearRange[1])
  )
    return false;
  if (
    c.mileageKm != null &&
    (c.mileageKm < criteria.mileageRangeKm[0] || c.mileageKm > criteria.mileageRangeKm[1])
  )
    return false;
  return true;
}

// --- Robust central estimate (median + mileage regression) ------------------

const priceVal = (l) => Number(l.priceEur ?? l.price);

/** Median of a numeric array (linear-interpolated midpoint), or null if empty. */
export function median(values) {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Predict price at `targetX` from {x,y} points via ordinary least squares.
 * Returns null (caller falls back) unless the fit is usable: enough points, a
 * negative slope (price must fall as mileage rises), and a minimum R². The
 * prediction is clamped to the observed price range so a steep fit can't
 * extrapolate to an absurd value. Pure — unit-testable.
 */
export function regressionEstimate(points, targetX, opts = {}) {
  const { minPoints = 6, minR2 = 0.15 } = opts;
  const pts = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0
  );
  if (pts.length < minPoints || !Number.isFinite(targetX)) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  if (slope >= 0) return null; // a non-negative km↔price slope is not a real signal
  const r2 = (sxy * sxy) / (sxx * syy);
  if (r2 < minR2) return null;
  const intercept = my - slope * mx;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const yhat = Math.max(lo, Math.min(hi, intercept + slope * targetX));
  return yhat > 0 ? round2(yhat) : null;
}

/**
 * Best central estimate of market value for the subject listing from a set of
 * comparables: a mileage regression predicted at the subject's mileage when the
 * fit is usable, else the median, else null. Returns the median too (always,
 * for display). Pure.
 *
 * @param {Array} items   comparables ({ priceEur, mileageKm? })
 * @param {object} listing  subject (uses listing.mileageKm)
 */
export function estimateMarketValue(items, listing = {}) {
  const prices = items.map(priceVal).filter((p) => Number.isFinite(p) && p > 0);
  if (!prices.length) {
    return { marketValueEur: null, marketValueMethod: 'none', medianPriceEur: null };
  }
  const med = round2(median(prices));
  const points = items
    .map((l) => ({ x: Number(l.mileageKm), y: priceVal(l) }))
    .filter((p) => Number.isFinite(p.x) && p.x >= 0);
  const reg = regressionEstimate(points, Number(listing.mileageKm));
  if (reg != null) {
    return { marketValueEur: reg, marketValueMethod: 'mileage-regression', medianPriceEur: med };
  }
  return { marketValueEur: med, marketValueMethod: 'median', medianPriceEur: med };
}

/**
 * Turn a set of matched comparables into the full comparison object every PT
 * source returns: IQR-trims, averages (mean, kept as `avgPriceEur` for
 * back-compat), adds the robust `marketValueEur` + method + median, the matched
 * criteria, and a low-confidence flag (< 5 comparables). Pure. Callers add any
 * source-specific extras (searchUrl, per-source breakdown). Pure.
 */
export function finalizeComparison({ items, source, criteria, listing = {} }) {
  const trimmed = rejectPriceOutliers(items);
  const summary = summarise(trimmed, source, criteria);
  const estimate = estimateMarketValue(trimmed, listing);
  // A comparison is only trustworthy if we could narrow by model — without a
  // model the matcher falls back to brand+year, which pulls in unrelated cars
  // (a small van vs pickups). `reliable: false` tells attachComparison to
  // withhold a verdict rather than show a confident-but-wrong saving.
  const reliable = Boolean(listing.model && String(listing.model).trim());

  return {
    ...summary,
    ...estimate,
    matchedCriteria: {
      model: listing.model ?? null,
      fuelType: listing.fuelType ?? null,
      transmission: listing.transmission ?? null,
    },
    reliable,
    unreliableReason: reliable ? null : 'model-unknown',
    lowConfidence: summary.sampleSize < 5,
  };
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
  const { baseUrl, apiKey } = getPtMarketConfig().olx;
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
  return items.map((it) => ({
    priceEur: it.price?.value ?? it.price?.amount ?? it.price,
    url: it.url ?? it.link,
    title: it.title,
  }));
}

// --- Standvirtual ----------------------------------------------------------
async function fetchStandvirtual(listing, criteria) {
  const { baseUrl, token } = getPtMarketConfig().standvirtual;
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
  return items.map((it) => ({
    priceEur: it.price?.amount ?? it.price?.value ?? it.price,
    url: it.url ?? it.link,
    title: it.title,
  }));
}

/**
 * Live PT comparison for one listing.
 * @returns {Promise<object>} comparison object (see summarise)
 */
export async function getComparisonOfficial(listing) {
  const criteria = comparisonCriteria(listing);
  const provider = getPtMarketConfig().provider;
  const items =
    provider === 'standvirtual'
      ? await fetchStandvirtual(listing, criteria)
      : await fetchOlx(listing, criteria);
  return summarise(items, `official:${provider}`, criteria);
}
