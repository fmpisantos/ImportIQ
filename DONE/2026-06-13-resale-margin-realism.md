---
title: Resale-margin realism — asking ≠ sale price, label + configurable haircut
created: 2026-06-13
status: done
completed: 2026-06-13
priority: medium
---

> **Outcome (2026-06-13):** Added the `resale.asking_to_sale_haircut_pct` seed
> row (category `other`, off by default — renders on the Config page via the
> generic grouping). `attachComparison` now also computes `estimatedResaleEur` +
> `marginEur`/`marginPct` when the haircut is enabled (threaded from the search
> route). UI relabelled "PT avg" → "PT asking avg" throughout, shows the margin
> line + a new "Expected resale margin" sort, and the CSV export gained
> `estimatedResaleEur`/`marginEur` columns. The broader deals-only threshold view
> (`2026-06-11-good-deal-threshold-and-verdict.md`) remains a separate TODO.
> Covered by `test/landedCost.test.js`.

## What
The verdict compares landed cost to the PT **asking** average, but you resell
below asking. Make that explicit:

- Relabel the comparison "PT asking avg" in the UI.
- Add a configurable `resale.asking_to_sale_haircut_pct` (cost_config `other`,
  off by default) and surface an `estimatedResaleEur` + `marginEur` /
  `marginPct` next to the raw saving.

## Why
"Saving vs asking" overstates the real margin. A conservative, user-owned
haircut turns the number into an honest expected resale margin.

## Notes
- `engine/landedCost.js#attachComparison` already computes `savingEur`; add the
  haircut-derived margin alongside it (keep `savingEur` for back-compat).
- Pairs with `2026-06-11-good-deal-threshold-and-verdict.md` (threshold/deals
  view) — that broader UI work stays a separate TODO.
