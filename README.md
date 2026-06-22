# ImportIQ

Find used cars listed in **Germany**, compute the full **Portuguese landed cost**
(German price + ISV + VAT-if-applicable + transport + legalisation), compare
against the **PT market price** for the same car, and surface the genuine savings.

> **The golden rule:** never show a number we made up. If a value can't be
> computed or configured, the result is marked **Incomplete** (with exactly
> what's missing) — a wrong "you'll save €3,000" is worse than "we can't tell yet".

## Architecture

A TypeScript monorepo (npm workspaces) with a **pure domain core** isolated from
all I/O so the trust-critical logic is deterministic and unit-tested.

```
shared/   @importiq/shared — the typed API/data contract used by server + client
server/   Node + Express + better-sqlite3
  src/domain/        PURE, no I/O: normalisers, ISV + IUC engine, landed cost,
                     comparison matching + estimation, result/sorting
  src/adapters/      source dispatcher seam: mock + AutoScout24 (DE),
                     mock + Standvirtual + OLX (PT), shared HTTP helper
  src/store/         SQLite: cost config, cache (TTL), batches, deals
  src/services/      orchestration: search, comparison, config, batches, brands
  src/jobs/          opt-in nightly scheduler
  src/routes/        Express routes + zod validation
client/   React + Vite + TypeScript SPA (search, configuration, batches)
```

The rest of the app only ever talks to the **dispatcher seam** — it never knows
which source is live. Adding a real source = adding one adapter, nothing else.

## Run it

```bash
npm install

# Terminal 1 — API (mock sources by default: offline, no credentials)
npm run dev:server      # http://localhost:8080

# Terminal 2 — UI
npm run dev:client      # http://localhost:5173 (proxies /api → :8080)
```

`mock` mode ships deterministic sample data so the whole flow works with no
network. Set `SOURCE_MODE=live` / `PT_SOURCE_MODE=live` (see `.env.example`) to
use the real AutoScout24 + Standvirtual adapters.

```bash
npm test          # server unit + mock-flow tests (vitest)
npm run typecheck  # all three workspaces
npm run build      # shared → server → client
```

## Status vs. the specification

| Area | Status |
|---|---|
| Search (AutoScout24 live, mock, dispatcher seam) | ✅ |
| mobile.de | Pluggable seam in place; adapter not wired (anti-bot-gated, §3.5) |
| PT comparison (Standvirtual live + mock) | ✅ |
| OLX.pt | Graceful-skip stub — Standvirtual is primary and stands alone (§4.1) |
| ISV engine (pure, breakdown, special regimes) | ✅ — **tables are an unverified OE2026 draft** |
| IUC | Shown separately; returns "unknown" until official tables are verified |
| Landed cost + completeness invariant | ✅ |
| Cost configuration (store, seed, page, validation) | ✅ |
| Results (cards, sorting, lazy multi-source pagination) | ✅ |
| Caching (3h search / 1d PT) | ✅ |
| Nightly batch scheduler (opt-in, safe by default) | ✅ |

### Important trust caveats (by design)

- **ISV is computed from an UNVERIFIED draft** (Appendix B, OE2026). Every ISV
  result carries `unverified: true` and the UI shows it. **Cross-check against the
  official Portal das Finanças simulator before relying on a figure.**
- **Pre-2019 (NEDC) cars** resolve to *Incomplete* rather than a guess — the NEDC
  CO₂ tables were not in the source draft, so they are deliberately not encoded.
- **IUC** and the **minimum-ISV floor** are not yet verified, so they are reported
  as "unknown" instead of estimated.
- Seeded cost-config amounts are **labelled placeholders** — replace them with
  your real quotes on the Configuration page.
