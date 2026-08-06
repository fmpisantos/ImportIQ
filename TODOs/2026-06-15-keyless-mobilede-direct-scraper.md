---
title: Keyless mobile.de direct scraper (drop Apify dependency)
created: 2026-06-15
status: todo
priority: medium
---

## What
Add a keyless `direct/mobilede.js` adapter so `DATA_SOURCE=direct` can fetch mobile.de
listings without the paid Apify actor (`3x1t/mobile-de-scraper-ppr`). Mirror the existing
`direct/olxpt.js` JSON-adapter shape against mobile.de's public consumer JSON API:
`https://www.mobile.de/consumer/api/search/srp` (27 results/page, `pageNumber` ≤ 50;
params `ms` make/model, `fr` year, `ft` fuel, `mnp`/`mxp` price, `mnlm`/`mxlm` mileage).

## Why
`apify` mode costs ≈ $0.40 per fresh search (50 × 3 sites); mobile.de is the only foreign
source still forced onto Apify/official-API (AutoScout24, OLX, Standvirtual are already
keyless in `direct` mode). Going keyless drops that cost to $0. Documented as zone ⑤ of
`DataDefinition.excalidraw`.

## Notes
Steps (see the excalidraw zone ⑤ "BUILD STEPS" card for the full version):
- **0. SPIKE FIRST** — a bare request to the consumer API returns HTTP 403 (Akamai). Confirm
  it returns JSON with browser headers (UA + `Accept: application/json` + `Accept-Language`),
  possibly after a cookie-warmup `GET` on `www.mobile.de`. If it can't be made keyless,
  keep the official API (B2B) + Apify as fallbacks — do not remove them.
- Lift the duplicated `extractNextData()` (in `direct/autoscout24.js` + `direct/standvirtual.js`)
  into a shared util before adding a third consumer.
- `direct/mobilede.js`: own `HEADERS` + `fetchPage(url, fetchImpl)` → `res.json()`,
  `buildSearchUrl(filters)`, paginate to `maxResults`, `mapListing` → canonical shape (reuse
  `normalize.js` helpers + AS24's `germanInt`), brand-only fallback, `fetchImpl` test seam.
- Wire into `directSearch.js#searchListingsDirect` (`Promise.allSettled`) + a
  `searchMobiledeCached` wrapper (own cache key, 6h TTL in `listings_cache`).
- If SRP items lack CO₂/displacement, extend the `enrichMissingCo2` gate
  (currently `source === 'autoscout24'` only) + add a mobile.de detail fetcher.
- `config.js#getDirectConfig()`: add mobile.de keys + a `direct_sites` toggle.
- Direct path has **no timeout/retry/proxy** — add `AbortController` + small backoff for this
  Akamai-prone source; residential proxy only if IP-rate-limited.
- Fixture tests: inject a fake `fetchImpl` with a saved JSON response (per existing direct tests).
- robots.txt: the consumer API is allowed; `suchen.mobile.de` + `/auto-inserat/` are disallowed —
  use the API only.
- AutoUncle: low value (aggregator duplicating AS24, 403 on bare fetch) → recommend skipping.

Related: [[2026-06-10-validate-apify-actor-mappings]], [[2026-06-11-direct-scraper-health-check]].
