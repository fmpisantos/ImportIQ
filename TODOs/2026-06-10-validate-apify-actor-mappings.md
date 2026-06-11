---
title: Validate the mobile.de PPR actor output mapping against a real token
created: 2026-06-10
status: todo
priority: medium
---

## What
With a real `APIFY_TOKEN` saved, run a `direct`-mode search and confirm the
mobile.de pay-per-result actor's (`3x1t/mobile-de-scraper-ppr`) output fields
map correctly to the normalised listing shape.

Originally this covered all three Apify actors; rescoped 2026-06-11 — since
the direct-mode pivot, AS24 and OLX.pt are scraped keylessly with live-verified
mappings, and AutoUncle was dropped. The mobile.de actor is the only Apify
mapping left in the live path (the hybrid that joins mobile.de to direct
searches when a key is saved), and the Settings connection test only validates
the token, not the field mapping.

## Why
The mapper was built without a live Apify token, so the actor **output** field
names are mapped defensively across common aliases (the **input** field names
are from the actor's docs and are solid). A field that comes back `null` means
the real key differs from the aliases tried — and a silently null `priceEur`
or `co2GKm` corrupts the landed-cost verdict for mobile.de results.

## Notes
- Mapper: `server/src/adapters/sites/mobilede.js` (`mapItem`), invoked via
  `searchSiteApify` from `directSearch.js`.
- Verify: save an Apify token on the Settings page, then
  `curl -X POST localhost:3001/api/search -H 'Content-Type: application/json' -d '{"brand":"BMW","priceMax":20000}'`
- Check `priceEur`, `mileageKm`, `year`, `fuelType`, `co2GKm`, `url`,
  `thumbnailUrl` are populated for `source: "mobilede"` items.
- If the actor is swapped via `APIFY_MOBILEDE_ACTOR`, re-verify the mapping.
