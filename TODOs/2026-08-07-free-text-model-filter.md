---
title: Let the Model filter take free text, not just catalog picks
created: 2026-08-07
status: todo
priority: medium
---

## What
The Model filter is a `<select>` limited to the curated model list for the chosen
brand (`FILTER_BRANDS` → `GET /api/brands`). Turn it into a combobox — an
`<input list=…>` backed by a `<datalist>` of the catalog models — so the curated
list stays a suggestion rather than a hard limit.

## Why
The curated lists are intentionally short (they're what a dropdown can show
without burying the real picks), so legitimate models are missing: Porsche offers
718/911/Panamera/Macan/Cayenne/Taycan but not Cayman or Boxster. The scrapers all
accept free-text model, and the model filter is a `LIKE`/containment match on
both the store and the post-filter, so a typed model already works end-to-end —
only the UI blocks it.

## Notes
- `web/src/components/FilterForm.jsx` — the Model `<select>` (models come from
  `brands[filters.brand]`).
- Server side needs no change: `getDealsPage` uses `lower(model) LIKE %…%` and
  `matchesFilters` keeps a listing when either name contains the other.
- Consider suggesting the *generated* catalog's models here (broader than the
  curated list) now that they'd only be hints, not the only options.
