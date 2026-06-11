---
title: Automated tests for the runtime settings API (routes/settings.js)
created: 2026-06-10
status: todo
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
