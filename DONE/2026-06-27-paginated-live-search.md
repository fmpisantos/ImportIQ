---
title: Paginated live search with 12h per-page cache + clear-cache button
created: 2026-06-27
status: done
completed: 2026-06-27
priority: high
---

> Outcome: Live path now scrapes exactly the requested page (window of AS24
> native pages), cached per filter-set+page for 12h. Verified live: page 1 vs 2
> return 0-overlap, contiguous price-sorted cars (~50/page), real totals
> (totalResults + totalPages capped at AS24's 20-page limit), cache re-hit in
> ~1ms. Store path now hides stale/sold. Clear-cache button added to Settings
> (`POST /api/settings/clear-cache`). 182/185 tests pass (3 pre-existing
> settingsRoutes failures unrelated). Batch-sweep fan-out spun out as a separate
> TODO.

## What
Make the on-demand live search ("Refresh live" / `?live=1`) a *true* paginated
scrape of the source sites instead of "fetch up to N cards, then slice":

- Each UI page fetches a window of AutoScout24's native pages (20 cards each),
  so the live path reaches the full 400-card / 20-page AS24 limit instead of the
  old ~60-card pool.
- Cache scraped pages for **12h**, keyed by the search filters **and the page**
  (`direct:as24:livepage:{…filters…,sort,desc,page,pageSize}`).
- Add a **Clear cache** button on the Settings page → `POST /api/settings/clear-cache`.
- Store path now **hides `stale`** deals (only `status='active'`), so sold/gone
  cars stop dominating the results.

## Why
Users saw "always the same cars". Root causes:
1. The default store sweep is a single unfiltered query; AS24 hard-caps any
   search at 20 pages (400 cards), so the sweep could only ever reach the same
   ~2,400 extreme-window cars across 6 sort orders.
2. The store showed `active`+`stale`; ~1,500 of ~1,963 visible deals were stale
   (unseen 3+ days, many already sold), pinned at the top of the saving sort.
3. The old live path fetched a 60-card pool and sliced — pagination never really
   reached deeper inventory.

## Notes
- AS24 `__NEXT_DATA__` exposes `numberOfResults` + `numberOfPages` → real totals
  (capped at the reachable 20 pages).
- Files: `adapters/direct/autoscout24.js` (page fetch), `adapters/directSearch.js`
  (window assembly + 12h cache), `adapters/source.js` (`searchListingsPaged`),
  `routes/search.js` (live path), `routes/settings.js` + `db.js` (clear cache),
  `web/src/{api.js,pages/SettingsPage.jsx,pages/SearchPage.jsx}`.
- Follow-up (separate): fan out the *batch* sweep across brand/price segments
  (`INGEST_SWEEP_QUERIES`) so the store itself covers more than the extreme
  windows. Not done here.
