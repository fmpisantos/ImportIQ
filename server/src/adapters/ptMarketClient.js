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

// Tight "preferred" engine band (item C). The loose tolerances above admit
// adjacent variants (a 318d/330d into a 320d pool); when ENOUGH comparables sit
// within this tighter band AND actually publish their engine specs, we benchmark
// off that tight, mechanically-identical set instead — falling back to the loose
// set only when too few tight ones survive. Requires the field on both sides
// (unlike the loose, field-tolerant gate): a missing spec isn't a tight match.
const TIGHT_POWER_TOLERANCE = 0.12; // ±12% on engine power (kW)
const TIGHT_DISPLACEMENT_TOLERANCE = 0.08; // ±8% on displacement (cm³)

// Fewest distinct comparables a comparison needs before we'll stake a verdict on
// its market value. One or two asking prices is anecdote, not a benchmark; below
// this the comparison is flagged unreliable and no saving/verdict is shown.
const MIN_RELIABLE_SAMPLE = 3;

/** Symmetric tolerance check; null/zero on either side ⇒ pass (field-tolerant). */
function withinTolerance(a, b, tol) {
  if (a == null || b == null || !(a > 0) || !(b > 0)) return true;
  return Math.abs(a - b) <= tol * Math.max(a, b);
}

/**
 * Does a PT comparable actually match the subject listing? Narrows on model
 * family, fuel, transmission, engine power and displacement — but only on
 * fields BOTH sides publish (mirrors normalize.js#matchesFilters: we can't drop
 * a comparable for a field it doesn't expose).
 *
 * Model matching is DIRECTIONAL: the comparable's model must CONTAIN the
 * subject's model (or its stripped family key) — never the reverse. The reverse
 * direction was a real defect: it let a flagship "Range Rover" (€68k) match a
 * "Range Rover Velar" subject because the subject string contains "range rover",
 * dragging a far pricier, different vehicle line into the average. Requiring the
 * comparable to be the subject (or a more-specific trim of it) keeps the genuine
 * leniency we want — comparable "320d"/"320 d AMG" matches a "320" family
 * subject — without matching *up* to a broader, costlier model. Pure.
 *
 * Model identity is NOT field-tolerant. PT sources return the whole brand
 * category (OLX's free-text `query` barely filters, and a brand-only search has
 * no model param at all), so admitting every comparable whose structured model
 * is absent pulls in different model lines entirely — a Panamera subject was
 * benchmarked against 911s and Cayennes because OLX leaves `modelo` null on
 * those. So when the comparable has no structured `model`, fall back to its ad
 * `title` (which always carries the model — "Porsche 911 (992) …"); only skip
 * the gate when the comparable exposes NEITHER. Engine/fuel/transmission below
 * stay field-tolerant — those are tolerance bands, model is identity.
 *
 * Comparable shape: { priceEur, model?, title?, fuel?, transmission?, powerKw?,
 *   displacementCm3? }. The subject is a normalised listing (powerKw in kW).
 */
