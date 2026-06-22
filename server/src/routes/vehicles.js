// Vehicle catalog + fuzzy-match API.
//   GET /api/vehicles/match?q=…&limit=…  → ranked brand+model matches for free text.
//   GET /api/vehicles                     → the catalog (brands → models) + counts.
//
// The match index is tokenized once from the SQLite catalog and cached for the
// process; it's reference data that only changes on a reseed/reboot.

import { Router } from 'express';
import { getVehicleCatalog } from '../db.js';
import { buildVehicleIndex, matchVehicle } from '../engine/vehicleMatch.js';

const router = Router();

let cachedIndex = null;
function getIndex() {
  if (!cachedIndex) cachedIndex = buildVehicleIndex(getVehicleCatalog());
  return cachedIndex;
}

// Lightweight counts for the UI (avoids shipping the whole catalog just to show
// how many brands/models the matcher is backed by).
router.get('/stats', (req, res, next) => {
  try {
    const catalog = getVehicleCatalog();
    res.json({
      brands: catalog.length,
      models: catalog.reduce((n, b) => n + Object.keys(b.models).length, 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/match', (req, res, next) => {
  try {
    const q = String(req.query.q ?? '');
    const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 5));
    const index = getIndex();
    const matches = matchVehicle(q, index, { limit });
    res.json({
      query: q,
      count: matches.length,
      best: matches[0] ?? null,
      matches,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const catalog = getVehicleCatalog();
    const brands = catalog.length;
    const models = catalog.reduce((n, b) => n + Object.keys(b.models).length, 0);
    res.json({ brands, models, catalog });
  } catch (err) {
    next(err);
  }
});

export default router;
