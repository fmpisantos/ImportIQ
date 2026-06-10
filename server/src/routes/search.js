// Bot run / search API (PLAN.md §9 data flow).
//   POST /api/search   → run the bot: query mobile.de, compute landed cost,
//                        attach PT comparison, return enriched results.
//   GET  /api/brands   → brand → models map for the filter dropdowns.

import { Router } from 'express';
import { searchListings, listBrandsAndModels } from '../adapters/source.js';
import { getComparison } from '../adapters/ptmarket.js';
import { buildConfigView } from '../db.js';
import { computeLandedCost, attachComparison } from '../engine/landedCost.js';

const router = Router();

router.get('/brands', async (req, res, next) => {
  try {
    res.json(await listBrandsAndModels());
  } catch (err) {
    next(err);
  }
});

router.post('/search', async (req, res, next) => {
  try {
    const filters = req.body ?? {};

    // Load real cost values once per run (cached for the run's duration).
    const config = buildConfigView();

    const listings = await searchListings(filters);

    // Per listing: compute landed cost, then attach the PT comparison.
    const results = await Promise.all(
      listings.map(async (listing) => {
        const computed = computeLandedCost(listing, config);
        const comparison = await getComparison(listing);
        return attachComparison(computed, comparison);
      })
    );

    res.json({
      ranAt: new Date().toISOString(),
      filters,
      activeTransportMethod: config.activeTransportMethod,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
