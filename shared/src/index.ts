/**
 * @importiq/shared — the single source of truth for the data shapes that cross
 * the wire between the server and the client.
 *
 * The golden rule of the product (Specification §0) is encoded directly in the
 * types here: any number we cannot compute or configure is `null`, and the
 * surrounding result is flagged `Incomplete` with a `missing[]` list. There is
 * deliberately no "0 means unknown" ambiguity anywhere in this model.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

/** German listing sources. `mock` is the deterministic, network-free source. */
export type SourceId = "autoscout24" | "mobilede" | "mock";

/** Portuguese comparison sources. */
export type PtSourceId = "standvirtual" | "olxpt" | "mock";

/** Normalised fuel enum, shared by every source after cleaning. */
export type FuelType =
  | "petrol"
  | "diesel"
  | "electric"
  | "hybrid"
  | "phev"
  | "lpg"
  | "cng"
  | "other";

/** Normalised transmission enum. */
export type Transmission = "automatic" | "manual";

/** CO₂ homologation cycle — decides which ISV environmental table applies. */
export type HomologationCycle = "WLTP" | "NEDC";

// ---------------------------------------------------------------------------
// Normalised listing (Specification §3.3)
// ---------------------------------------------------------------------------

/**
 * The one shape every German adapter returns. Adapters describe *where* a field
 * lives in their payload; the shared normaliser decides *how* it is cleaned.
 *
 * Fields that are absent on a source are `null` (never invented — §3.3).
 */
export interface NormalizedListing {
  sourceId: SourceId;
  sourceListingId: string;
  url: string;
  title: string;
  subtitle: string | null;

  brand: string;
  /** Trim-number model token, the cross-source join key (`320`, `X2`, `520`). */
  model: string;
  /** Auxiliary group label (`3 Series`) — never used as the PT join key. */
  modelGroup: string | null;
  /** Free-text variant/trim (`M Sport`, `Touring`) for variant disambiguation. */
  variant: string | null;

  priceEur: number;
  mileageKm: number | null;
  /** First registration as `YYYY-MM`. Drives age (ISV) and comparison. */
  firstRegistration: string | null;
  fuelType: FuelType | null;
  transmission: Transmission | null;

  /** Displacement in cm³. Needed for ISV. */
  engineCc: number | null;
  /** CO₂ g/km. Needed for ISV. */
  co2Gkm: number | null;
  /** Emission standard, e.g. `Euro6d-TEMP` (mobile.de exposes this directly). */
  emissionStandard: string | null;
  /** Power in kW (the canonical unit; PS/cv are converted to this). */
  powerKw: number | null;

  imageUrl: string | null;
  location: string | null;
}

// ---------------------------------------------------------------------------
// Search filters (Specification §3.2)
// ---------------------------------------------------------------------------

export type MaxMileageOption = 30000 | 50000 | 80000 | 100000 | 150000 | 200000;

export interface SearchFilters {
  brand: string | null;
  model: string | null;
  priceMinEur: number | null;
  priceMaxEur: number | null;
  yearFrom: number | null;
  maxMileageKm: MaxMileageOption | null;
  fuelTypes: FuelType[];
  transmission: Transmission | null;
}

// ---------------------------------------------------------------------------
// ISV / IUC engine output (Specification §5.2)
// ---------------------------------------------------------------------------

export type SpecialRegime =
  | "none"
  | "bev_exempt"
  | "phev_reduction"
  | "hybrid_reduction"
  | "cng_reduction";

/** A computed ISV result with the full breakdown so the UI can explain it. */
export interface IsvBreakdown {
  /** Component A — cylinder capacity (€). */
  cylinderComponentEur: number;
  /** Component B — environmental / CO₂ (€). */
  environmentalComponentEur: number;
  /** Diesel particulate surcharge (€), 0 when not applicable. */
  particulateSurchargeEur: number;
  /** Age reduction fraction applied to (A + B), e.g. 0.52 = 52%. */
  ageReductionFraction: number;
  /** Special regime applied and its reduction fraction (0 when none). */
  specialRegime: SpecialRegime;
  specialRegimeReductionFraction: number;
  /** Final ISV after age + regime reductions and the minimum floor. */
  totalEur: number;
  /** The CO₂ homologation cycle the environmental table was chosen for. */
  cycle: HomologationCycle;
  /** Fiscal-year tag of the tables used, e.g. `OE2026`. */
  tablesVersion: string;
  /**
   * Trust flag (Specification §5.2 decision): the Appendix B tables are an
   * unverified research draft. Always `true` until cross-checked against the
   * official Portal das Finanças simulator. The UI must surface this.
   */
  unverified: boolean;
}

