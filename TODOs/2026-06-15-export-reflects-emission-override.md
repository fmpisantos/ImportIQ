---
title: Export should reflect per-card emission-standard overrides
created: 2026-06-15
status: todo
priority: low
---

## What
When the user overrides a listing's WLTP/NEDC standard on a result card (the new
toggle), the recomputed landed cost/saving is shown in that card but is NOT
reflected in a subsequent CSV/JSON export — the export uses the original
server-side `data.results`.

## Why
The override re-costs ISV and the verdict, so an exported row can disagree with
what the user sees on screen. Minor today (overrides are occasional), but
surprising.

## Notes
- The override currently lives as local state inside
  `web/src/components/ResultCard.jsx` (`result`/`setResult`).
- Fix options: lift the overridden result up to `SearchPage` (e.g. an
  `onResultChange(id, updated)` callback that patches `data.results`), so both
  the sort and the export see the new value; or have the export endpoint
  re-cost. Lifting state is simpler and keeps export client-side.
- `POST /api/recompute` already returns the full recomputed result, so the
  frontend just needs to thread it back to the parent's results array.
