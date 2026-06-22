/**
 * IUC engine (Specification §5, Appendix B) — annual road tax, shown separately
 * and NEVER added to the one-time landed cost (§5.1).
 *
 * IUC remains an OPEN investigation: the post-2007 "Categoria B" additive model
 * (cc bracket + CO₂ bracket + fuel/year coefficients) needs official tables that
 * have not been verified. Per the golden rule we therefore return `null` with a
 * note rather than a guessed figure — except battery-electric cars, which are
 * statutorily exempt (annual = €0).
 *
 * This module is intentionally shaped so verified tables can be dropped in later
 * without touching its callers.
 */

import type { FuelType, IucResult } from "@importiq/shared";

export interface IucInput {
  fuelType: FuelType | null;
  engineCc: number | null;
  co2Gkm: number | null;
  firstRegistration: string | null;
}

export function computeIuc(input: IucInput): IucResult {
  if (input.fuelType === "electric") {
    return { annualEur: 0, note: "Battery-electric vehicles are exempt from IUC.", unverified: false };
  }

  // No verified tables yet → honest "unknown" rather than a guess.
  return {
    annualEur: null,
    note: "IUC tables pending official Portal das Finanças verification.",
    unverified: true,
  };
}
