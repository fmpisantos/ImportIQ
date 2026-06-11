---
title: Add DATA_SOURCE=direct — keyless scraping (AutoScout24 + OLX.pt/Standvirtual)
created: 2026-06-11
status: done
completed: 2026-06-11
priority: high
---

## What
Add a fourth data source, `direct`, that fetches real listings with plain
`fetch` and no third-party keys:

- **German listings — AutoScout24**: GET the normal search URL
  (`https://www.autoscout24.de/lst/<make>/<model>?atype=C&cy=D&...`) and parse
  the `<script id="__NEXT_DATA__">` JSON → `props.pageProps.listings`
  (20/page, paginate with `&page=N`). Verified working with a plain curl +
  desktop User-Agent on 2026-06-11 (HTTP 200, rich fields: price, mileage,
  firstRegistration, fuel, transmission, displacement, kW, zip/city, images,
  url). CO2/Euro-norm is often missing on the result card — fetch the detail
  page's `__NEXT_DATA__` lazily when the ISV calc needs real CO2, or keep the
  existing year-based `inferEmissionStandard` fallback.
- **PT market comparison — OLX.pt public API**: GET
  `https://www.olx.pt/api/v1/offers/?category_id=378&offset=0&limit=50&...`
  — open JSON, no auth (verified 2026-06-11). Cars category is 378; filters
  are passed as `filter_enum_*` / `filter_float_*` query params (inspect the
  site's own XHR for exact names: e.g. `filter_float_year:from`,
  `filter_float_mileage:to`, `filter_enum_marca`). Replaces the speculative
  `ptMarketClient.js` endpoints, which point at APIs we have no access to.
- **Standvirtual (optional second PT source)**: search HTML returns 200 with
  listings embedded in `__NEXT_DATA__` (`advertSearch` GraphQL state); their
  `/graphql` endpoint is also reachable. More fragile than OLX — keep OLX as
  the default PT provider.

Not scrapeable with plain HTTP (verified 403 / Akamai):
- **mobile.de** (suchen.mobile.de) — keep on Apify or a later headed-Playwright
  path (manual-captcha/challenge solve), or drop in direct mode.
- **AutoUncle** — 403; it's an aggregator of the other two anyway, low value.

## Why
Today the only real-data paths need either a paid Apify token or partner API
credentials (mobile.de Search API, OLX partner API) the user doesn't have.
AutoScout24 + OLX.pt cover both sides of the product (DE supply, PT market
price) for free. User explicitly asked for actual data without external keys.

## Notes
- Wire into `adapters/source.js` dispatch + `config.js` (`VALID_SOURCES` in
  `routes/settings.js`, Settings page option).
- Reuse `normalize.js` mapping helpers and the existing `listings_cache` /
  `pt_market_cache` SQLite caches; be polite (cache aggressively, 1 req/s,
  desktop UA, `Accept-Language: de-DE` / `pt-PT`).
- Other mock/placeholder data found in the audit (separate concerns):
  - `adapters/mobilede.js` `SAMPLE_LISTINGS` (5 fake cars) — mock mode only.
  - `adapters/ptmarket.js` `getComparisonMock` — fake 1.18–1.34× PT premium.
  - `adapters/brands.js` `POPULAR_BRANDS` — static dropdown list used in
    apify mode (fine; could be fed from AS24 makes list later).
  - `config/seed.js` — transport/legalisation amounts are intentional
    user-editable starters, not a bug.
  - `engine/isvTables.js:43` — a placeholder table mirrors the gasoline one;
    verify against the real Tabela ISV.

## Outcome
Shipped 2026-06-11. `DATA_SOURCE=direct` implemented and verified end-to-end
(real AS24 listings → ISV → real OLX.pt comparison → savings). Includes
detail-page CO₂ enrichment, German-number parsing fix, bidirectional model
post-filter, ISV incomplete-guard for missing CO₂/displacement, Settings UI +
connection test, README docs. mobile.de/AutoUncle remain Apify-only (403).
