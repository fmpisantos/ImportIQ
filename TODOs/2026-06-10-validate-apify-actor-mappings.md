---
title: Validate live Apify actor output mappings against a real token
created: 2026-06-10
status: todo
priority: high
---

## What
Run a real search in `DATA_SOURCE=apify` mode with a valid `APIFY_TOKEN` and
confirm each site's output fields map correctly to the normalised listing shape.

## Why
The adapters were built without a live Apify token, so the actor **output**
field names are mapped defensively across common aliases (the **input** field
names are from each actor's docs and are solid). A field that comes back `null`
means the real key differs from the aliases tried.

## Notes
- Mappers: `server/src/adapters/sites/{mobilede,autoscout24,autouncle}.js`
  (`mapItem`).
- Verify: `curl -X POST localhost:3001/api/search -H 'Content-Type: application/json' -d '{"brand":"BMW","priceMax":20000}'`
- Check `priceEur`, `mileageKm`, `year`, `fuelType`, `co2GKm`, `url`,
  `thumbnailUrl` are populated for each `source`.
- If an actor is swapped via `APIFY_*_ACTOR`, re-verify the mapping.
