---
title: Automated tests for the runtime settings API (routes/settings.js)
created: 2026-06-10
status: done
completed: 2026-06-11
priority: medium
---

## What
Add `node:test` coverage for `server/src/routes/settings.js` and the config
override layer it feeds. Cover:

- **GET /api/settings** — secrets are masked (`{ set, hint }`, never the raw
  value); non-secrets return their effective value; `source` is `override` vs
  `env` vs `default` vs `unset` correctly.
- **PUT /api/settings** — valid updates persist as `runtime.*` rows; a blank
  secret is a no-op (does not clobber a stored secret); `clear: [...]` deletes
  the override.
- **Validation** — bad `data_source`, bad `pt_provider`, non-positive
  `apify_max_per_site`, non-boolean `apify_use_proxy`, and unknown
  `apify_sites` are all rejected with 400 and nothing is written.
- **Override precedence** — a stored `runtime.data_source` overrides the
  `DATA_SOURCE` env, which overrides the default (`config.js` `rt()`).

## Why
This layer now controls which adapter runs and carries credentials. It was
verified manually (curl smoke test) but has no automated coverage, so a
regression in masking or precedence could silently leak a secret or run the
wrong data source.

## Notes
- Use an in-memory / temp SQLite db via `IMPORTIQ_DB` (the smoke test used
  `mktemp`), or stub `getRuntimeSettings`/`setActiveSetting`.
- The `/test` probe hits the network (Apify `users/me`, mobile.de refdata) — stub
  `fetch` or skip it in the offline suite.
- Pairs with `2026-06-10-apify-aggregator-tests.md` (same offline-test style).

## Outcome
Shipped 2026-06-11 as `server/test/settingsRoutes.test.js` (16 tests, all
green alongside the 37 existing ones, fully offline in ~300ms). Covers GET
provenance + secret masking (raw value asserted absent from GET *and* PUT
responses), PUT persistence / blank-secret no-op / clear, all validation
rejections incl. the new `direct` source and `direct_max_results`, batch
atomicity, override→env→default precedence via `getDataSource()`, and the
POST /test probes (mock, direct with mobile.de skipped / bad Apify token /
blocked AS24) with the process-global fetch stubbed to pass localhost through.
