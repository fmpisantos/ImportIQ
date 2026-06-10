# ImportIQ

Search mobile.de for used cars, compute the full cost of importing each to
Portugal (ISV, transport, legalisation), and compare against the Portuguese
market. See [`PLAN.md`](./PLAN.md) for the full product spec.

## Stack

- **`server/`** — Node.js + Express API, SQLite config store (`better-sqlite3`),
  a pure deterministic ISV calculation engine, and mock mobile.de / PT-market
  adapters.
- **`web/`** — React + Vite single-page app: Search, Results, Configuration.

The ISV engine, config store, REST API and UI are real and run end-to-end. The
data adapters support three modes via the `DATA_SOURCE` env var:

- **`mock`** (default) — deterministic sample data, no credentials needed.
- **`apify`** — live listings scraped from **mobile.de, AutoScout24 and
  AutoUncle** via [Apify](https://apify.com) Store actors. Needs only an
  `APIFY_TOKEN` (pay-as-you-go) — no dealer account. This is the practical way
  to actually search all three sites.
- **`official`** — real **mobile.de Search API** (German listings, B2B/dealer
  credentials only) and an official Portuguese source (OLX / Standvirtual) for
  market comparison.

All adapters are fully wired but require credentials (see
[Data sources](#data-sources) below). Until you set them, the app runs on the
mock so everything still works.

## Quick start

```bash
npm install          # installs server + web workspaces
npm run dev          # backend on :3001, frontend on :5173 (proxied)
```

Open http://localhost:5173, set filters, click **Run Bot**.

Other scripts:

```bash
npm test             # ISV engine unit tests (node --test)
npm run build        # production build of the web app
npm start            # run the API alone
```

## Layout

```
server/src/
  engine/      isv.js, isvTables.js, iuc.js, landedCost.js   ← real, deterministic
  adapters/    source.js          ← dispatcher: mock | official | apify
               mobilede.js        ← mobile.de mock + official Search API
               apifySearch.js, apifyClient.js, normalize.js
               sites/{mobilede,autoscout24,autouncle}.js     ← per-site scrapers
               ptmarket.js, brands.js
  routes/      config.js, search.js, export.js
  db.js        SQLite schema + migrate + seed (PLAN §4.6)
  config/seed.js  default cost rows (placeholders — edit on the Config page)
web/src/
  pages/       SearchPage.jsx, ConfigPage.jsx
  components/  FilterForm.jsx, ResultCard.jsx
```

## API

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness check |
| `GET /api/brands` | Brand → models map for filters |
| `POST /api/search` | Run the bot; returns enriched results |
| `GET /api/config` | All cost-config rows + active settings |
| `PUT /api/config/:key` | Update a cost row (amount / enabled / notes) |
| `POST /api/config/active` | Set the active transport method |
| `POST /api/export/{csv,json}` | Export the results array |

## Data sources

By default `DATA_SOURCE=mock`. To use real data, copy `.env.example` → `.env`,
pick a source, and fill in credentials.

### Option A — Apify scrapers (recommended: all three sites, no dealer account)

Set `DATA_SOURCE=apify` and an `APIFY_TOKEN` (from the
[Apify console](https://console.apify.com), Settings → Integrations). Billing is
pay-as-you-go per scraper run/result.

| Site | Default actor | Notes |
|---|---|---|
| **mobile.de** | `3x1t/mobile-de-scraper` | Structured make/model/price/year/fuel filters. |
| **AutoScout24** | `automation-lab/autoscout24-scraper` | Per-result billing; `make`/`model` sent as slugs; country via `APIFY_AUTOSCOUT24_COUNTRY`. |
| **AutoUncle** | `lofomachines/autouncle-scraper` | URL-driven; make/model in the locale path (`APIFY_AUTOUNCLE_BASE_URL` + `_LIST_PATH`). |

How the Apify path behaves:

- Each enabled site (`APIFY_SITES`) is scraped in parallel; a site that fails or
  is blocked is skipped rather than failing the whole search.
- Every result is normalised to the common listing shape and run through a
  **defensive post-filter**, so you only ever see listings that actually match
  your filters — even if an actor honours a parameter loosely.
- Cross-source duplicates are dropped (AutoUncle aggregates the others), each
  listing is tagged with its `source`, and per-site results are cached per
  filter-set (`APIFY_CACHE_TTL_MS`, default 6h) to avoid re-paying.
- For full filter fidelity on any site you can configure an exact search URL via
  that actor's `startUrls` (see the per-site adapter under
  `server/src/adapters/sites/`).
- ⚠️ Actor input/output field names vary between Store actors and over time. The
  mappers try the common aliases defensively; if you swap an actor
  (`APIFY_*_ACTOR`), verify the mapping against a sample run.

### Option B — Official mobile.de Search API (B2B only)

Set `DATA_SOURCE=official` and:

| Source | Env vars | How to get access |
|---|---|---|
| **mobile.de Search API** (German listings) | `MOBILEDE_USER`, `MOBILEDE_PASS` | Email `service@team.mobile.de` to activate API access; HTTP Basic auth. |
| **PT market** (`PT_PROVIDER=olx` or `standvirtual`) | `OLX_API_KEY` *or* `STANDVIRTUAL_TOKEN` | OLX Partner API at `developer.olx.pt`; Standvirtual read access via `api@standvirtual.com`. |

How the official path behaves:

- **mobile.de**: searches public listings, paginates (max 2,000 ads/query), and
  maps each ad into the normalised listing shape. The make/model tree is fetched
  from the refdata API and cached 30 days (`refdata_cache` table).
- **PT market**: queries comparable listings (same brand+model, year ±1, mileage
  ±20,000 km), averages the asking prices, and caches per bucket for 24h
  (`pt_market_cache` table).

### ⚠️ PT read-access caveat

The official Portuguese APIs (OLX Partner API, Standvirtual API) are oriented
toward **managing your own ads**. Whether they permit *searching other sellers'
listings* for market comparison is **not confirmed** and must be verified with
the provider when you set up your account. The `ptMarketClient.js` request/
response field paths are best-effort and should be adjusted to the granted API's
real schema. If read access isn't available, fall back to a licensed data
provider (Apify/Carapis) for the PT side only — the adapter boundary makes this
a localised change.

### ⚠️ Emission standard (WLTP/NEDC)

mobile.de does not return whether a car's CO₂ figure is WLTP or NEDC — which
changes the ISV table used. The adapter infers it from the registration year
(2019+ ⇒ WLTP, earlier ⇒ NEDC) and flags `emissionStandardInferred: true`. Per
PLAN.md §4, the user should be able to override this; surfacing that control in
the UI is a follow-up.

## Cost model (PLAN.md §4)

```
Total landed cost = German price + ISV + Transport + Legalisation fees
```

- **ISV** is computed from the official OE2025/2026 tables (`engine/isvTables.js`).
- **Transport** is the exact amount configured for the active method.
- **Legalisation** is the sum of enabled, configured fee line items.

Every component must resolve to a real configured/computed value. If a required
config value is missing, the result is flagged **Incomplete** rather than
estimated — the user never sees a verdict based on guessed numbers.

## Known gaps / TODO

- **Diesel ISV tables** in `isvTables.js` currently mirror the gasoline tables as
  a placeholder (PLAN.md §4.1 only specifies they are "slightly higher"). Replace
  with the official diesel rates before trusting diesel results.
- **PT official read access** is unverified — see the caveat above.
- **Emission-standard override** in the UI (currently inferred from year).
- Scheduler + email alerts (PLAN.md §7), URL filter state.
- IUC is an estimate only (PLAN.md §4.2).
- Real-API verification (live mobile.de / PT calls) is pending credentials; the
  mapping/averaging logic is covered by fixture tests in `server/test/`.
