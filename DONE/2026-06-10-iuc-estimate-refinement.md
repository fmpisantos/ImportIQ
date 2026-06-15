---
title: Refine IUC from estimate to exact calculation
created: 2026-06-10
completed: 2026-06-15
status: done
priority: low
---

Outcome: replaced the IUC estimate with the exact statutory Categoria B
calculation (OE2026 / Lei n.º 73-A/2025). `iuc.js` now models all four
components — cilindrada, CO₂ (separate NEDC/WLTP brackets), the 2017+ additional
CO₂ tax, year coefficient, and the cylinder-based diesel surcharge — via
`calculateIUC(...)`, wired through `landedCost.js` with the resolved emission
standard. Cross-checked against the official worked example to the cent
(2020 diesel, 1968 cm³, 120 g/km NEDC ⇒ 241.49 €). UI label dropped "(est.)".
Covered by `server/test/iuc.test.js`.

## What
IUC (annual circulation tax) is currently an estimate. Replace with the exact
official calculation, or clearly label it as an estimate in the UI.

## Why
PLAN.md §4.2 notes IUC is an estimate only. It feeds the ownership-cost view; an
exact figure makes the total-cost-of-ownership comparison trustworthy.

## Notes
- Engine: `server/src/engine/iuc.js`.
- Surfaced on the result card under "Comparison & ownership".
- Depends on engine size, fuel, CO₂ and first-registration year — most inputs are
  already on the normalised listing.
