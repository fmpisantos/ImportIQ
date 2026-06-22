/**
 * From comparables to one robust PT market value (Specification §4.4) — pure.
 *
 * Steps: enforce a minimum sample (reliability gate), trim price outliers (IQR),
 * then estimate — a mileage-aware linear regression predicted at the subject's
 * km when the sample supports it, otherwise median, otherwise mean. The result
 * always carries its provenance (sample size, sources, method) so the UI can let
 * the user judge confidence; too few comparables → Unknown, never a guess.
 */

import type { EstimateMethod, PtComparison, PtSourceId } from "@importiq/shared";
import type { PtComparable } from "./types.js";

/** Minimum comparables for a meaningful estimate (§4.4 reliability gate). */
export const MIN_SAMPLE = 3;
/** Minimum sample (with km spread) before we trust a mileage regression. */
export const MIN_REGRESSION_SAMPLE = 6;

function quantile(sortedAsc: number[], q: number): number {
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sortedAsc[base]!;
  const hi = sortedAsc[base + 1];
  return hi == null ? lo : lo + rest * (hi - lo);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Trim price outliers using the 1.5×IQR rule. */
function trimOutliers(comparables: PtComparable[]): PtComparable[] {
  if (comparables.length < 4) return comparables;
  const prices = comparables.map((c) => c.priceEur).sort((a, b) => a - b);
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const kept = comparables.filter((c) => c.priceEur >= lo && c.priceEur <= hi);
  // Never trim away so much that we drop below the reliability gate.
  return kept.length >= MIN_SAMPLE ? kept : comparables;
}

/**
 * Ordinary least squares price ~ mileage, predicted at `subjectKm`. Returns
 * `null` when the data has no usable mileage spread (degenerate fit).
 */
function regressionAt(comparables: PtComparable[], subjectKm: number): number | null {
  const pts = comparables.filter((c) => c.mileageKm != null) as (PtComparable & {
    mileageKm: number;
  })[];
  if (pts.length < MIN_REGRESSION_SAMPLE) return null;

  const xs = pts.map((p) => p.mileageKm);
  const ys = pts.map((p) => p.priceEur);
  const xBar = mean(xs);
  const yBar = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx = xs[i]! - xBar;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - yBar);
  }
  if (sxx === 0) return null; // no mileage variance → not a regression problem
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  const predicted = intercept + slope * subjectKm;
  // Guard against a nonsensical extrapolation.
  return predicted > 0 ? predicted : null;
}

function ratingSignalOf(comparables: PtComparable[]): PtComparison["ratingSignal"] {
  let below = 0;
  let inMarket = 0;
  let above = 0;
  let any = false;
  for (const c of comparables) {
    if (c.ratingIndicator === "BELOW") (below++, (any = true));
    else if (c.ratingIndicator === "IN") (inMarket++, (any = true));
    else if (c.ratingIndicator === "ABOVE") (above++, (any = true));
  }
  return any ? { below, in: inMarket, above } : null;
}

function sourceContributions(
  comparables: PtComparable[],
): PtComparison["sources"] {
  const counts = new Map<PtSourceId, number>();
  for (const c of comparables) counts.set(c.sourceId, (counts.get(c.sourceId) ?? 0) + 1);
  return [...counts.entries()].map(([sourceId, sampleSize]) => ({
    sourceId,
    sampleSize,
    error: null,
  }));
}

/**
 * Reduce matched comparables to one PT market value with provenance.
 * `subjectKm` is the German car's mileage (for the regression prediction).
 * `failedSources` lets the caller surface sources that errored (§4.1 merge rule).
 */
export function estimatePtValue(
  comparables: PtComparable[],
  subjectKm: number | null,
  failedSources: PtComparison["sources"] = [],
): PtComparison {
  if (comparables.length < MIN_SAMPLE) {
    return {
      marketValueEur: null,
      unknown: true,
      sampleSize: comparables.length,
      method: null,
      sources: [...sourceContributions(comparables), ...failedSources],
      ratingSignal: ratingSignalOf(comparables),
      note: `Too few comparables (${comparables.length}) for a reliable estimate.`,
    };
  }

  const kept = trimOutliers(comparables);
  const prices = kept.map((c) => c.priceEur);

  let value: number;
  let method: EstimateMethod;
  const regression = subjectKm != null ? regressionAt(kept, subjectKm) : null;
  if (regression != null) {
    value = regression;
    method = "regression";
  } else if (prices.length >= MIN_SAMPLE) {
    value = median(prices);
    method = "median";
  } else {
    value = mean(prices);
    method = "mean";
  }

  return {
    marketValueEur: Math.round(value),
    unknown: false,
    sampleSize: kept.length,
    method,
    sources: [...sourceContributions(kept), ...failedSources],
    ratingSignal: ratingSignalOf(kept),
    note: null,
  };
}
