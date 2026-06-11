---
title: Confirm/replace PT market read access for comparisons
created: 2026-06-10
status: done
completed: 2026-06-11
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

## Outcome
Closed 2026-06-11 without implementation — obsolete. The direct-scrape pivot
(`DONE/2026-06-11-direct-scrape-data-source.md`) backs the PT comparison with
the keyless OLX.pt open API (real data, verified live), so confirming partner
API read access no longer blocks anything. `ptMarketClient.js` remains only as
the optional `official` path for users who do hold credentials.
