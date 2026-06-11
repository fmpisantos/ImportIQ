---
title: Optional mobile.de coverage on top of direct mode (Apify PPR or Playwright)
created: 2026-06-11
status: done
completed: 2026-06-11
priority: medium
---

## What
Decide and wire one of two ways to add mobile.de listings alongside the free
`direct` mode (mobile.de blocks plain HTTP with Akamai — verified 403):

1. **Apify pay-per-result actor** (cheapest, least code): use
   `3x1t/mobile-de-scraper-ppr` ($0.80 / 1,000 results, billed against Apify
   platform credits — the free Apify plan includes $5/month, ≈ 6,250 results).
   Could run as a *hybrid*: `direct` mode scrapes AS24 itself and additionally
   runs only the mobile.de actor when an `APIFY_TOKEN` is present.
   Alternative default actor `3x1t/mobile-de-scraper` is a $9.99/month rental
   + compute — only worth it at high volume.
2. **Headed Playwright** (free, more code/maintenance): persistent browser
   profile usually passes Akamai; pause for a manual challenge solve in a
   visible tab when needed. Fits the "solve captcha by hand, bot keeps going"
   idea, but adds browser automation and session upkeep.

## Why
AutoScout24 alone already covers the German market well, but mobile.de is the
largest source and sometimes has better prices. User asked for a per-request /
monthly cost picture before committing (see cost analysis in chat,
2026-06-11).

## Notes
- Cost math (PPR actor): a 50-result search ≈ $0.04. 10 searches/day with the
  6h cache ≈ $1.2/month; 50/day ≈ $6/month — mostly covered by Apify's free
  $5/month credits at light usage.
- If hybrid: reuse `sites/mobilede.js` (Apify input builder/mapper) from
  `directSearch.js`, gate on token presence, override actor id via
  `APIFY_MOBILEDE_ACTOR=3x1t/mobile-de-scraper-ppr`.

## Outcome
Shipped 2026-06-11 (option 1, extended): mobile.de now joins the `direct`
search automatically whenever a key for it is saved — dealer credentials
(official API) take precedence over an Apify token (default actor switched to
the pay-per-result `3x1t/mobile-de-scraper-ppr`, no rental needed). No key →
mobile.de skipped, AS24-only search. Settings page shows live include/skip
status and the connection test validates whichever key would be used. A
failing mobile.de source degrades gracefully (verified with a bogus token).
Playwright path not pursued.
