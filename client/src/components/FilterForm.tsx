import type {
  BrandsResponse,
  FuelType,
  MaxMileageOption,
  SearchFilters,
  Transmission,
} from "@importiq/shared";

// Fuel options offered in the UI (§3.2 lists these six; cng/other exist in the
// type but are not part of the primary filter set).
const FUEL_OPTIONS: { value: FuelType; label: string }[] = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "electric", label: "Electric" },
  { value: "hybrid", label: "Hybrid" },
  { value: "phev", label: "Plug-in hybrid" },
  { value: "lpg", label: "LPG" },
];

const MILEAGE_OPTIONS: MaxMileageOption[] = [
  30000, 50000, 80000, 100000, 150000, 200000,
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS: number[] = Array.from(
  { length: 25 },
  (_, i) => CURRENT_YEAR - i,
);

/** A blank filter set with the correct shape. */
export function emptyFilters(): SearchFilters {
  return {
    brand: null,
    model: null,
    priceMinEur: null,
    priceMaxEur: null,
    yearFrom: null,
    maxMileageKm: null,
    fuelTypes: [],
    transmission: null,
  };
}

function numOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function FilterForm({
  filters,
  onChange,
  brands,
  idPrefix = "f",
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  brands: BrandsResponse | null;
  idPrefix?: string;
}) {
  const set = (patch: Partial<SearchFilters>) =>
    onChange({ ...filters, ...patch });

  const models =
    brands?.brands.find((b) => b.name === filters.brand)?.models ?? [];

  const toggleFuel = (fuel: FuelType) => {
    const has = filters.fuelTypes.includes(fuel);
    set({
      fuelTypes: has
        ? filters.fuelTypes.filter((f) => f !== fuel)
        : [...filters.fuelTypes, fuel],
    });
  };

  return (
    <div className="filter-form">
      <div className="field">
        <label htmlFor={`${idPrefix}-brand`}>Brand</label>
        <select
          id={`${idPrefix}-brand`}
          value={filters.brand ?? ""}
          onChange={(e) =>
            // Changing brand clears the dependent model.
            set({ brand: e.target.value || null, model: null })
          }
        >
          <option value="">Any</option>
          {brands?.brands.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-model`}>Model</label>
        <select
          id={`${idPrefix}-model`}
          value={filters.model ?? ""}
          onChange={(e) => set({ model: e.target.value || null })}
          disabled={!filters.brand}
        >
          <option value="">Any</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-pmin`}>Price min (EUR)</label>
        <input
          id={`${idPrefix}-pmin`}
          type="number"
          inputMode="numeric"
          min={0}
          value={filters.priceMinEur ?? ""}
          onChange={(e) => set({ priceMinEur: numOrNull(e.target.value) })}
          placeholder="—"
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-pmax`}>Price max (EUR)</label>
        <input
          id={`${idPrefix}-pmax`}
          type="number"
          inputMode="numeric"
          min={0}
          value={filters.priceMaxEur ?? ""}
          onChange={(e) => set({ priceMaxEur: numOrNull(e.target.value) })}
          placeholder="—"
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-year`}>Year from</label>
        <select
          id={`${idPrefix}-year`}
          value={filters.yearFrom ?? ""}
          onChange={(e) => set({ yearFrom: numOrNull(e.target.value) })}
        >
          <option value="">Any</option>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-mileage`}>Max mileage</label>
        <select
          id={`${idPrefix}-mileage`}
          value={filters.maxMileageKm ?? ""}
          onChange={(e) => {
            const v = numOrNull(e.target.value);
            set({ maxMileageKm: (v as MaxMileageOption | null) ?? null });
          }}
        >
          <option value="">Any</option>
          {MILEAGE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m.toLocaleString("pt-PT")} km
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-trans`}>Transmission</label>
        <select
          id={`${idPrefix}-trans`}
          value={filters.transmission ?? ""}
          onChange={(e) =>
            set({
              transmission: (e.target.value || null) as Transmission | null,
            })
          }
        >
          <option value="">Any</option>
          <option value="automatic">Automatic</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <div className="field field--wide">
        <span className="field__label">Fuel type</span>
        <div className="checkbox-row">
          {FUEL_OPTIONS.map((opt) => (
            <label key={opt.value} className="checkbox">
              <input
                type="checkbox"
                checked={filters.fuelTypes.includes(opt.value)}
                onChange={() => toggleFuel(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
