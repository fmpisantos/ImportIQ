---
title: Add insurance + plate cost line items to the cost model
created: 2026-06-11
status: todo
priority: medium
---

## What
The landed-cost config covers transport + legalisation fees but omits two costs
the user wants accounted for:

- **Plates**: PT licence-plate issuance (matrícula plates themselves, ~€40–60
  at a stand/ACP) as a `fee.plates` legalisation row; and, for the
  drive-down transport method, German **export plates (Ausfuhrkennzeichen)**
  + their mandatory short-term insurance (~€100–200 for plates + ~15–30 days
  cover) as a `fee.export_plates_insurance` row.
- **Insurance**: transit/first-period insurance needed to legally move and hold
  the car until it's registered and on a normal PT policy. One-off transit cost
  belongs in the landed total (toggleable row); the *annual* PT premium is an
  ownership cost — show it alongside IUC as a yearly figure, never in the
  one-time total.

## Why
User explicitly asked (2026-06-11) for insurance and licence plate to be part
of the deal math. Without export plates/insurance the drive-down transport
option is understated; without plate fees the legalisation total is slightly
short.

## Notes
- Seed rows: `server/src/config/seed.js` (same placeholder-with-notes pattern);
  no engine change needed — `landedCost.js` already sums all enabled
  `legalisation` rows.
- Annual insurance estimate: new optional config row (category `other`,
  e.g. `ownership.insurance_annual`) surfaced on the result card next to IUC
  under "Comparison & ownership". Keep it user-entered — premiums vary too much
  to estimate.
- Follow PLAN.md's rule: real configured values only, ranges as guidance text.
