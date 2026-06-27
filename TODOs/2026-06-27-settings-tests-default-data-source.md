---
title: Update settingsRoutes tests for 'direct' default data_source
created: 2026-06-27
status: todo
priority: medium
---

## What
Three tests in `server/test/settingsRoutes.test.js` still assert the default
`data_source` is `mock`, but `config.js` now defaults to `direct`
(`getDataSource()` → `process.env.DATA_SOURCE ?? 'direct'`). Update the
expectations (or decide the default should revert to `mock`).

Failing tests:
- `GET returns defaults with correct provenance when nothing is set` (expects `mock`)
- `data_source resolves override over env over default` (expects `mock` after clear)
- `POST /test in mock mode passes without any network` (expects message to match `/mock/i`)

## Why
These are pre-existing failures on `master` (the default was already `direct`
before the `feat/vehicle-matcher-pt-search` merge). The suite reports 181/184
passing; getting it green again requires reconciling the test expectations with
the intended default source.

## Notes
- `server/src/config.js` `getDataSource()` — current default `'direct'`.
- `server/test/settingsRoutes.test.js` lines ~70-71, 117-118, 173, 209.
- Decision needed: is `direct` the intended default (CLAUDE.md calls it the
  "Recommended real-data path") or should the seed/default stay `mock` for tests?
- Run: `cd server && node --test test/settingsRoutes.test.js`