export interface IucResult {
  annualEur: number | null;
  /** Why it could not be computed, when `annualEur` is null. */
  note: string | null;
  unverified: boolean;
}

// ---------------------------------------------------------------------------
// Landed cost (Specification §5.1, §5.4)
// ---------------------------------------------------------------------------

export interface LandedCostBreakdown {
  germanPriceEur: number;
  isv: IsvBreakdown | null;
  /** VAT only when the car is a "new means of transport" (§5.2.1). */
  vatEur: number | null;
  vatApplicable: boolean;
  transportEur: number | null;
  transportMethodLabel: string | null;
  legalisationEur: number | null;
  /** Itemised enabled legalisation fees that make up `legalisationEur`. */
  legalisationItems: { key: string; label: string; amountEur: number }[];
}

/**
 * The completeness invariant (§5.4): `totalLandedCostEur` is `null` whenever any
 * required component is missing, and `missing[]` names exactly what is absent.
 */
export interface LandedCost {
  breakdown: LandedCostBreakdown;
  totalLandedCostEur: number | null;
  incomplete: boolean;
  missing: string[];
  iuc: IucResult;
}

// ---------------------------------------------------------------------------
// Portuguese comparison (Specification §4.4)
// ---------------------------------------------------------------------------

export type EstimateMethod = "regression" | "median" | "mean";

export interface PtSourceContribution {
  sourceId: PtSourceId;
  sampleSize: number;
  error: string | null;
}

/** PT market value with full provenance (§4.4) so the user can judge it. */
export interface PtComparison {
  /** Robust PT market value, or `null` when there are too few comparables. */
  marketValueEur: number | null;
  unknown: boolean;
  /** Total comparables that survived matching + outlier trimming. */
  sampleSize: number;
  method: EstimateMethod | null;
  sources: PtSourceContribution[];
  /** Standvirtual's own per-listing rating distribution, as a free signal. */
  ratingSignal: { below: number; in: number; above: number } | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Result card (Specification §7)
// ---------------------------------------------------------------------------

export type SavingVerdict = "saving" | "loss" | "unknown";

export interface ResultCard {
  listing: NormalizedListing;
  landedCost: LandedCost;
  ptComparison: PtComparison;
  /** PT market value − total landed cost. `null` when either side is unknown. */
  savingEur: number | null;
  verdict: SavingVerdict;
}

// ---------------------------------------------------------------------------
// Cost configuration (Specification §6)
// ---------------------------------------------------------------------------

export type ConfigCategory = "transport" | "legalisation" | "other";

export interface CostConfigRow {
  key: string;
  label: string;
  category: ConfigCategory;
  amountEur: number;
  enabled: boolean;
  notes: string | null;
  /** Market-range guidance text — display only, never feeds the calculation. */
  guidance: string | null;
  updatedAt: string;
}

export interface ConfigResponse {
  rows: CostConfigRow[];
  activeTransportMethod: string | null;
  /** Keys the calculator needs but that are unset/disabled (drives the banner). */
  validationWarnings: string[];
}

// ---------------------------------------------------------------------------
// Batch searches (Specification §9)
// ---------------------------------------------------------------------------

export interface BatchSearch {
  id: string;
  name: string;
  filters: SearchFilters;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BatchResult {
  batchId: string;
  batchName: string;
  generatedAt: string;
  topDeals: ResultCard[];
}

// ---------------------------------------------------------------------------
// API request / response shapes (Specification §11)
// ---------------------------------------------------------------------------

export type SortKey =
  | "savingDesc"
  | "landedCostAsc"
  | "germanPriceAsc"
  | "yearDesc"
  | "mileageAsc";

export interface SearchRequest {
  filters: SearchFilters;
  /** Page cursor per source. Lazy "Next" advances each source's page (§7.4). */
  pages?: Partial<Record<SourceId, number>>;
  sort?: SortKey;
}

export interface SourceStatus {
  sourceId: SourceId;
  ok: boolean;
  /** Page just fetched (1-based). */
  page: number;
  hasMore: boolean;
  count: number;
  error: string | null;
}

export interface SearchResponse {
  results: ResultCard[];
  sources: SourceStatus[];
  /** Echoes the per-source page so the client can build the next request. */
  pages: Partial<Record<SourceId, number>>;
  sort: SortKey;
}

export interface BrandsResponse {
  brands: { name: string; models: string[] }[];
}

export interface HealthResponse {
  status: "ok";
  sourceMode: "mock" | "live";
  isvTablesVersion: string;
  isvVerified: boolean;
}
