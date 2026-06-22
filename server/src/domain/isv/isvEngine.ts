/**
 * The ISV engine (Specification §5.2) — a pure, deterministic function.
 *
 * No I/O, no DB, no network, no hidden clock: age is derived from the explicit
 * `asOf` date passed in, so the same inputs always produce the same output and
 * the whole thing is trivially unit-testable.
 *
 * It returns either a full breakdown or, when a *required* input is missing, the
 * exact list of what is absent — never a guessed total (golden rule, §5.4).
 */

import type { FuelType, IsvBreakdown, HomologationCycle, SpecialRegime } from "@importiq/shared";
import {
  AGE_REDUCTION_TABLE,
  bracketFor,
  co2TableFamily,
  CO2_TABLES,
  CYLINDER_TABLE,
  ISV_TABLES_VERSION,
  ISV_UNVERIFIED,
  MIN_ISV_EUR,
  PARTICULATE_SURCHARGE_EUR,
  PHEV_CO2_CEILING_GKM,
  REGIME_REDUCTIONS,
} from "./isvTables.js";

export interface IsvInput {
  engineCc: number | null;
  co2Gkm: number | null;
  fuelType: FuelType | null;
  /** First registration as `YYYY-MM`. */
  firstRegistration: string | null;
  emissionStandard: string | null;
  /** Reference date for the age calculation (inject for determinism). */
  asOf: Date;
}

export type IsvResult =
  | { ok: true; breakdown: IsvBreakdown }
  | { ok: false; missing: string[] };

/** Whole years between first registration and `asOf` (floored, never negative). */
export function ageYears(firstRegistration: string, asOf: Date): number {
  const [y, m] = firstRegistration.split("-").map(Number);
  const reg = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  const months =
    (asOf.getUTCFullYear() - reg.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - reg.getUTCMonth());
  return Math.max(0, Math.floor(months / 12));
}

/**
 * Choose the CO₂ homologation cycle (§5.2). Euro 6d and later imply WLTP; below
 * that we fall back to registration year (WLTP for ≥ 2019, else NEDC).
 */
export function resolveCycle(
  firstRegistration: string,
  emissionStandard: string | null,
): HomologationCycle {
  const std = (emissionStandard ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (/euro6[dce]|euro6dtemp|euro7/.test(std)) return "WLTP";
  const year = Number(firstRegistration.slice(0, 4));
  return year >= 2019 ? "WLTP" : "NEDC";
}

function ageReductionFraction(years: number): number {
  const hit = AGE_REDUCTION_TABLE.find((b) => b.upToYears === null || years <= b.upToYears);
  return (hit ?? AGE_REDUCTION_TABLE[AGE_REDUCTION_TABLE.length - 1]!).fraction;
}

/** Decide the special regime and its reduction fraction from fuel + CO₂. */
function resolveRegime(
  fuel: FuelType,
  co2Gkm: number,
): { regime: SpecialRegime; fraction: number } {
  switch (fuel) {
    case "phev":
      // Only grant the PHEV discount when CO₂ is within the qualifying ceiling;
      // otherwise we cannot confirm eligibility, so we grant nothing.
      return co2Gkm <= PHEV_CO2_CEILING_GKM
        ? { regime: "phev_reduction", fraction: REGIME_REDUCTIONS.phev }
        : { regime: "none", fraction: 0 };
    case "hybrid":
      return { regime: "hybrid_reduction", fraction: REGIME_REDUCTIONS.hybrid };
    case "cng":
      return { regime: "cng_reduction", fraction: REGIME_REDUCTIONS.cng };
    default:
      return { regime: "none", fraction: 0 };
  }
}

export function computeIsv(input: IsvInput): IsvResult {
  const { fuelType, firstRegistration, asOf } = input;

  // First registration is required for the age reduction regardless of fuel.
  if (!firstRegistration) {
    return { ok: false, missing: ["first registration date"] };
  }

  // Battery-electric vehicles are exempt — a complete result with zero ISV even
  // without displacement/CO₂ (Appendix B special regimes).
  if (fuelType === "electric") {
    return {
      ok: true,
      breakdown: {
        cylinderComponentEur: 0,
        environmentalComponentEur: 0,
        particulateSurchargeEur: 0,
        ageReductionFraction: 0,
        specialRegime: "bev_exempt",
        specialRegimeReductionFraction: 1,
        totalEur: 0,
        cycle: "WLTP",
        tablesVersion: ISV_TABLES_VERSION,
        unverified: ISV_UNVERIFIED,
      },
    };
  }

  // Every other car needs displacement, CO₂ and fuel to compute both components.
  const missing: string[] = [];
  if (input.engineCc == null) missing.push("engine displacement (cm³)");
  if (input.co2Gkm == null) missing.push("CO₂ emissions (g/km)");
  if (fuelType == null) missing.push("fuel type");
  if (missing.length > 0) return { ok: false, missing };

  const engineCc = input.engineCc!;
  const co2Gkm = input.co2Gkm!;
  const fuel = fuelType!;

  const cycle = resolveCycle(firstRegistration, input.emissionStandard);
  const family = co2TableFamily(fuel);
  const co2Table = CO2_TABLES[family][cycle];
  if (co2Table == null) {
    // NEDC tables are not encoded — report Incomplete rather than guess.
    return {
      ok: false,
      missing: [`ISV CO₂ table for ${family} on the ${cycle} cycle (not yet encoded)`],
    };
  }

  // Component A — cylinder capacity.
  const cylBracket = bracketFor(CYLINDER_TABLE, engineCc);
  const cylinderComponentEur = Math.max(0, engineCc * cylBracket.rate - cylBracket.parcela);

  // Component B — environmental.
  const co2Bracket = bracketFor(co2Table, co2Gkm);
  const environmentalComponentEur = Math.max(0, co2Gkm * co2Bracket.rate - co2Bracket.parcela);

  // Age reduction on (A + B).
  const age = ageYears(firstRegistration, asOf);
  const ageFraction = ageReductionFraction(age);
  const afterAge = (cylinderComponentEur + environmentalComponentEur) * (1 - ageFraction);

  // Special regime reduction on the ISV total.
  const { regime, fraction: regimeFraction } = resolveRegime(fuel, co2Gkm);
  const afterRegime = afterAge * (1 - regimeFraction);

  // Diesel particulate surcharge (added after reductions, not reduced).
  const particulateSurchargeEur = fuel === "diesel" ? PARTICULATE_SURCHARGE_EUR : 0;

  let totalEur = afterRegime + particulateSurchargeEur;
  if (MIN_ISV_EUR != null) totalEur = Math.max(totalEur, MIN_ISV_EUR);

  return {
    ok: true,
    breakdown: {
      cylinderComponentEur: round2(cylinderComponentEur),
      environmentalComponentEur: round2(environmentalComponentEur),
      particulateSurchargeEur,
      ageReductionFraction: ageFraction,
      specialRegime: regime,
      specialRegimeReductionFraction: regimeFraction,
      totalEur: round2(totalEur),
      cycle,
      tablesVersion: ISV_TABLES_VERSION,
      unverified: ISV_UNVERIFIED,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
