---
title: Verify the hardcoded gasoline WLTP ISV brackets against the OE tables
created: 2026-06-15
status: done
completed: 2026-06-15
priority: medium
---

> **Outcome (2026-06-15):** Confirmed the suspicion — the baseline `gasoline.WLTP`
> upper brackets were outdated. The automated refresh job (with `informador.pt`,
> the Código do ISV art. 7º legal text, added as a third source) surfaced it: the
> `>195 g/km` rates were wrong and the `196–235 / >235` split was missing.
> Corrected `gasoline.WLTP` in `engine/isvTables.js` to `…, ≤195→51.38/7247.39,
> ≤235→193.01/34190.52, >235→233.81/41910.96`, sourced from the legal text and
> confirmed byte-for-byte by contasconnosco.cofidis.pt. The job now confirms all
> four tables (gasoline/diesel × WLTP/NEDC) from ≥2 sources with no change.

## What
While replacing the placeholder diesel tables (see
`DONE/2026-06-10-diesel-isv-tables.md`), the **gasoline WLTP** brackets in
`server/src/engine/isvTables.js` (`ENVIRONMENTAL_BRACKETS['gasoline.WLTP']`) were
noticed to differ structurally from the diesel WLTP table and from some currently
published OE2025/2026 references. Confirm they are correct, or correct them.

## Why
Gasoline is the most common fuel, so an outdated gasoline WLTP table would skew
the majority of verdicts. The gasoline **NEDC** table was spot-checked and
matches a published example (`105 × 8.09 − 750.99 = 98.46`); WLTP was not.

## Notes
- Cross-check `gasoline.WLTP` against ≥2 sources and ideally the Portal das
  Finanças ISV simulator.
- **Source reality (verified 2026-06-15 by running the refresh job):** of the
  three default sources, only `ecoimport.pt` and `contasconnosco.cofidis.pt`
  render their tables server-side and parse. `impostosobreveiculos.info` is
  JS-rendered ("Loading…") so a server fetch gets nothing; `veiculo.pt`,
  `crncontabilidade.pt`, `caetano.pt`, `cgd.pt` were also probed and yielded no
  parseable tables. Net: the job currently confirms **`diesel.WLTP`** (both
  working sources agree, matches baseline) and declines the rest.
- To confirm more keys (`gasoline.WLTP`, `gasoline.NEDC`, `diesel.NEDC`) the job
  needs a **reliable third server-rendered source**, or a small per-source parse
  config to isolate the right table on the existing pages. Replace the dead
  `impostosobreveiculos.info` default in `getIsvTablesConfig()`
  (`server/src/config.js`) once a good source is found.
- Run the job manually to inspect coverage:
  `IMPORTIQ_DB=$(mktemp -d)/t.db node -e "import('./src/jobs/refreshIsvTables.js').then(m=>m.runRefreshIsvTables())"`
  — check the logged `accepted` keys / `flags`.
