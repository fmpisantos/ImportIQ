---
title: Replace placeholder diesel ISV tables with official rates
created: 2026-06-10
status: done
completed: 2026-06-15
priority: high
---

> **Outcome (2026-06-15):** Replaced the placeholder diesel `WLTP`/`NEDC`
> environmental brackets in `engine/isvTables.js` with the official OE2025/2026
> values, verified across three independent sources (WLTP by all three, NEDC by
> two). Added an automated yearly refresh: `adapters/isvTablesSource.js`
> (scrape + parse + cross-source-agreement/structural/cross-fuel validation),
> `jobs/refreshIsvTables.js`, `engine/isvTableStore.js` (runtime resolver:
> validated `refdata_cache` override → hardcoded baseline), a `getIsvTablesConfig()`
> getter, and an `ENABLE_ISV_TABLE_REFRESH`-gated scheduler in `index.js`
> (off by default). Tests in `test/isv.test.js` + `test/isvTablesRefresh.test.js`.
> Follow-up logged: `TODOs/2026-06-15-gasoline-wltp-table-verification.md`.

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
