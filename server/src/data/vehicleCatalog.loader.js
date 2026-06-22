// Loads the vehicle catalog the matcher is seeded from. Prefers the generated
// file built from public datasets (scripts/build-vehicle-catalog.mjs) and falls
// back to the hand-written seed when it hasn't been built yet.
//
// The generated catalog is the authoritative source for breadth (every 2010+
// brand/model from the US year-indexed dataset + Wikidata); the curated seed is
// the fallback and the origin of the brand aliases + submodels overlaid at build
// time. Both share the same shape: [{ brand, aliases, models: { name: subs[] } }].

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VEHICLE_CATALOG } from './vehicleCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(__dirname, 'vehicleCatalog.generated.json');

export function loadVehicleCatalog() {
  try {
    const data = JSON.parse(readFileSync(GENERATED, 'utf8'));
    if (Array.isArray(data) && data.length) return { catalog: data, source: 'generated' };
  } catch {
    /* not built yet — fall back to the curated seed */
  }
  return { catalog: VEHICLE_CATALOG, source: 'curated' };
}
