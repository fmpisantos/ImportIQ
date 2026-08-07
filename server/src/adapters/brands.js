// Brand lists for the search filters and the ingest sweep.
//
// The scrapers accept free-text make/model, so these lists only decide what the
// UI offers as a pick — brand/model can also be typed directly.

import { VEHICLE_CATALOG } from '../data/vehicleCatalog.js';

/**
 * Brand → models for the filter dropdowns, derived from the curated vehicle
 * catalog so the filter list and the matcher (engine/vehicleMatch.js) can never
 * drift apart: whatever you can filter by, the matcher also knows.
 *
 * Curated only — deliberately NOT the generated catalog, whose Wikidata half
 * carries pre-war/obsolete models ("Peugeot Type 172") that would bury the real
 * picks in a dropdown. Adding a brand to data/vehicleCatalog.js adds it here.
 */
export const FILTER_BRANDS = Object.fromEntries(
  VEHICLE_CATALOG.map((entry) => [entry.brand, Object.keys(entry.models)]).sort(([a], [b]) =>
    a.localeCompare(b),
  ),
);

/**
 * Brands the batch ingestor fans its default sweep out across (config.js
 * buildDefaultSweepQueries). A deliberately short, high-volume subset — every
 * brand costs one more 400-card sweep per run, so this stays the popular core
 * rather than the whole filter list.
 */
export const SWEEP_BRANDS = [
  'Audi',
  'BMW',
  'Mercedes-Benz',
  'Volkswagen',
  'Volvo',
  'Toyota',
  'Renault',
  'Peugeot',
  'Ford',
  'Tesla',
  'Škoda',
  'SEAT',
];
