---
title: Confirm/replace PT market read access for comparisons
created: 2026-06-10
status: todo
priority: medium
---

## What
Verify whether the official Portuguese APIs (OLX Partner API, Standvirtual API)
actually permit **searching other sellers' listings** for market comparison. If
not, fall back to a licensed data provider (e.g. Apify/Carapis) for the PT side.

## Why
Those APIs are oriented toward managing your *own* ads; read access for market
comparison is unconfirmed. The PT comparison is what produces the "Save/Premium"
verdict, so it must be backed by real data, not guesses.

## Notes
- Adapter: `server/src/adapters/ptMarketClient.js` (request/response field paths
  are best-effort — adjust to the granted API's real schema).
- The adapter boundary makes a provider swap a localised change; could reuse the
  new Apify path (`adapters/apifyClient.js`) with a Standvirtual/OLX scraper.
- See README "PT read-access caveat".
