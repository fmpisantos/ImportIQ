// Bot run / search API (PLAN.md §9 data flow).
//   POST /api/search       → read pre-computed deals from the batch-filled store
//                           (plain SQL filter/sort/paginate). Instant — no live
//                           scrape. Add `?live=1` (or { live: true }) to run the
//                           old live path for one query on demand.
//   GET  /api/brands       → brand → models map for the filter dropdowns.

import { Router } from 'express';
import { searchListings, enrichListings, listBrandsAndModels } from '../adapters/source.js';
import { getComparison } from '../adapters/ptmarket.js';
import { buildConfigView, getDealsPage } from '../db.js';
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

// Map the UI's sort key to the store's server-side ORDER BY, so sorting spans
// the whole result set (not just the current page).
const SORT_MAP = {
  saving: 'saving',
  margin: 'margin',
  landed: 'landed',
  german: 'price',
  year: 'year',
  mileage: 'mileage',
};

router.post('/search', async (req, res, next) => {
  try {
    const filters = req.body ?? {};
    const config = buildConfigView();
    const haircutRow = config.byKey['resale.asking_to_sale_haircut_pct'];
    const resaleHaircutPct = haircutRow && haircutRow.enabled ? haircutRow.amount_eur : 0;
    const now = new Date();

    const live = filters.live === true || /^(1|true|yes)$/i.test(String(req.query.live ?? ''));
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));

    // --- Default path: read pre-computed deals from the store (instant) -------
    if (!live) {
      const { results: stored, total, totalPages } = getDealsPage(filters, {
        sort: SORT_MAP[filters.sort] ?? 'saving',
        page,
        pageSize,
      });
      // German-price sanity is a read-time pass over the page (same as before).
      const results = annotateGermanPriceSanity(stored);
      res.json({
        ranAt: now.toISOString(),
        source: 'store',
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
      return;
    }

    // --- Escape hatch (?live=1): the old live path for one query on demand ----
    const reference = { referenceYear: now.getFullYear(), referenceMonth: now.getMonth() + 1 };
    const pool = await searchListings(filters);
    const total = pool.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageSlice = pool.slice((page - 1) * pageSize, page * pageSize);

    const enriched = await enrichListings(pageSlice, { now: now.getTime() });
    const computedResults = await Promise.all(
      enriched.map(async (listing) => {
        const computed = computeLandedCost(listing, config, reference);
        const comparison = await getComparison(listing);
        return attachComparison(computed, comparison, { resaleHaircutPct });
      })
    );
    const results = annotateGermanPriceSanity(computedResults);

    res.json({
      ranAt: now.toISOString(),
      source: 'live',
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

// Re-cost a single already-computed result under a user-chosen emission standard
// (WLTP/NEDC). The store serves pre-computed deals, so this is how the UI's
// per-listing override re-runs just the ISV + verdict without a fresh scrape.
// Body: { result, emissionStandard }. The PT comparison is reused as-is (the
// market value doesn't change), only the landed cost and saving are recomputed.
router.post('/recompute', (req, res, next) => {
  try {
    const { result: prior, emissionStandard } = req.body ?? {};
    const listing = prior?.listing;
    if (!listing || typeof listing !== 'object') {
      res.status(400).json({ error: 'result.listing is required' });
      return;
    }
    if (!['WLTP', 'NEDC'].includes(emissionStandard)) {
      res.status(400).json({ error: 'emissionStandard must be "WLTP" or "NEDC"' });
      return;
    }

    const config = buildConfigView();
    const haircutRow = config.byKey['resale.asking_to_sale_haircut_pct'];
    const resaleHaircutPct = haircutRow && haircutRow.enabled ? haircutRow.amount_eur : 0;
    const now = new Date();

    const computed = computeLandedCost(listing, config, {
      referenceYear: now.getFullYear(),
      referenceMonth: now.getMonth() + 1,
      emissionStandard,
    });
    let result = attachComparison(computed, prior.comparison ?? null, { resaleHaircutPct });

    // The German-price sanity verdict is run-scoped (needs the other listings as
    // peers) and the price is unchanged here, so preserve the original flag
    // rather than recomputing it from a single listing.
    if (prior.germanPriceSuspicious) {
      result = {
        ...result,
        germanPriceSuspicious: true,
        germanPriceNotes: prior.germanPriceNotes,
      };
    }

    res.json({ result });
  } catch (err) {
    next(err);
  }
});

export default router;
