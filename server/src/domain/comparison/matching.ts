/**
 * Comparable matching (Specification §4.2–§4.3) — pure.
 *
 * This is what stops a base trim from being compared against a performance or
 * equipment variant — the historical cause of fake "amazing deal" results. The
 * rule of thumb: a field genuinely missing on one side does NOT disqualify a
 * comparable; a field present on *both* sides that conflicts DOES.
 */

import type { NormalizedListing } from "@importiq/shared";
import { normalizeModelKey } from "../normalize.js";
import { yearOf } from "../normalize.js";
import type { PtComparable } from "./types.js";

export const YEAR_WINDOW = 1; // ±1 year
export const MILEAGE_WINDOW_KM = 20000; // ±20,000 km
export const DISPLACEMENT_TOLERANCE = 0.1; // ±10%
export const POWER_TOLERANCE = 0.15; // ±15%

/** A spec for one matched listing, used to explain why a candidate was kept. */
export interface SubjectSpec {
  brand: string;
  modelKey: string;
  year: number | null;
}

/** Project a German listing to the comparable subject spec. */
export function subjectSpecOf(listing: NormalizedListing): SubjectSpec | null {
  const modelKey = normalizeModelKey(listing.model);
  if (!listing.brand || !modelKey) return null;
  return {
    brand: listing.brand.trim().toLowerCase(),
    modelKey,
    year: yearOf(listing.firstRegistration),
  };
}

function withinRatio(a: number, b: number, tolerance: number): boolean {
  if (a <= 0 || b <= 0) return true; // can't compare meaningfully → don't reject
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

/**
 * Decide whether `candidate` is a valid PT comparable for the German `subject`.
 * `subject` is the original listing (for specs); `spec` is its projected key.
 */
export function isComparable(
  subject: NormalizedListing,
  spec: SubjectSpec,
  candidate: PtComparable,
): boolean {
  // Brand must match exactly (normalised).
  if (candidate.brand.trim().toLowerCase() !== spec.brand) return false;

  // Directional model containment (§4.2 step 5): the comparable's model must
  // contain the subject's normalised token, never the reverse — so `320` does
  // not pull in `320 Gran Turismo`, and a flagship can't swallow a sub-model.
  const candidateKey = normalizeModelKey(candidate.model);
  if (!candidateKey || !candidateKey.includes(spec.modelKey)) return false;

  // Year within ±1 when both sides publish it.
  if (spec.year != null && candidate.year != null) {
    if (Math.abs(spec.year - candidate.year) > YEAR_WINDOW) return false;
  }

  // Mileage within ±20,000 km when both sides publish it.
  if (subject.mileageKm != null && candidate.mileageKm != null) {
    if (Math.abs(subject.mileageKm - candidate.mileageKm) > MILEAGE_WINDOW_KM) return false;
  }

  // Same fuel — reject only when BOTH publish fuel and they differ.
  if (subject.fuelType != null && candidate.fuelType != null) {
    if (subject.fuelType !== candidate.fuelType) return false;
  }

  // Displacement within ±10% when both publish it.
  if (subject.engineCc != null && candidate.engineCc != null) {
    if (!withinRatio(subject.engineCc, candidate.engineCc, DISPLACEMENT_TOLERANCE)) return false;
  }

  // Power within ±15% when both publish it (both already in kW — §4.2).
  if (subject.powerKw != null && candidate.powerKw != null) {
    if (!withinRatio(subject.powerKw, candidate.powerKw, POWER_TOLERANCE)) return false;
  }

  return true;
}

/** Filter a candidate pool down to the valid comparables for a subject. */
export function selectComparables(
  subject: NormalizedListing,
  candidates: PtComparable[],
): PtComparable[] {
  const spec = subjectSpecOf(subject);
  if (!spec) return [];
  return candidates.filter((c) => isComparable(subject, spec, c));
}
