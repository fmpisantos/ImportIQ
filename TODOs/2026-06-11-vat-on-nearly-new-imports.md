---
title: Handle VAT on "new" vehicles (≤6 months or ≤6,000 km) — at least warn
created: 2026-06-11
status: todo
priority: high
---

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
