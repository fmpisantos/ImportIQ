---
title: UI override for emission standard (WLTP/NEDC)
created: 2026-06-10
status: done
completed: 2026-06-15
priority: medium
---

> **Outcome:** Two-part fix. (1) `inferEmissionStandard()` now encodes PT's
> import rule — WLTP from 1 Sep 2018 (uses reg month at the 2018 boundary),
> still flagged `inferred`. Consolidated the duplicate copy in `mobiledeMap.js`
> to re-export from `normalize.js`. (2) Per-listing WLTP/NEDC toggle on the
> result card; a new `POST /api/recompute` endpoint re-costs ISV + verdict under
> the chosen standard (reuses the existing PT comparison). `computeLandedCost`
> takes an `opts.emissionStandard` override. Tests added in `normalize.test.js`
> and `landedCost.test.js`.
> Known gap: CSV/JSON export reflects the stored (pre-override) result, not a
> per-card toggle — logged as a follow-up TODO.

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
