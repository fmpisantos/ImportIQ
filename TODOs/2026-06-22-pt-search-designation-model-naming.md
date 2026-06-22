---
title: PT search uses catalog model names verbatim — refine for designation models
created: 2026-06-22
status: todo
priority: medium
---

## What
The PT market comparison now resolves each listing's brand+model through the
fuzzy matcher (`engine/vehicleResolver.js`) and searches Portugal under the
**canonical catalog brand+model, used verbatim** (chosen behaviour). This is a
clear win for body-named models (Golf, Polo, A4, Q5 …) and for typo'd/aliased
brands ("vw" → Volkswagen → right OLX category).

It under-performs for **numeric-designation models**: the catalog uses US-style
names ("3 Series", "C-Class") while PT sites (and the German source) use the
designation ("320", "Série 3" / "C 220", "Classe C"). So:
- `BMW 320d Touring` → searches OLX `query=3 Series` (PT ads say "320")
- `Mercedes C 220 d` → searches OLX `query=C-Class` (PT ads say "C 220")

Those searches return fewer comparables than the old raw-string path did.

## Why
Fewer comparables → more listings fall under the reliability floor
(`MIN_RELIABLE_SAMPLE`) and lose their saving/verdict. The matcher buys us clean
brand mapping + identity display; we shouldn't lose PT recall on prestige-brand
designation models to get it.

## Notes
Refinement (the "family-key from both" hybrid, declined for the first cut):
derive the PT model search key from whichever of {raw listing model, canonical
catalog model} yields a usable token — try `normalizeModelKey(listing.model)`
first ("320d"→"320", "C 220 d"→"220"... check that one), else the catalog model,
else brand-only. Keep the canonical brand + the displayed matched identity as-is.

Pointers:
- `server/src/adapters/direct/ptComparison.js` — `getComparisonCombined` builds
  `subject` from `resolveVehicle(...)`; the model swap happens there.
- `server/src/engine/vehicleResolver.js` — `MIN_RESOLVE_SCORE`, `resolveVehicle`.
- `server/src/adapters/normalize.js#normalizeModelKey` — the family-key stripper.
- `server/src/adapters/ptMarketClient.js#comparableMatches` — directional model
  contains-check that the verbatim catalog name currently fights.
- Acceptance: a `BMW 320d` listing searches PT on "320" again while still
  showing the matched "BMW › 3 Series" identity and using the canonical brand.
