---
title: Live-path pagination — global computed-sort + honest result counts
created: 2026-06-29
status: done
completed: 2026-06-29
priority: high
---

## What

Fixed two bugs in the `?live=1` on-demand scrape path (the store path was already
correct):

1. **Computed sort is now global.** `saving`/`margin`/`landed` can't be ordered
   by AutoScout24 (they come from our landed-cost + PT calc), so live mode only
   re-sorted *within* a page — the best deals on deeper AS24 pages never reached
   page 1. New `searchListingsDirectPageComputed` (`adapters/directSearch.js`) +
   `searchListingsPagedComputed` dispatcher (`adapters/source.js`) fetch the whole
   reachable pool (≤400), enrich + cost + PT-compare all of it (engine/PT injected
   as `costOne`/`sortValue` callbacks from the route so the adapter stays
   source-agnostic), rank globally (nulls last), and slice the page. The ranked
   pool is cached 12h keyed by filters + sort + `config.version`, so pages 2..N
   and repeat searches are instant. `german`/`year`/`mileage` keep the cheap
   per-page scrape (already globally correct).

2. **Honest counts.** `searchListingsDirectPage` reported AS24's full match count
   (thousands) while only ~400 cards are pageable. Now `totalResults` is clamped
   to the reachable count and a new `totalAvailable` carries AS24's raw count, so
   the UI shows "first N of M results" (`web/src/pages/SearchPage.jsx`).

## Outcome

Implemented across `routes/search.js`, `adapters/source.js`,
`adapters/directSearch.js`, `web/src/pages/SearchPage.jsx`. New
`server/test/livePage.test.js` (4 tests: reachable totals, global sort + page-2
cache hit, nulls-last, per-car cost-failure resilience) — all green. Full server
suite 225 pass / 3 fail (the 3 are the pre-existing settings data_source tests,
already tracked in `TODOs/2026-06-27-settings-tests-default-data-source.md`).
Web build passes.

## Notes / follow-up

- No CAPTCHA blocks the direct scrapers today (AS24/OLX/Standvirtual answer a
  plain desktop-UA fetch with 200); mobile.de is the exception (Akamai 403 →
  needs official API or Apify). The real ceiling is AS24's structural 20-page /
  400-card cap, which the batch sweep works around with price-band × sort
  fan-out.
- Logged `TODOs/2026-06-29-scraper-retry-backoff.md` — scrapers have no
  retry/backoff on 403/429.
