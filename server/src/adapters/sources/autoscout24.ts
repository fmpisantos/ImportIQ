/**
 * AutoScout24 live adapter (Specification §3.5, Appendix A.2).
 *
 * Keyless: the full result set is embedded as JSON in
 * `<script id="__NEXT_DATA__">` → `props.pageProps.listings[]`. We map each
 * listing through the shared normalisers and apply our own filter predicate as a
 * safety net (so a token-level model filter still holds even though AS24 filters
 * make/model by numeric ID we don't always resolve).
 *
 * Fields absent on the search card (notably CO₂) stay `null` here and make the
 * landed cost Incomplete unless detail-page enrichment fills them (§3.3). This
 * adapter is best-effort; the `mock` source is the verified offline path.
 */

import type { NormalizedListing, SearchFilters, FuelType, Transmission } from "@importiq/shared";
import {
  normalizeFuel,
  normalizeTransmission,
  parseFirstRegistration,
  parseInteger,
} from "../../domain/normalize.js";
import { extractNextData, fetchText } from "../http.js";
import { matchesFilters } from "./mock.js";
import type { SourceAdapter, SourcePage } from "./types.js";

const BASE = "https://www.autoscout24.com";

const FUEL_PARAM: Partial<Record<FuelType, string>> = {
  petrol: "B",
  diesel: "D",
  electric: "E",
  hybrid: "2",
  phev: "2",
  lpg: "L",
  cng: "C",
};
const GEAR_PARAM: Record<Transmission, string> = { automatic: "A", manual: "M" };

/** Brand display name → AS24 path slug for the common cases. */
const BRAND_SLUG: Record<string, string> = {
  vw: "volkswagen",
  "mercedes-benz": "mercedes-benz",
};

function brandSlug(brand: string): string {
  const key = brand.trim().toLowerCase();
  return BRAND_SLUG[key] ?? key.replace(/\s+/g, "-");
}

function buildUrl(filters: SearchFilters, page: number): string {
  const path = filters.brand ? `/lst/${brandSlug(filters.brand)}` : "/lst";
  const p = new URLSearchParams();
  p.set("sort", "price");
  p.set("desc", "0");
  p.set("ustate", "N,U");
  p.set("cy", "D");
  p.set("page", String(page));
  if (filters.priceMinEur != null) p.set("pricefrom", String(filters.priceMinEur));
  if (filters.priceMaxEur != null) p.set("priceto", String(filters.priceMaxEur));
  if (filters.yearFrom != null) p.set("fregfrom", String(filters.yearFrom));
  if (filters.maxMileageKm != null) p.set("kmto", String(filters.maxMileageKm));
  if (filters.transmission) p.set("gear", GEAR_PARAM[filters.transmission]);
  const fuels = filters.fuelTypes.map((f) => FUEL_PARAM[f]).filter(Boolean) as string[];
  if (fuels.length > 0) p.set("fuel", fuels.join(","));
  return `${BASE}${path}?${p.toString()}`;
}

interface As24Listing {
  id?: string;
  url?: string;
  vehicle?: {
    make?: string;
    model?: string;
    modelGroup?: string;
    variant?: string;
    modelVersionInput?: string;
    fuel?: string;
    transmission?: string;
    engineDisplacementInCCM?: string;
    mileageInKm?: string;
  };
  tracking?: { price?: string; mileage?: string; firstRegistration?: string };
  vehicleDetails?: { ariaLabel?: string; data?: string }[];
  wltpValues?: string[];
  images?: string[];
  location?: { zip?: string; city?: string; countryCode?: string };
}

/** Parse the kW figure from AS24's power label, e.g. "140 kW (190 hp)". */
function parsePowerKw(details: As24Listing["vehicleDetails"]): number | null {
  const power = details?.find((d) => d.ariaLabel === "Power")?.data;
  if (!power) return null;
  const m = /([\d.,]+)\s*kW/i.exec(power);
  return m ? parseInteger(m[1]) : null;
}

function parseCo2(wltp: string[] | undefined): number | null {
  const entry = wltp?.find((v) => /g\/km/i.test(v));
  return entry ? parseInteger(entry) : null;
}

function mapListing(raw: As24Listing): NormalizedListing | null {
  const v = raw.vehicle ?? {};
  const priceEur = parseInteger(raw.tracking?.price);
  if (!v.make || !v.model || priceEur == null) return null; // can't normalise → skip

  const url = raw.url ? (raw.url.startsWith("http") ? raw.url : `${BASE}${raw.url}`) : BASE;
  return {
    sourceId: "autoscout24",
    sourceListingId: raw.id ?? url,
    url,
    title: `${v.make} ${v.model}`,
    subtitle: v.variant ?? v.modelVersionInput ?? null,
    brand: v.make,
    model: v.model,
    modelGroup: v.modelGroup ?? null,
    variant: v.variant ?? v.modelVersionInput ?? null,
    priceEur,
    mileageKm: parseInteger(raw.tracking?.mileage ?? v.mileageInKm),
    firstRegistration: parseFirstRegistration(raw.tracking?.firstRegistration),
    fuelType: normalizeFuel(v.fuel),
    transmission: normalizeTransmission(v.transmission),
    engineCc: parseInteger(v.engineDisplacementInCCM),
    co2Gkm: parseCo2(raw.wltpValues),
    emissionStandard: null,
    powerKw: parsePowerKw(raw.vehicleDetails),
    imageUrl: raw.images?.[0] ?? null,
    location: raw.location
      ? [raw.location.zip, raw.location.city, raw.location.countryCode].filter(Boolean).join(" / ")
      : null,
  };
}

export const autoscout24Source: SourceAdapter = {
  id: "autoscout24",
  async search(filters: SearchFilters, page: number): Promise<SourcePage> {
    const html = await fetchText(buildUrl(filters, page));
    const data = extractNextData(html) as
      | { props?: { pageProps?: { listings?: As24Listing[]; numberOfPages?: number } } }
      | null;
    const pageProps = data?.props?.pageProps;
    const raw = pageProps?.listings ?? [];
    const listings = raw
      .map(mapListing)
      .filter((l): l is NormalizedListing => l !== null)
      .filter((l) => matchesFilters(l, filters));
    const numberOfPages = pageProps?.numberOfPages ?? page;
    return { listings, page, hasMore: page < Math.min(numberOfPages, 20) };
  },
};
