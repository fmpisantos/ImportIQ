// Bot run / search API (PLAN.md §9 data flow).
//   POST /api/search       → read pre-computed deals from the batch-filled store
//                           (plain SQL filter/sort/paginate). Instant — no live
//                           scrape. Add `?live=1` (or { live: true }) to run the
//                           old live path for one query on demand.
//   GET  /api/brands       → brand → models map for the filter dropdowns.

import { Router } from 'express';
import {
  searchListingsPaged,
  searchListingsPagedComputed,
  enrichListings,
  listBrandsAndModels,
} from '../adapters/source.js';
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

// Live scraping can't order by a *computed* key (saving/landed depend on our
// calc, which AS24 knows nothing about), so map the UI sort onto the nearest
// source-side ordering and let the page re-sort within itself. Computed-only
// sorts fall back to AS24's relevance order.
const LIVE_SORT_MAP = {
  german: { sort: 'price', desc: 0 },
  year: { sort: 'age', desc: 1 },
  mileage: { sort: 'mileage', desc: 0 },
};

// Computed sorts can't be ordered source-side (they depend on our landed-cost +
// PT calc), so the live path ranks the whole reachable pool instead of a single
// page. `value` reads the ranking key off a computed result; `desc` is the
// direction (savings/margin high→low, landed low→high).
const COMPUTED_SORT_SPEC = {
  saving: { value: (r) => r.savingEur, desc: 1 },
  margin: { value: (r) => r.marginEur, desc: 1 },
  landed: { value: (r) => r.totalLandedCostEur, desc: 0 },
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
        totalAvailable: null, // store total is exact — no "first N of M" headroom
        count: results.length,
        results,
      });
      return;
    }

    // --- Escape hatch (?live=1): paginated live scrape for one query on demand -
    const reference = { referenceYear: now.getFullYear(), referenceMonth: now.getMonth() + 1 };

    // Cost one listing into a full result, never throwing — a PT hiccup for one
    // car shouldn't sink the page (it's costed with a null comparison instead).
    const costOne = async (listing) => {
      const computed = computeLandedCost(listing, config, reference);
      let comparison = null;
      try {
        comparison = await getComparison(listing);
      } catch {
        comparison = null;
      }
      return attachComparison(computed, comparison, { resaleHaircutPct });
    };

    const computedSpec = COMPUTED_SORT_SPEC[filters.sort];
    let results;
    let total;
    let totalPages;
    let totalAvailable;

    if (computedSpec) {
      // Computed sort → rank the whole reachable pool, then slice the page.
      const paged = await searchListingsPagedComputed(filters, {
        now: now.getTime(),
        page,
        pageSize,
        sort: filters.sort,
        desc: computedSpec.desc,
        configVersion: config.version,
        costOne,
        sortValue: computedSpec.value,
      });
      results = annotateGermanPriceSanity(paged.results);
      total = paged.total;
      totalPages = paged.totalPages;
      totalAvailable = paged.totalAvailable ?? null;
    } else {
      // Source-orderable sort (german/year/mileage/default) → cheap per-page
      // scrape; AS24 sorts the full result set, so paging is already global.
      const liveSort = LIVE_SORT_MAP[filters.sort] ?? { sort: 'standard', desc: 0 };
      const paged = await searchListingsPaged(filters, {
        now: now.getTime(),
        page,
        pageSize,
        sort: liveSort.sort,
        desc: liveSort.desc,
      });
      const enriched = await enrichListings(paged.listings, { now: now.getTime() });
      const computedResults = await Promise.all(enriched.map(costOne));
      results = annotateGermanPriceSanity(computedResults);
      total = paged.totalResults;
      totalPages = paged.totalPages;
      totalAvailable = paged.totalAvailable ?? null;
    }

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
      totalAvailable,
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
