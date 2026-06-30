---
title: PT comparison matches wrong cars — comparable's model null leaks whole brand category
created: 2026-06-30
status: done
completed: 2026-06-30
priority: high
---

> **Outcome (2026-06-30):** Fixed in `comparableMatches` (`ptMarketClient.js`) —
> the model gate now falls back to the comparable's ad `title` when its structured
> `model` is absent, and only skips when neither exists (model is identity, not a
> tolerance band). Verified live against OLX: a Panamera fetch now drops every
> null-`modelo` 911 (992) row plus Cayennes/Taycans/718s and keeps genuine
> Panameras. +1 regression test (`ptMarket.test.js`): drop-wrong-title /
> keep-right-title / keep-when-neither. Suite 226/229 (same 3 pre-existing
> env-driven `settings`/`data_source` reds — they expect a `mock` default but this
> host reaches live scraping). No production data backfill needed; comparisons
> recompute fresh per call since the PT cache was removed (see sibling task).

## What
A Porsche **Panamera** subject was benchmarked against Porsche **911 (992)** GT3s
and a Turbo S (and would also admit Cayennes/Taycans/718s). The PT "market value"
was built from a different model line entirely.

## Why (root cause — verified live against OLX)
Sibling of [[2026-06-14-pt-comparison-mismatch-model-null-and-cache-collision]],
but on the **comparable** side rather than the subject side:

1. OLX's free-text `query=panamera` barely filters — combined with the Porsche
   brand category it returns the whole brand (Macans, 718s, Cayennes, Taycans, 911s).
2. OLX leaves the structured `modelo` param **null** on exactly the 911 (992)
   listings (confirmed against the live API).
3. `comparableMatches` (`ptMarketClient.js`) only applied the model gate when
   BOTH sides published a model (`if (listing.model && c.model)`). With `c.model`
   null the gate was skipped "field-tolerantly," so the 911s passed — and a
   Panamera Turbo S vs 911 Turbo S sit inside the ±20% power / ±15% displacement
   bands, so the engine gates didn't catch them either.

## Notes
- Fix: model is *identity*, not a tolerance band, so it's no longer
  field-tolerant. When a comparable has no structured `model`, fall back to
  matching the subject's model against the comparable's ad `title` (which always
  carries the model — "Porsche 911 (992) …"); only skip the gate when the
  comparable exposes NEITHER model nor title. Fuel/transmission/engine stay
  field-tolerant.
- Files: `server/src/adapters/ptMarketClient.js` (`comparableMatches`),
  test `server/test/ptMarket.test.js`.
- Acceptance: live OLX fetch for a Panamera now drops every null-`modelo` 911
  row and keeps genuine Panameras; regression test covers
  drop-wrong-title / keep-right-title / keep-when-neither-exists.
