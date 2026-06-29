---
title: Add retry/backoff to direct scrapers on 403/429
created: 2026-06-29
status: todo
priority: medium
---

## What

The keyless direct scrapers (`adapters/direct/autoscout24.js`,
`adapters/direct/olxpt.js`, `adapters/direct/standvirtual.js`) make a single
`fetch` per page with no retry or backoff. On a transient block (HTTP 403/429,
network blip) `fetchPage` just throws:

- live search → the requested page errors out (or, for a computed-sort pool, the
  whole pool fetch fails);
- batch sweep → that sweep query is skipped for the run;
- detail enrich → the listing is left `enrich_pending` and retried next run.

Add a small bounded retry with exponential backoff + jitter (e.g. 2–3 attempts)
around the shared `fetchPage` helpers, treating 429/503/5xx and network errors as
retryable and honouring `Retry-After` when present. Leave terminal 404s alone.

## Why

There's no CAPTCHA blocking us today (AS24/OLX/Standvirtual answer a plain
desktop-UA fetch with 200), but the only thing absorbing an occasional throttle
is the next scheduled run. A single retry would make live searches and the sweep
noticeably more robust without changing behaviour in the happy path.

## Notes

- Surfaced while implementing global computed-sort + reachable counts for the
  live path (see DONE/2026-06-29-live-pagination-computed-sort.md).
- Keep the politeness delays (`DIRECT_REQUEST_DELAY_MS`) — backoff is on top.
- mobile.de is a separate case: it 403s structurally (Akamai), so it needs the
  official API or an Apify token, not a retry.
- Consider a shared `fetchWithRetry(url, headers, { fetchImpl })` helper so all
  three adapters share one policy; keep `fetchImpl` injectable for tests.
