/**
 * ISV statutory tables — fiscal year OE2026 (Specification Appendix B).
 *
 * ⚠ UNVERIFIED DRAFT. These values were researched from public PT tax summaries
 * and have NOT been cross-checked against the official Portal das Finanças /
 * Portal Aduaneiro ISV simulator. Per the golden rule (§0, §5.2) every figure
 * derived from them is flagged `unverified: true` until that cross-check is done.
 *
 * Tables change ~once a year and MUST be updated deliberately, never estimated.
 * To add a new fiscal year, add a sibling file and switch on it — do not edit
 * these in place once a year is verified.
 *
 * NEDC environmental tables are intentionally NOT encoded: the source draft did
 * not provide their values, and inventing them would violate the golden rule.
 * A car whose CO₂ must be read on the NEDC cycle therefore resolves to
 * Incomplete rather than to a made-up number (see isvEngine.ts).
 */

import type { FuelType, HomologationCycle } from "@importiq/shared";

export const ISV_TABLES_VERSION = "OE2026";

/** Always true until the Portal das Finanças cross-check is completed (§5.2). */
export const ISV_UNVERIFIED = true;

/**
 * A progressive bracket: applies when the value is `<= upTo` (or `upTo === null`
 * for the open-ended top bracket). Result = value × rate − parcela.
 */
export interface TaxBracket {
  upTo: number | null;
  rate: number;
  parcela: number;
}

/** Component A — cylinder capacity (cm³), light passenger. */
export const CYLINDER_TABLE: TaxBracket[] = [
  { upTo: 1000, rate: 1.09, parcela: 849.03 },
  { upTo: 1250, rate: 1.18, parcela: 850.69 },
  { upTo: null, rate: 5.61, parcela: 6194.88 },
];

/** Component B — environmental (CO₂ g/km), petrol, WLTP cycle. */
const CO2_PETROL_WLTP: TaxBracket[] = [
  { upTo: 110, rate: 0.44, parcela: 43.02 },
  { upTo: 115, rate: 1.1, parcela: 115.8 },
  { upTo: 120, rate: 1.38, parcela: 147.79 },
  { upTo: 130, rate: 5.27, parcela: 619.17 },
  { upTo: 145, rate: 6.38, parcela: 762.73 },
  { upTo: 175, rate: 41.54, parcela: 5819.56 },
  { upTo: 195, rate: 51.38, parcela: 7247.39 },
  { upTo: 235, rate: 193.01, parcela: 34190.52 },
  { upTo: null, rate: 233.81, parcela: 41910.96 },
];

/** Component B — environmental (CO₂ g/km), diesel, WLTP cycle. */
const CO2_DIESEL_WLTP: TaxBracket[] = [
  { upTo: 110, rate: 1.72, parcela: 11.5 },
  { upTo: 120, rate: 18.96, parcela: 1906.19 },
  { upTo: 140, rate: 65.04, parcela: 7360.85 },
  { upTo: 150, rate: 127.4, parcela: 16080.57 },
  { upTo: 160, rate: 160.81, parcela: 21176.06 },
  { upTo: 170, rate: 221.69, parcela: 29227.38 },
  { upTo: 190, rate: 274.08, parcela: 36987.98 },
  { upTo: null, rate: 282.35, parcela: 38271.32 },
];

/**
 * Environmental tables keyed by fuel family × cycle. `null` means "not encoded"
 * (NEDC) → the engine reports the car Incomplete rather than guessing.
 *
 * `diesel` covers diesel + diesel-hybrid; every other fuel uses the petrol table.
 */
export const CO2_TABLES: Record<
  "petrol" | "diesel",
  Record<HomologationCycle, TaxBracket[] | null>
> = {
  petrol: { WLTP: CO2_PETROL_WLTP, NEDC: null },
  diesel: { WLTP: CO2_DIESEL_WLTP, NEDC: null },
};

/** Age reduction applied to (A + B), unified post-OE2025 rule. */
export interface AgeBracket {
  /** Inclusive upper bound in years; `null` is the open-ended top bracket. */
  upToYears: number | null;
  fraction: number;
}

export const AGE_REDUCTION_TABLE: AgeBracket[] = [
  { upToYears: 1, fraction: 0.1 },
  { upToYears: 2, fraction: 0.2 },
  { upToYears: 3, fraction: 0.28 },
  { upToYears: 4, fraction: 0.35 },
  { upToYears: 5, fraction: 0.43 },
  { upToYears: 6, fraction: 0.52 },
  { upToYears: 7, fraction: 0.6 },
  { upToYears: 8, fraction: 0.65 },
  { upToYears: 9, fraction: 0.7 },
  { upToYears: 10, fraction: 0.75 },
  { upToYears: null, fraction: 0.8 },
];

/** Diesel particulate surcharge (€), added after reductions. */
export const PARTICULATE_SURCHARGE_EUR = 500;

/**
 * CO₂ ceiling (g/km) below which a PHEV qualifies for the 75% reduction.
 * 2026 raised this to 80 g/km (Euro 6e-bis). Above it, no PHEV reduction is
 * applied — we cannot confirm qualification from listing data, so we do not
 * grant the discount (golden rule: never overstate the saving).
 */
export const PHEV_CO2_CEILING_GKM = 80;

/** Special-regime reduction fractions applied to the ISV total. */
export const REGIME_REDUCTIONS = {
  phev: 0.75,
  hybrid: 0.4,
  cng: 0.6,
} as const;

/**
 * Minimum ISV floor. The exact statutory value was not confirmed in the source
 * draft, so it is left unset: we do NOT clamp to a guessed floor.
 */
export const MIN_ISV_EUR: number | null = null;

/** Map a normalised fuel to the environmental-table family. */
export function co2TableFamily(fuel: FuelType): "petrol" | "diesel" {
  return fuel === "diesel" ? "diesel" : "petrol";
}

/** Find the first bracket whose `upTo` covers `value`. */
export function bracketFor<T extends { upTo: number | null }>(
  table: T[],
  value: number,
): T {
  const hit = table.find((b) => b.upTo === null || value <= b.upTo);
  // The open-ended top bracket guarantees a hit; the assertion documents that.
  return hit ?? table[table.length - 1]!;
}
