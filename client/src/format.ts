// Shared formatting helpers. The product is Portugal-facing, so currency and
// numbers use the pt-PT locale everywhere.

const eurFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const eurPreciseFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("pt-PT");

/** Format a EUR amount, or a placeholder when the value is null/undefined. */
export function formatEur(
  value: number | null | undefined,
  placeholder = "—",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return placeholder;
  }
  return eurFormatter.format(value);
}

/** Format a EUR amount keeping cents (used for small itemised fees). */
export function formatEurPrecise(
  value: number | null | undefined,
  placeholder = "—",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return placeholder;
  }
  return eurPreciseFormatter.format(value);
}

/** Format a plain integer (e.g. mileage) with a unit suffix. */
export function formatNumber(
  value: number | null | undefined,
  placeholder = "—",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return placeholder;
  }
  return numberFormatter.format(value);
}

/** Format mileage in km, or a placeholder. */
export function formatKm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${numberFormatter.format(value)} km`;
}

/** Format a fraction (0.52) as a percentage string ("52%"). */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Turn an ISO timestamp into a short readable date-time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Extract the year (YYYY) from a `YYYY-MM` first-registration string. */
export function registrationYear(firstRegistration: string | null): string {
  if (!firstRegistration) return "—";
  return firstRegistration.slice(0, 4);
}

const FUEL_LABELS: Record<string, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  electric: "Electric",
  hybrid: "Hybrid",
  phev: "Plug-in hybrid",
  lpg: "LPG",
  cng: "CNG",
  other: "Other",
};

export function fuelLabel(fuel: string | null): string {
  if (!fuel) return "—";
  return FUEL_LABELS[fuel] ?? fuel;
}

export function transmissionLabel(t: string | null): string {
  if (!t) return "—";
  return t === "automatic" ? "Automatic" : "Manual";
}
