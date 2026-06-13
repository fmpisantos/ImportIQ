// Bot run / search API (PLAN.md §9 data flow).
//   POST /api/search   → run the bot: query mobile.de, compute landed cost,
//                        attach PT comparison, return enriched results.
//   GET  /api/brands   → brand → models map for the filter dropdowns.

import { Router } from 'express';
import { searchListings, enrichListings, listBrandsAndModels } from '../adapters/source.js';
import { getComparison } from '../adapters/ptmarket.js';
import { buildConfigView } from '../db.js';
import { computeLandedCost, attachComparison } from '../engine/landedCost.js';
import { annotateGermanPriceSanity } from '../engine/priceSanity.js';

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

    // Resale haircut (asking → sale): an optional 'other' cost-config row. When
    // enabled, the verdict also shows the real expected margin, not just the
    // saving vs PT asking. Off (0) by default.
    const haircutRow = config.byKey['resale.asking_to_sale_haircut_pct'];
    const resaleHaircutPct = haircutRow && haircutRow.enabled ? haircutRow.amount_eur : 0;

    const now = new Date();
    const reference = { referenceYear: now.getFullYear(), referenceMonth: now.getMonth() + 1 };

    // Pagination: fetch the full pool of matching cards (cheap — cached), but
    // only enrich + cost + PT-compare the requested page, so a search computes
    // ~one page at a time and page 2's work happens when you ask for it.
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));

    const pool = await searchListings(filters);
    const total = pool.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageSlice = pool.slice((page - 1) * pageSize, page * pageSize);

    // Detail-enrich just this page (AutoScout24 CO₂), then cost + compare it.
    const enriched = await enrichListings(pageSlice, { now: now.getTime() });
    const computedResults = await Promise.all(
      enriched.map(async (listing) => {
        const computed = computeLandedCost(listing, config, reference);
        const comparison = await getComparison(listing);
        return attachComparison(computed, comparison, { resaleHaircutPct });
      })
    );

    // Flag implausibly-low German prices (parse errors / damaged listings) by
    // comparing each against its same-model peers on this page.
    const results = annotateGermanPriceSanity(computedResults);

    res.json({
      ranAt: now.toISOString(),
      filters,
      activeTransportMethod: config.activeTransportMethod,
      resaleHaircutPct: resaleHaircutPct || null,
      page,
      pageSize,
      total,
      totalPages,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
