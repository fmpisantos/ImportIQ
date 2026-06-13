---
title: Investigate suspiciously low German prices (parse bug vs. damaged/parts listings)
created: 2026-06-13
status: todo
priority: medium
---

## What
A 2013 BMW 116 surfaced with a German price of €4,590 — implausibly low for a
running car of that age. Determine whether this is a price-parse bug on the
German adapter side or a genuine listing (accident/parts/export car) that should
be filtered or flagged.

## Why
A wrong (too-low) German price understates the landed cost and produces a
fake "great deal", undermining the whole comparison — the mirror of the PT
over-average bug just fixed (see `DONE/2026-06-13-pt-average-comparable-accuracy.md`).

## Notes
- Split out from the PT-average task as a separate concern.
- Check `adapters/direct/autoscout24.js` (and `adapters/normalize.js#intFrom`)
  for mis-parsing localized prices — e.g. "4.590" read as 4590 when the real
  figure was "45.900", or a monthly-financing/deposit figure scraped instead of
  the sale price.
- Consider a sanity floor / outlier flag on German price per (brand, year)
  rather than silently trusting it; surface `incomplete`/a warning instead of
  averaging a bad price into a misleading saving.
- Reproduce with the BMW 116 (2013) search that triggered it.
