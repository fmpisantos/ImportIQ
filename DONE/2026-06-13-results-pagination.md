---
title: Paginate results — compute one page at a time
created: 2026-06-13
completed: 2026-06-13
status: done
priority: high
---

## What
The search returned/computed every matching listing at once. Added server-side
pagination so a search fetches the full (cheap) card pool but only **enriches +
costs + PT-compares the requested page** — page 2's expensive work happens when
you ask for it.

## How
- `POST /api/search` accepts `page` + `pageSize` (default 50) and returns
  `page`/`pageSize`/`total`/`totalPages`. It slices the pool and only computes
  that slice.
- Split fetch from enrichment: `searchListingsDirect` now returns the unenriched
  pool; new `enrichListingsDirect` (+ `source.js#enrichListings` dispatcher)
  detail-enriches just the page slice (AS24 CO₂). Apify/official/mock pass
  through (already complete).
- Direct card pool raised to 150 (`DIRECT_MAX_RESULTS`) — cards are cheap, so we
  fetch a multi-page pool once (cached) and paginate the costly steps over it.
- Frontend: Prev/Next controls + "page X of Y", remembers filters to re-run on
  page change, scrolls to top.

## Notes
- Trade-off: sorting applies to the current page only (server pagination computes
  one page at a time) — noted in the UI. A cross-page/server-side sort on the
  cheap card fields is a small follow-up.
- For model-specific searches the *real* match count is currently capped by the
  AS24 model-slug issue (`TODOs/2026-06-13-as24-model-server-filter.md`), not by
  pagination.
- Files: `routes/search.js`, `adapters/source.js`, `adapters/directSearch.js`,
  `config.js`, `web/src/pages/SearchPage.jsx`, `web/src/api.js` (page args),
  `web/src/styles.css`.
