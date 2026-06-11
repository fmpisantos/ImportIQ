---
title: Detect direct-scraper breakage (AS24 / OLX.pt) instead of failing silently
created: 2026-06-11
status: todo
priority: high
---

## What
The `direct` data source depends on undocumented site internals: AutoScout24's
`__NEXT_DATA__` page payload and OLX.pt's open `/api/v1/offers` endpoint.
Either can change shape (or start blocking) at any time, and today that would
most likely surface as an empty result list or a PT comparison that quietly
disappears — indistinguishable from "no matching cars". Add breakage
detection:

- **Distinguish "scraper broke" from "no matches"** in the adapters: HTTP
  errors, missing `__NEXT_DATA__`, unparseable JSON, or a 200 page with zero
  listings *and* zero result-count metadata should raise a typed error, not
  return `[]`. Surface it in the UI ("source unavailable") and on the
  Settings connection test.
- **Smoke test / health check**: a known-broad query (e.g. any-brand,
  priceMax high) asserting >0 listings with `priceEur`, `year`, `mileageKm`,
  `url` populated, for both AS24 and OLX.pt. Runnable on demand (script or
  `/api/health/sources` endpoint) so breakage is caught before a real search
  misleads the user — and a natural alert hook once the scheduler
  (2026-06-10-scheduler-and-email-alerts.md) exists.
- **Field-level canary**: warn when a batch comes back with a critical field
  (`priceEur`, `mileageKm`) null across all items — the classic symptom of a
  renamed key after a site redesign.

## Why
The 2026-06-11 pivot made keyless scraping the primary data path, trading API
stability for zero cost. The failure mode of that trade is *silent wrongness*:
a search that shows fewer cars, or verdicts without a PT comparison, with no
hint anything is broken. For a tool whose core promise is a trustworthy
deal verdict, "loudly broken" must replace "quietly wrong".

## Notes
- Adapters: `server/src/adapters/direct/{autoscout24,olxpt}.js`;
  orchestrator `directSearch.js` already degrades gracefully per-source — it
  needs the error signal to degrade *visibly*.
- The Settings page already has a connection-test pattern to extend.
- Keep the smoke test out of the default `node --test` run (it hits the
  network); a separate npm script (e.g. `npm run smoke`) is fine.
