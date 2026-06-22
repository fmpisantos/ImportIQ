/**
 * Landed-cost assembly (Specification §5.1, §5.4) — pure.
 *
 * Combines the German price with the computed ISV, conditional VAT, and the
 * user-configured transport + legalisation costs, and enforces the load-bearing
 * completeness invariant: if ANY required component is missing, the total is
 * `null`, the result is flagged Incomplete, and `missing[]` names what is absent.
 * We never fill a gap with an estimate to complete the total.
 */

import type { LandedCost, NormalizedListing } from "@importiq/shared";
import { computeIsv } from "./isv/isvEngine.js";
import { computeIuc } from "./iuc/iucEngine.js";

/** VAT rate for a "new means of transport" (§5.2.1). */
export const VAT_RATE = 0.23;

/** Cost inputs already resolved from the configuration store (§6). */
export interface ResolvedCosts {
  /** Active transport method, present only when enabled with a real amount. */
  transport: { label: string; amountEur: number } | null;
  /** Reason transport is unavailable (drives `missing[]`) when `transport` null. */
  transportMissing: string | null;
  /** Enabled legalisation fees with a real (> 0) amount. */
  legalisationItems: { key: string; label: string; amountEur: number }[];
  /** Labels of enabled legalisation fees whose amount is still unset (≤ 0). */
  legalisationUnset: string[];
}

/** Whole months between first registration and `asOf`. */
function ageMonths(firstRegistration: string, asOf: Date): number {
  const [y, m] = firstRegistration.split("-").map(Number);
  return (
    (asOf.getUTCFullYear() - y!) * 12 + (asOf.getUTCMonth() - ((m ?? 1) - 1))
  );
}

/**
 * Decide VAT (§5.2.1). A "new means of transport" is ≤ 6 months old OR
 * ≤ 6,000 km. When this cannot be confirmed from the data, we flag it not
 * applicable and add nothing (golden rule — never add a suspect charge).
 */
function resolveVat(
  listing: NormalizedListing,
  asOf: Date,
): { applicable: boolean; eur: number } {
  if (!listing.firstRegistration || listing.mileageKm == null) {
    return { applicable: false, eur: 0 };
  }
  const months = ageMonths(listing.firstRegistration, asOf);
  const isNew = months <= 6 || listing.mileageKm <= 6000;
  return isNew
    ? { applicable: true, eur: round2(listing.priceEur * VAT_RATE) }
    : { applicable: false, eur: 0 };
}

export function computeLandedCost(
  listing: NormalizedListing,
  costs: ResolvedCosts,
  asOf: Date,
): LandedCost {
  const missing: string[] = [];

  // --- ISV ---------------------------------------------------------------
  const isvResult = computeIsv({
    engineCc: listing.engineCc,
    co2Gkm: listing.co2Gkm,
    fuelType: listing.fuelType,
    firstRegistration: listing.firstRegistration,
    emissionStandard: listing.emissionStandard,
    asOf,
  });
  const isv = isvResult.ok ? isvResult.breakdown : null;
  if (!isvResult.ok) {
    for (const m of isvResult.missing) missing.push(`ISV: ${m}`);
  }

  // --- VAT ---------------------------------------------------------------
  const vat = resolveVat(listing, asOf);

  // --- Transport ---------------------------------------------------------
  if (!costs.transport) {
    missing.push(costs.transportMissing ?? "active transport method");
  }

  // --- Legalisation ------------------------------------------------------
  for (const label of costs.legalisationUnset) {
    missing.push(`legalisation fee unset: ${label}`);
  }
  const legalisationEur = costs.legalisationItems.reduce((s, i) => s + i.amountEur, 0);

  // --- Total -------------------------------------------------------------
  const incomplete = missing.length > 0;
  const totalLandedCostEur =
    incomplete || isv == null || !costs.transport
      ? null
      : round2(
          listing.priceEur +
            isv.totalEur +
            vat.eur +
            costs.transport.amountEur +
            legalisationEur,
        );

  return {
    breakdown: {
      germanPriceEur: listing.priceEur,
      isv,
      vatEur: vat.eur,
      vatApplicable: vat.applicable,
      transportEur: costs.transport?.amountEur ?? null,
      transportMethodLabel: costs.transport?.label ?? null,
      legalisationEur: incomplete ? null : round2(legalisationEur),
      legalisationItems: costs.legalisationItems,
    },
    totalLandedCostEur,
    incomplete,
    missing,
    iuc: computeIuc({
      fuelType: listing.fuelType,
      engineCc: listing.engineCc,
      co2Gkm: listing.co2Gkm,
      firstRegistration: listing.firstRegistration,
    }),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
