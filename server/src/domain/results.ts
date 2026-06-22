/**
 * Result-card assembly and sorting (Specification §7) — pure.
 *
 * The saving is PT market value − total landed cost. It is `null` (verdict
 * "unknown") whenever either side could not be determined — the grey state the
 * UI shows instead of a fabricated verdict.
 */

import type { LandedCost, NormalizedListing, PtComparison, ResultCard, SortKey } from "@importiq/shared";
import { yearOf } from "./normalize.js";

export function buildResultCard(
  listing: NormalizedListing,
  landedCost: LandedCost,
  ptComparison: PtComparison,
): ResultCard {
  let savingEur: number | null = null;
  let verdict: ResultCard["verdict"] = "unknown";

  if (landedCost.totalLandedCostEur != null && ptComparison.marketValueEur != null) {
    savingEur = Math.round(ptComparison.marketValueEur - landedCost.totalLandedCostEur);
    verdict = savingEur >= 0 ? "saving" : "loss";
  }

  return { listing, landedCost, ptComparison, savingEur, verdict };
}

/** Push `null`/unknown values to the end regardless of sort direction. */
function nullsLast(a: number | null, b: number | null, compare: (x: number, y: number) => number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return compare(a, b);
}

const COMPARATORS: Record<SortKey, (a: ResultCard, b: ResultCard) => number> = {
  savingDesc: (a, b) => nullsLast(a.savingEur, b.savingEur, (x, y) => y - x),
  landedCostAsc: (a, b) =>
    nullsLast(a.landedCost.totalLandedCostEur, b.landedCost.totalLandedCostEur, (x, y) => x - y),
  germanPriceAsc: (a, b) => a.listing.priceEur - b.listing.priceEur,
  yearDesc: (a, b) =>
    nullsLast(yearOf(a.listing.firstRegistration), yearOf(b.listing.firstRegistration), (x, y) => y - x),
  mileageAsc: (a, b) => nullsLast(a.listing.mileageKm, b.listing.mileageKm, (x, y) => x - y),
};

export function sortResults(cards: ResultCard[], sort: SortKey): ResultCard[] {
  return [...cards].sort(COMPARATORS[sort]);
}
