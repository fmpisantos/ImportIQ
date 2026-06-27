---
title: Confirm WLTP/NEDC from the AS24 detail page instead of inferring from year
created: 2026-06-27
status: todo
priority: medium
---

## What
The AS24 detail-page `vehicle` block carries a `wltp` field (and a populated
`environmentEuDirective`). Use it to set `emissionStandard` from the *source's*
own classification during `enrichListing`, clearing `emissionStandardInferred`
for those cars — instead of the current year-based guess
(`inferEmissionStandard`, 2018-September boundary).

## Why
`emissionStandard` selects the CO₂ brackets for both the ISV environmental
component and IUC, so an inferred-wrong standard moves the tax. We now capture
the registration month (sharpening the 2018 boundary), but a car's homologation
standard is stated on the detail page — reading it removes the guess entirely
for the WLTP/NEDC switch rather than just narrowing it.

## Notes
- Detail JSON: `props.pageProps.listingDetails.vehicle.wltp` (+ `co2emission…`
  carries a `WLTP`/`NEDC` hint in some payloads — verify the exact shape on a
  populated listing; the 2008 sample had `wltp` but null CO₂).
- Fill in `enrichListing` (`server/src/adapters/direct/autoscout24.js`) alongside
  the month/particle/range fields already added; keep the year-based
  `inferEmissionStandard` as the fallback when the detail flag is absent.
- Only AS24-`direct` listings can be enriched this way; mobile.de/apify keep the
  inferred standard.
- Related: the per-listing WLTP/NEDC UI override (`POST /api/recompute`) already
  lets the user correct it; this just makes the default right more often.
