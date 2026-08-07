// Loads the vehicle catalog the matcher is seeded from. Prefers the generated
// file built from public datasets (scripts/build-vehicle-catalog.mjs) and falls
// back to the hand-written seed when it hasn't been built yet.
//
// The generated catalog is the authoritative source for breadth (every 2010+
// brand/model from the US year-indexed dataset + Wikidata); the curated seed is
// the fallback and the origin of the brand aliases + submodels overlaid at build
// time. Both share the same shape: [{ brand, aliases, models: { name: subs[] } }].
//
// The curated seed is ALSO overlaid at load time, so a brand or model added to
// vehicleCatalog.js reaches the matcher immediately — without re-running the
// build script (which needs network access to Wikidata + GitHub).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VEHICLE_CATALOG } from './vehicleCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(__dirname, 'vehicleCatalog.generated.json');

const key = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * Overlay the curated seed onto a base catalog. Curated brands/models/aliases
 * are added when missing; curated submodels win over the generated ones (they
 * describe real trims, the generated ones are usually empty). Pure.
 */
export function overlayCurated(base, curated = VEHICLE_CATALOG) {
  const byBrand = new Map(base.map((b) => [key(b.brand), { ...b, models: { ...b.models } }]));

  for (const entry of curated) {
    const existing = byBrand.get(key(entry.brand));
    if (!existing) {
      byBrand.set(key(entry.brand), {
        brand: entry.brand,
        aliases: [...(entry.aliases ?? [])],
        models: { ...entry.models },
      });
      continue;
    }
    existing.aliases = [...new Set([...(existing.aliases ?? []), ...(entry.aliases ?? [])])];
    const modelKeys = new Map(Object.keys(existing.models).map((m) => [key(m), m]));
    for (const [model, submodels] of Object.entries(entry.models)) {
      const match = modelKeys.get(key(model));
      if (!match) {
        existing.models[model] = [...submodels];
      } else if (submodels.length) {
        existing.models[match] = [...new Set([...submodels, ...existing.models[match]])];
      }
    }
  }
  return [...byBrand.values()];
}

export function loadVehicleCatalog() {
  try {
    const data = JSON.parse(readFileSync(GENERATED, 'utf8'));
    if (Array.isArray(data) && data.length) {
      return { catalog: overlayCurated(data), source: 'generated' };
    }
  } catch {
    /* not built yet — fall back to the curated seed */
  }
  return { catalog: VEHICLE_CATALOG, source: 'curated' };
}
