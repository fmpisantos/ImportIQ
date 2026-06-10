---
title: UI override for emission standard (WLTP/NEDC)
created: 2026-06-10
status: todo
priority: medium
---

## What
Let the user override the inferred WLTP/NEDC emission standard per listing in the
UI, instead of always inferring it from the registration year.

## Why
Scraped sites (and the mobile.de API) don't return whether a CO₂ figure is WLTP
or NEDC. We infer `2019+ ⇒ WLTP, earlier ⇒ NEDC` and flag
`emissionStandardInferred: true`. The chosen standard changes the ISV table, so a
wrong inference changes the landed-cost verdict. PLAN.md §4 calls for prompting
the user when the standard is unknown.

## Notes
- Inference: `inferEmissionStandard()` in `server/src/adapters/normalize.js` and
  `server/src/adapters/mobiledeMap.js`.
- The ISV engine already accepts an explicit standard; surface a toggle on the
  result card (`web/src/components/ResultCard.jsx`) and re-compute landed cost.
- `emissionStandardInferred` is already on each listing to drive the UI hint.