export function comparableMatches(c, listing) {
  if (listing.model) {
    const modelText = norm(c.model || c.title); // structured model, else the ad title
    if (modelText) {
      const candidates = [norm(listing.model), norm(normalizeModelKey(listing.model))];
      if (!candidates.some((x) => x && modelText.includes(x))) return false;
    }
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
  // Performance models (M3, RS6, AMG 63, GTI …) are a DIFFERENT car, not a
  // pricier trim of the same one — averaging them with the base model wildly
  // distorts the benchmark in either direction. So when exactly one side is a
  // performance car, drop the comparable. Sport-appearance trims are NOT excluded
  // here (they share the drivetrain); they're narrowed softly in finalizeComparison.
  const subjPerf = listing.trimTier === 'performance';
  const compPerf = c.trimTier === 'performance';
  if (subjPerf !== compPerf) return false;
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
 * Spec-normalized estimate (item D): a two-predictor OLS of price on mileage AND
 * power, predicted at the SUBJECT's mileage+power — so a set that still spans a
 * range of powers (e.g. 110–140 kW within the loose band) is corrected to the
 * subject's actual output instead of pooling them. Closed-form 2×2 solve.
 *
 * Only fires when the extra predictor is real: enough points, the power column
 * genuinely varies (≥3 distinct values — otherwise it degenerates to the mileage
 * fit), a non-singular system, a sane negative mileage slope, and a minimum R².
 * The prediction is clamped to the observed price range so a steep coefficient
 * can't extrapolate to nonsense. Returns null (caller falls back) otherwise. Pure.
 *
 * @param {Array<{x1:number,x2:number,y:number}>} points  x1=mileage, x2=power, y=price
 * @param {{x1:number,x2:number}} target  subject mileage + power
 */
export function multiRegressionEstimate(points, target, opts = {}) {
  const { minPoints = 8, minR2 = 0.2 } = opts;
  const pts = points.filter(
    (p) => Number.isFinite(p.x1) && Number.isFinite(p.x2) && Number.isFinite(p.y) && p.y > 0
  );
  if (pts.length < minPoints || !Number.isFinite(target.x1) || !Number.isFinite(target.x2)) {
    return null;
  }
  if (new Set(pts.map((p) => p.x2)).size < 3) return null; // no real power variation

  const m1 = mean(pts.map((p) => p.x1));
  const m2 = mean(pts.map((p) => p.x2));
  const my = mean(pts.map((p) => p.y));
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0, syy = 0;
  for (const p of pts) {
    const d1 = p.x1 - m1;
    const d2 = p.x2 - m2;
    const dy = p.y - my;
    s11 += d1 * d1;
    s22 += d2 * d2;
    s12 += d1 * d2;
    s1y += d1 * dy;
    s2y += d2 * dy;
    syy += dy * dy;
  }
  const det = s11 * s22 - s12 * s12;
  if (det === 0 || s22 === 0 || syy === 0) return null;
  const b1 = (s22 * s1y - s12 * s2y) / det; // mileage coefficient
  const b2 = (s11 * s2y - s12 * s1y) / det; // power coefficient
  if (b1 >= 0) return null; // price must fall with mileage to be a real signal
  const b0 = my - b1 * m1 - b2 * m2;

  // R² from residuals of the full two-predictor fit.
  let ssRes = 0;
  for (const p of pts) ssRes += (p.y - (b0 + b1 * p.x1 + b2 * p.x2)) ** 2;
  const r2 = 1 - ssRes / syy;
  if (!(r2 >= minR2)) return null;

  const ys = pts.map((p) => p.y);
  const yhat = Math.max(
    Math.min(...ys),
    Math.min(Math.max(...ys), b0 + b1 * target.x1 + b2 * target.x2)
  );
  return yhat > 0 ? round2(yhat) : null;
}

/**
 * Best central estimate of market value for the subject listing from a set of
 * comparables, in descending order of preference:
 *   1. a spec-normalized mileage+power regression at the subject's spec (item D),
 *   2. a mileage-only regression at the subject's mileage,
 *   3. the median,
 *   4. null.
 * Returns the median too (always, for display). Pure.
 *
 * @param {Array} items   comparables ({ priceEur, mileageKm?, powerKw? })
 * @param {object} listing  subject (uses listing.mileageKm, listing.powerKw)
 */
export function estimateMarketValue(items, listing = {}) {
  const prices = items.map(priceVal).filter((p) => Number.isFinite(p) && p > 0);
  if (!prices.length) {
    return { marketValueEur: null, marketValueMethod: 'none', medianPriceEur: null };
  }
  const med = round2(median(prices));

  // (1) Spec-normalized: correct for the subject's actual power, not just mileage.
  if (listing.powerKw > 0) {
    const mpoints = items
      .map((l) => ({ x1: Number(l.mileageKm), x2: Number(l.powerKw), y: priceVal(l) }))
      .filter((p) => Number.isFinite(p.x1) && p.x1 >= 0 && Number.isFinite(p.x2) && p.x2 > 0);
    const multi = multiRegressionEstimate(mpoints, {
      x1: Number(listing.mileageKm),
      x2: Number(listing.powerKw),
    });
    if (multi != null) {
      return { marketValueEur: multi, marketValueMethod: 'mileage-power-regression', medianPriceEur: med };
    }
  }

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
 * Prefer same-trim-tier comparables for the subject, falling back to the full
 * set when too few share its tier. Returns the chosen items plus transparency:
 * the subject's `trimTier`, whether narrowing actually happened (`trimMatched`),
 * and the per-tier counts of the full matched set. Pure.
 *
 * `trimMatched`:
 *   - true  → narrowed to same-tier comparables (a true like-for-like benchmark);
 *   - false → not enough same-tier comparables, using the mixed set (treat the
 *             verdict with more caution — trims may differ);
 *   - null  → subject tier unknown, no narrowing attempted.
 */
export function selectByTrim(items, listing = {}) {
  const tier = listing.trimTier;
  const breakdown = { base: 0, sport: 0, performance: 0 };
  for (const i of items) {
    const t = i.trimTier ?? 'base';
    if (t in breakdown) breakdown[t] += 1;
  }
  if (!tier) return { items, trimTier: null, trimMatched: null, trimBreakdown: breakdown };

  const same = items.filter((i) => (i.trimTier ?? 'base') === tier);
  if (same.length >= MIN_RELIABLE_SAMPLE) {
    return { items: same, trimTier: tier, trimMatched: true, trimBreakdown: breakdown };
  }
  return { items, trimTier: tier, trimMatched: false, trimBreakdown: breakdown };
}

/**
 * Prefer comparables inside the TIGHT engine band (item C), falling back to the
 * full set when too few qualify. A "tight" comparable must publish BOTH engine
 * fields and sit within ±12% power / ±8% displacement of the subject — so the
 * benchmark is built from the same mechanical variant, not adjacent ones. When
 * the subject itself lacks engine specs, no tightening is possible (engineTier
 * null). Returns the chosen items + which band produced them. Pure.
 */
export function selectByEngineTier(items, listing = {}) {
  const subjectHasSpec = listing.powerKw > 0 && listing.displacementCm3 > 0;
  if (!subjectHasSpec) return { items, engineTier: null };

  const inTightBand = (c) =>
    c.powerKw > 0 &&
    c.displacementCm3 > 0 &&
    Math.abs(listing.powerKw - c.powerKw) <= TIGHT_POWER_TOLERANCE * Math.max(listing.powerKw, c.powerKw) &&
    Math.abs(listing.displacementCm3 - c.displacementCm3) <=
      TIGHT_DISPLACEMENT_TOLERANCE * Math.max(listing.displacementCm3, c.displacementCm3);

  const tight = items.filter(inTightBand);
  if (tight.length >= MIN_RELIABLE_SAMPLE) return { items: tight, engineTier: 'tight' };
  return { items, engineTier: 'loose' };
}

/**
 * Relative price dispersion of a comparable set — how tightly the asking prices
 * cluster. A narrow band is a trustworthy benchmark; a wide one means the
 * "market value" is really an average over dissimilar cars (different extras,
 * conditions, optimistic asks), so a headline saving off it is fragile.
 *
 * Reports the robust IQR width as a fraction of the median (`relIqr`) plus the
 * raw min/max, or null below 4 priced items (can't locate quartiles). Pure.
 */
export function priceDispersion(items) {
  const prices = items.map(priceVal).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (prices.length < 4) return null;
  const quantile = (p) => {
    const idx = (prices.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return prices[lo] + (prices[hi] - prices[lo]) * (idx - lo);
  };
  const med = median(prices);
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  return {
    relIqr: med > 0 ? round2((q3 - q1) / med) : null,
    minPriceEur: prices[0],
    maxPriceEur: prices[prices.length - 1],
  };
}

/**
 * How many comparables backing the benchmark were matched on ENGINE (power +
 * displacement both published on both sides, hence in-tolerance) vs admitted on
 * model family alone because a field was missing. A low ratio — or a subject
 * that itself lacks engine specs — means the matcher couldn't actually verify
 * the cars are the same mechanical variant. Pure.
 */
export function engineMatchStats(items, listing = {}) {
  const subjectHasSpec = listing.powerKw > 0 && listing.displacementCm3 > 0;
  let matched = 0;
  if (subjectHasSpec) {
    for (const c of items) {
      if (c.powerKw > 0 && c.displacementCm3 > 0) matched += 1;
    }
  }
  const total = items.length;
  return { matched, total, ratio: total ? round2(matched / total) : 0, subjectHasSpec };
}

/**
 * Grade overall confidence in the benchmark from the signals that make a PT
 * "market value" trustworthy: a real sample, engine-verified comparables, a
 * same-trim set, and tightly-clustered prices. Returns a level plus the specific
 * factors that dragged it down, so the UI can explain *why* a saving is shaky
 * rather than just showing a number. Pure.
 *
 * Demerit model (transparent over clever): each weak signal adds points;
 * 0 ⇒ 'high', 1–2 ⇒ 'medium', ≥3 ⇒ 'low'. A very wide price spread counts double
 * because it most directly undermines the headline number.
 */
export function gradeConfidence({ sampleSize, engine, dispersion, trimMatched }) {
  const factors = [];
  let demerits = 0;
  if (sampleSize < 5) { factors.push('small-sample'); demerits += 1; }
  if (!engine.subjectHasSpec) { factors.push('subject-engine-spec-missing'); demerits += 1; }
  else if (engine.ratio < 0.5) { factors.push('mostly-model-only-match'); demerits += 1; }
  if (trimMatched === false) { factors.push('trim-not-matched'); demerits += 1; }
  if (dispersion?.relIqr != null) {
    if (dispersion.relIqr > 0.5) { factors.push('very-high-price-spread'); demerits += 2; }
    else if (dispersion.relIqr > 0.3) { factors.push('high-price-spread'); demerits += 1; }
  }
  const level = demerits >= 3 ? 'low' : demerits >= 1 ? 'medium' : 'high';
  return { level, factors };
}

/**
 * Turn a set of matched comparables into the full comparison object every PT
 * source returns: IQR-trims, averages (mean, kept as `avgPriceEur` for
 * back-compat), adds the robust `marketValueEur` + method + median, the matched
 * criteria, and a low-confidence flag (< 5 comparables). Pure. Callers add any
 * source-specific extras (searchUrl, per-source breakdown). Pure.
 */
export function finalizeComparison({ items, source, criteria, listing = {} }) {
  // Like-for-like trim narrowing: prefer comparables of the SAME trim tier as the
  // subject (base→base, sport→sport), so a base car isn't valued against pricier
  // sport trims (the phantom-profit failure mode). Only narrow when enough
  // same-tier comparables survive to stay a real sample; otherwise fall back to
  // the full set and flag `trimMatched: false` so the caller can soften the
  // verdict. A subject with no known tier skips this entirely (trimMatched null).
  const trimSelection = selectByTrim(items, listing);
  // Then tighten the engine band within that trim-selected set (item C): prefer
  // mechanically-identical comparables (±12% power / ±8% displacement), falling
  // back to the loose set when too few qualify. engineTier records which was used.
  const engineSelection = selectByEngineTier(trimSelection.items, listing);
  const trimmed = rejectPriceOutliers(engineSelection.items);
  const summary = summarise(trimmed, source, criteria);
  const estimate = estimateMarketValue(trimmed, listing);

  // Match-quality + dispersion confidence (computed over the SAME set backing the
  // benchmark) so the saving is presented with how much to trust it.
  const dispersion = priceDispersion(trimmed);
  const engine = engineMatchStats(trimmed, listing);
  const grade = gradeConfidence({
    sampleSize: summary.sampleSize,
    engine,
    dispersion,
    trimMatched: trimSelection.trimMatched,
  });
  // A comparison is only trustworthy on TWO counts:
  //   1. we could narrow by model — without one the matcher falls back to
  //      brand+year, pulling in unrelated cars (a small van vs pickups);
  //   2. enough distinct comparables survived. A "market value" taken from one
  //      or two asking prices is noise, not a benchmark — a single optimistic
  //      ask then reads as a €15k+ phantom profit (and IQR trimming can't fire
  //      below 4 items to catch it). Below the floor we withhold the verdict.
  // Either failure sets `reliable: false`, which tells attachComparison to drop
  // the saving/verdict rather than show a confident-but-wrong number.
  const hasModel = Boolean(listing.model && String(listing.model).trim());
  const enoughSample = summary.sampleSize >= MIN_RELIABLE_SAMPLE;
  const reliable = hasModel && enoughSample;

  return {
    ...summary,
    ...estimate,
    matchedCriteria: {
      model: listing.model ?? null,
      fuelType: listing.fuelType ?? null,
      transmission: listing.transmission ?? null,
      trimTier: trimSelection.trimTier,
      engineTier: engineSelection.engineTier,
    },
    trimTier: trimSelection.trimTier,
    trimMatched: trimSelection.trimMatched,
    trimBreakdown: trimSelection.trimBreakdown,
    engineTier: engineSelection.engineTier,
    dispersion,
    engineMatch: engine,
    confidence: grade.level,
    confidenceFactors: grade.factors,
    reliable,
    unreliableReason: !hasModel
      ? 'model-unknown'
      : !enoughSample
        ? 'insufficient-sample'
        : null,
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
