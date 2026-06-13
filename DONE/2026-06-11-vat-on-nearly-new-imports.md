---
title: Handle VAT on "new" vehicles (≤6 months or ≤6,000 km) — at least warn
created: 2026-06-11
status: done
completed: 2026-06-13
priority: high
---

> **Outcome (2026-06-13):** Implemented the full fix, not just a warning. New
> pure `engine/vat.js#assessVat` detects a "new means of transport" (≤6,000 km,
> or a known reg date ≤6 months) and returns 23% IVA, split into `applicable`
> (near-certain → added to the landed cost) vs `suspect` (registered this year,
> month unknown → flagged "verify", no number invented, kept out of the green
> badge). `landedCost.js` adds `vatEur` to the total and carries `breakdown.vat`;
> the German VAT margin-scheme caveat is surfaced as a note. UI shows the IVA line
> + a ⚠ Verify badge/note; CSV export gained a `vatEur` column. Covered by
> `test/vat.test.js` + `test/landedCost.test.js`.

## What
Under EU rules a car is a **"new means of transport"** for VAT if it is ≤6
months old **or** has ≤6,000 km when brought to Portugal — then PT IVA (23%) is
due on import (on top of ISV), and whether German VAT was paid/refundable
depends on the sale type. The landed-cost engine currently ignores VAT
entirely.

Minimum viable fix: detect listings matching the new-vehicle criteria
(`ageYears`/`firstRegYear` + `mileageKm` are on the normalised listing) and
flag the result with a prominent warning ("+23% IVA likely due — verify"),
excluding it from the green "deal" badge. Full fix: add IVA as a computed
component for those cases.

## Why
A nearly-new car looks like the best "deal" precisely because its price gap is
big — but 23% IVA on a €30k car is ~€7k, which flips the verdict. Without this
check the tool's most attractive-looking results can be its most wrong ones.

## Notes
- Engine: `server/src/engine/landedCost.js`; inputs already normalised in
  `adapters/normalize.js`.
- Also relevant: margin-scheme vs VAT-deductible dealer sales
  ("MwSt. ausweisbar") change the effective German price for a business buyer —
  out of scope for v1, but the warning text can mention it.
- PLAN.md §10/§11 only excludes *non-EU* customs duty; intra-EU VAT on new
  vehicles is in scope for correctness.
