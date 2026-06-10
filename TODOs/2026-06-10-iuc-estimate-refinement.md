---
title: Refine IUC from estimate to exact calculation
created: 2026-06-10
status: todo
priority: low
---

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
