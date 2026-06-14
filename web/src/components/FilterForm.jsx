import { useEffect, useState } from 'react';
import { api } from '../api.js';

const BODY_TYPES = ['', 'SUV', 'Saloon', 'Estate', 'Coupé', 'Convertible', 'Van', 'Small'];
const FUELS = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'PHEV', 'LPG'];
const MILEAGES = [10000, 30000, 50000, 80000, 100000, 150000, 200000];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2009 }, (_, i) => 2010 + i);

const DEFAULTS = {
  brand: '',
  model: '',
  bodyType: '',
  priceMin: '',
  priceMax: '',
  yearFrom: '',
  maxMileageKm: '',
  fuelTypes: [],
  transmission: 'Any',
};

export default function FilterForm({ onRun, running }) {
  const [brands, setBrands] = useState({});
  const [filters, setFilters] = useState(DEFAULTS);

  useEffect(() => {
    api.getBrands().then(setBrands).catch(() => setBrands({}));
  }, []);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const toggleFuel = (fuel) =>
    setFilters((f) => ({
      ...f,
      fuelTypes: f.fuelTypes.includes(fuel)
        ? f.fuelTypes.filter((x) => x !== fuel)
        : [...f.fuelTypes, fuel],
    }));

  const submit = (e) => {
    e.preventDefault();
    // Coerce numeric strings → numbers, drop empties.
    const payload = {
      brand: filters.brand || undefined,
      model: filters.model || undefined,
      bodyType: filters.bodyType || undefined,
      priceMin: filters.priceMin ? Number(filters.priceMin) : undefined,
      priceMax: filters.priceMax ? Number(filters.priceMax) : undefined,
      yearFrom: filters.yearFrom ? Number(filters.yearFrom) : undefined,
      maxMileageKm: filters.maxMileageKm ? Number(filters.maxMileageKm) : undefined,
      fuelTypes: filters.fuelTypes,
      transmission: filters.transmission,
    };
    onRun(payload);
  };

  const models = filters.brand ? brands[filters.brand] ?? [] : [];

  return (
    <form className="filters card" onSubmit={submit}>
      <h2>Search filters</h2>

      <div className="grid">
        <label>
          Brand
          <select value={filters.brand} onChange={(e) => set({ brand: e.target.value, model: '' })}>
            <option value="">Any</option>
            {Object.keys(brands).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>

        <label>
          Model
          <select value={filters.model} onChange={(e) => set({ model: e.target.value })} disabled={!filters.brand}>
            <option value="">Any</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>

        <label>
          Body type
          <select value={filters.bodyType} onChange={(e) => set({ bodyType: e.target.value })}>
            {BODY_TYPES.map((b) => (
              <option key={b} value={b}>{b || 'Any'}</option>
            ))}
          </select>
        </label>

        <label>
          Price min (€)
          <input type="number" min="0" value={filters.priceMin} onChange={(e) => set({ priceMin: e.target.value })} />
        </label>

        <label>
          Price max (€)
          <input type="number" min="0" value={filters.priceMax} onChange={(e) => set({ priceMax: e.target.value })} />
        </label>

        <label>
          Year from
          <select value={filters.yearFrom} onChange={(e) => set({ yearFrom: e.target.value })}>
            <option value="">Any</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <label>
          Max mileage
          <select value={filters.maxMileageKm} onChange={(e) => set({ maxMileageKm: e.target.value })}>
            <option value="">Any</option>
            {MILEAGES.map((m) => (
              <option key={m} value={m}>{(m / 1000) + 'k km'}</option>
            ))}
          </select>
        </label>

        <label>
          Transmission
          <select value={filters.transmission} onChange={(e) => set({ transmission: e.target.value })}>
            <option>Any</option>
            <option>Automatic</option>
            <option>Manual</option>
          </select>
        </label>
      </div>

      <div className="fuel-pills">
        <span className="pill-label">Fuel</span>
        {FUELS.map((fuel) => (
          <button
            type="button"
            key={fuel}
            className={`pill ${filters.fuelTypes.includes(fuel) ? 'on' : ''}`}
            onClick={() => toggleFuel(fuel)}
          >
            {fuel}
          </button>
        ))}
      </div>

      <button className="run" type="submit" disabled={running}>
        {running ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}
