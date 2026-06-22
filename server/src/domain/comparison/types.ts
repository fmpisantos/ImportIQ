import type { FuelType, PtSourceId } from "@importiq/shared";

/**
 * A Portuguese comparable listing, as returned by a PT source fetcher and fed
 * into the matcher. Power is already normalised to kW by the adapter (§4.2):
 * Standvirtual reports cv, which must be converted before comparison.
 */
export interface PtComparable {
  sourceId: PtSourceId;
  url: string;
  title: string;
  brand: string;
  model: string;
  variant: string | null;
  priceEur: number;
  mileageKm: number | null;
  /** Registration year (PT sources publish year, not month). */
  year: number | null;
  fuelType: FuelType | null;
  engineCc: number | null;
  powerKw: number | null;
  /** Standvirtual's own market rating, surfaced as a free provenance signal. */
  ratingIndicator: "BELOW" | "IN" | "ABOVE" | null;
}
