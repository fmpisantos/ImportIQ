/**
 * The `mock` German source — deterministic, network-free (Specification §3.6).
 * Filters and paginates the fixture listings exactly as a real source would.
 */

import type { NormalizedListing, SearchFilters } from "@importiq/shared";
import { normalizeModelKey, yearOf } from "../../domain/normalize.js";
import { MOCK_GERMAN_LISTINGS } from "../fixtures.js";
import type { SourceAdapter, SourcePage } from "./types.js";

const PAGE_SIZE = 6;

/** Apply the user's filters to a listing (shared by mock + batch depth logic). */
export function matchesFilters(listing: NormalizedListing, f: SearchFilters): boolean {
  if (f.brand && listing.brand.toLowerCase() !== f.brand.toLowerCase()) return false;
  if (f.model) {
    const want = normalizeModelKey(f.model);
    const have = normalizeModelKey(listing.model);
    if (!want || !have || !have.includes(want)) return false;
  }
  if (f.priceMinEur != null && listing.priceEur < f.priceMinEur) return false;
  if (f.priceMaxEur != null && listing.priceEur > f.priceMaxEur) return false;
  if (f.yearFrom != null) {
    const y = yearOf(listing.firstRegistration);
    if (y != null && y < f.yearFrom) return false;
  }
  if (f.maxMileageKm != null && listing.mileageKm != null && listing.mileageKm > f.maxMileageKm) {
    return false;
  }
  if (f.fuelTypes.length > 0 && listing.fuelType != null && !f.fuelTypes.includes(listing.fuelType)) {
    return false;
  }
  if (f.transmission != null && listing.transmission != null && listing.transmission !== f.transmission) {
    return false;
  }
  return true;
}

export const mockSource: SourceAdapter = {
  id: "mock",
  async search(filters: SearchFilters, page: number): Promise<SourcePage> {
    const all = MOCK_GERMAN_LISTINGS.filter((l) => matchesFilters(l, filters));
    const start = (page - 1) * PAGE_SIZE;
    const listings = all.slice(start, start + PAGE_SIZE);
    return { listings, page, hasMore: start + PAGE_SIZE < all.length };
  },
};
