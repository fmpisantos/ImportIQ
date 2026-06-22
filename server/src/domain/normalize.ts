/**
 * Shared, I/O-free cleaners (Specification §3.4).
 *
 * Every source adapter says only *where* a field lives in its payload; this
 * module decides *how* the raw value is cleaned into the normalised shape. That
 * keeps the cleaning consistent across sources and fully unit-testable.
 *
 * The cardinal rule: a value we cannot parse becomes `null`. We never guess.
 */

import type { FuelType, Transmission } from "@importiq/shared";

/** Metric horsepower (PS / cv) → kW. 1 PS = 0.7355 kW. */
export const PS_TO_KW = 0.7355;
export const KW_TO_PS = 1 / PS_TO_KW;

/**
 * Parse a localized price/number string into a plain number.
 *
 * Handles the formats seen across sources: `"18.500 €"`, `"€ 24,995"`,
 * `"24999"`, `"1.995 cm³"`, `"44,583 km"`, `"73.826 km"`.
 *
 * Strategy: strip everything that is not a digit or separator, then decide
 * whether `.`/`,` are thousands or decimal separators from their position.
 */
export function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;

  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  let normalized: string;

  if (hasDot && hasComma) {
    // Both present → the LAST separator is the decimal one ("24.999,50" vs
    // "24,999.50"); the other is a thousands separator.
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (hasDot || hasComma) {
    // One separator type. Disambiguate thousands vs decimal by what follows it:
    // exactly 3 trailing digits (and a single occurrence) → thousands grouping
    // ("24,995", "1.995"); otherwise it's a decimal point ("190,5", "12.50").
    const sep = hasDot ? "." : ",";
    const parts = cleaned.split(sep);
    if (parts.length > 2) {
      normalized = parts.join(""); // repeated grouping → thousands
    } else {
      const fraction = parts[1] ?? "";
      normalized = fraction.length === 3 ? parts.join("") : parts.join(".");
    }
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse an integer-valued field (price, mileage, displacement, CO₂). A trailing
 * decimal part (rare, usually a parse artefact) is dropped via rounding.
 */
export function parseInteger(raw: string | number | null | undefined): number | null {
  const value = parseNumber(raw);
  return value == null ? null : Math.round(value);
}

const MONTH_YEAR = /^(\d{1,2})[\/.\-](\d{4})$/; // 03/2019, 03-2019, 03.2019
const YEAR_MONTH = /^(\d{4})[\/.\-](\d{1,2})$/; // 2019-03
const YEAR_ONLY = /^(\d{4})$/; // 2019

/**
 * Normalise a first-registration value to `YYYY-MM`. A year-only value (common
 * on Standvirtual) becomes `YYYY-01` so age math still works at year-resolution.
 * Returns `null` for anything unparseable.
 */
export function parseFirstRegistration(
  raw: string | number | null | undefined,
): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();

  let m = MONTH_YEAR.exec(s);
  if (m) return `${m[2]}-${pad2(m[1]!)}`;

  m = YEAR_MONTH.exec(s);
  if (m) return `${m[1]}-${pad2(m[2]!)}`;

  m = YEAR_ONLY.exec(s);
  if (m) return `${m[1]}-01`;

  return null;
}

function pad2(n: string): string {
  return n.padStart(2, "0");
}

/** Extract the 4-digit year from a normalised `YYYY-MM` string. */
export function yearOf(firstRegistration: string | null): number | null {
  if (!firstRegistration) return null;
  const year = Number(firstRegistration.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

const FUEL_MAP: Record<string, FuelType> = {
  // Petrol
  petrol: "petrol",
  gasoline: "petrol",
  benzin: "petrol",
  gasolina: "petrol",
  gaz: "petrol", // Standvirtual result data uses "gaz" for petrol
  b: "petrol",
  // Diesel
  diesel: "diesel",
  d: "diesel",
  // Electric
  electric: "electric",
  electricity: "electric",
  elétrico: "electric",
  eletrico: "electric",
  elektro: "electric",
  e: "electric",
  // PHEV (check before "hybrid" via the dedicated keys)
  phev: "phev",
  "plugin-hybrid": "phev",
  "plug-in-hybrid": "phev",
  "plug-in hybrid": "phev",
  // Hybrid
  hybrid: "hybrid",
  híbrido: "hybrid",
  hibrido: "hybrid",
  // LPG / CNG
  lpg: "lpg",
  gpl: "lpg",
  l: "lpg",
  cng: "cng",
  gnc: "cng",
  c: "cng",
};

/** Map a raw fuel label (any source/language) to the normalised enum. */
export function normalizeFuel(raw: string | null | undefined): FuelType | null {
  if (raw == null) return null;
  const key = raw.trim().toLowerCase();
  if (key === "") return null;
  if (FUEL_MAP[key]) return FUEL_MAP[key];
  // Substring fallbacks for compound labels ("Electric/Gasoline", "Diesel Hybrid").
  if (key.includes("plug")) return "phev";
  if (key.includes("hybrid") || key.includes("híbr") || key.includes("hibr")) return "hybrid";
  if (key.includes("diesel")) return "diesel";
  if (key.includes("elect") || key.includes("eléct") || key.includes("elekt")) return "electric";
  if (key.includes("petrol") || key.includes("gasol") || key.includes("benzin")) return "petrol";
  if (key.includes("lpg") || key.includes("gpl")) return "lpg";
  if (key.includes("cng") || key.includes("gnc")) return "cng";
  return "other";
}

const TRANSMISSION_MAP: Record<string, Transmission> = {
  automatic: "automatic",
  automatik: "automatic",
  automática: "automatic",
  automatica: "automatic",
  auto: "automatic",
  a: "automatic",
  manual: "manual",
  manuell: "manual",
  m: "manual",
};

/** Map a raw transmission label to the normalised enum (semi-auto → automatic). */
export function normalizeTransmission(
  raw: string | null | undefined,
): Transmission | null {
  if (raw == null) return null;
  const key = raw.trim().toLowerCase();
  if (key === "") return null;
  if (TRANSMISSION_MAP[key]) return TRANSMISSION_MAP[key];
  if (key.includes("semi") || key.includes("dsg") || key.includes("tiptronic")) {
    return "automatic";
  }
  if (key.includes("autom")) return "automatic";
  if (key.includes("man")) return "manual";
  return null;
}

/**
 * Convert a power value to kW. Source units differ: AS24/mobile.de give kW,
 * Standvirtual gives cv (metric hp = PS). Pass the unit explicitly so a cv value
 * is never mistaken for kW (the historical "amazing deal" bug — §4.2).
 */
export function powerToKw(
  value: number | null,
  unit: "kw" | "ps" | "cv",
): number | null {
  if (value == null) return null;
  return unit === "kw" ? value : Math.round(value * PS_TO_KW);
}

/**
 * Normalise a model token into the cross-source join key (§4.2 step 2):
 * lowercase, and strip a fuel/trim suffix off a numeric trim code
 * (`320d` → `320`, `116i` → `116`). Word models (`golf`, `a4`) stay intact.
 */
export function normalizeModelKey(model: string | null | undefined): string | null {
  if (model == null) return null;
  const key = model.trim().toLowerCase();
  if (key === "") return null;
  // Numeric trim code, optionally followed by a single-letter fuel/trim suffix
  // and/or descriptive words: "320d", "116i", "520 gran turismo".
  const numeric = /^(\d{2,4})\s*[a-z]?\b/.exec(key);
  if (numeric) return numeric[1]!;
  return key;
}
