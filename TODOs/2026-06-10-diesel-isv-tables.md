---
title: Replace placeholder diesel ISV tables with official rates
created: 2026-06-10
status: todo
priority: high
---

## What
The diesel ISV tables in `server/src/engine/isvTables.js` currently **mirror the
gasoline tables** as a placeholder. Replace them with the official diesel rates.

## Why
ISV is the largest, most decision-driving component of the landed cost. Diesel
rates are higher than gasoline (plus the particle surcharge), so diesel verdicts
are currently wrong/under-stated. Don't trust diesel results until this is fixed.

## Notes
- Tables: `server/src/engine/isvTables.js`; consumed by
  `server/src/engine/isv.js`.
- PLAN.md §4.1 only notes diesel is "slightly higher" — source the real OE2025/
  2026 diesel brackets.
- Add/adjust unit tests in `server/test/isv.test.js` for diesel cases.
