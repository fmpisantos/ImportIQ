# ImportIQ — Product Specification

> A web app that finds used cars listed in Germany, computes the full cost of importing each one to Portugal, compares that against the Portuguese market price for the same car, and tells the user how much they would save (or lose) per car.


## 0. How to read this document

- **Normative language.** "MUST" / "MUST NOT" are hard requirements. "SHOULD" is a strong default — deviate only with a written reason. "MAY" is optional.
- **Deferred investigations.** Blocks marked **🔍 INVESTIGATE** capture open questions that are *not yet decided*. **Do not implement them yet.** When you reach one, stop and either (a) ask the user, or (b) if told to research it, produce findings and propose a decision — do not silently guess. Everything outside these blocks is decided and ready to build.
- **The golden rule** (repeated throughout because it defines the product): **never show a number we made up.** If a value can't be computed or isn't configured, mark the result *Incomplete* and say what's missing. A wrong "you'll save €3,000" is worse than "we can't tell yet."

---

## 1. Purpose & value

Used cars are often materially cheaper in Germany than in Portugal — but only *after* import taxes and fees. The hard part for a buyer is doing that math per car, across many listings, fast enough to spot the genuinely good deals. ImportIQ automates the whole loop:

**Search Germany → compute Portuguese landed cost → compare to the PT market → presnet calulations**

The user is a buyer (or small importer) who wants a list of cars and decide if he's in front of a good deal or not,  with a trustworthy euro figure behind each one.

---

## 2. The four steps (product overview)

1. **Search cars** — query the German sources with the user's filters; normalise every listing to one shape.
2. **Find the Portuguese average price** — for each German car, estimate what the same car sells for in Portugal.
3. **Simulate import tax (ISV) and other costs** — compute the full landed cost in Portugal.
4. **Show results** — one card per car: German price, landed cost, PT market price, and the saving/loss, sorted so the best deals surface first.

Each step is detailed below.

---

## 3. Step 1 — Search cars (German sources)

### 3.1 Sources

| Source | URL | Notes |
|---|---|---|
| AutoScout24 | https://www.autoscout24.com/ | Primary. Pan-European, large inventory. |
| mobile.de | https://www.mobile.de/ | Largest German marketplace; harder to access (see §3.5). |

The app MUST be able to run with **at least one** source working. A source that fails or is unavailable MUST be skipped gracefully (logged, surfaced in the UI as "source unavailable"), never crash the search.

### 3.2 Search filters (the user-facing form)

Start with this set. These are the filters that exist and are useful on **both** sources, so results stay comparable:

| Filter | Type | Notes |
|---|---|---|
| Brand | Dropdown | e.g. BMW, Mercedes-Benz, Audi, VW, Porsche, Toyota, Skoda… |
| Model | Dependent dropdown | Populated from the selected brand. |
| Price (min / max) | Numeric, EUR | |
| Year from | Dropdown | First registration year, lower bound. |
| Max mileage | Dropdown | 30k / 50k / 80k / 100k / 150k / 200k km. |
| Fuel type | Multi-select | Petrol, Diesel, Electric, Hybrid, PHEV, LPG. |
| Transmission | Dropdown | Any / Automatic / Manual. |

✅ **RESOLVED (2026-06-22).** All seven filters above exist on **both** German sources **and** Standvirtual, so results stay comparable. The full `our filter → AS24 → mobile.de → Standvirtual` param mapping and enum tables are in **Appendix A.5**; filters to treat as one-sided (body type) or unit-normalise (power: kW vs cv/PS) are in **A.6**. Two non-obvious points carried into the design: (a) AS24 and mobile.de filter make/model by **numeric ID** (`mmmv`/`ms`), not name — IDs come from each page's own embedded taxonomy; (b) Standvirtual filters power in **cv**, so convert before building its query.

### 3.3 Fields to extract per listing

Every adapter MUST return this **normalised listing shape** (one shape for all sources). Field extraction logic lives per-adapter; the shape does not vary.

| Field | Required | Notes |
|---|---|---|
| `sourceId` | yes | `autoscout24` \| `mobilede`. |
| `sourceListingId` | yes | The listing's id on its source. |
| `url` | yes | Deep link to the original listing. |
| `title` / `subtitle` | yes | Raw text as shown on the source (used for brand/model extraction — see §4.2). |
| `brand` | yes* | *See §4.2 — may be extracted, not a raw field. |
| `model` | yes* | *See §4.2. |
| `priceEur` | yes | German asking price, in EUR. |
| `mileageKm` | yes | |
| `firstRegistration` | yes | Month/year, e.g. `2019-03`. Drives age (ISV) and comparison. |
| `fuelType` | yes | Normalised enum. |
| `transmission` | no | Normalised enum. |
| `engineCc` | needed for ISV | Displacement in cm³. |
| `co2Gkm` | needed for ISV | CO₂ g/km. |
| `powerKw` | no | Helps PT matching. |
| `imageUrl` | no | Thumbnail. |

"Needed for ISV" means: if absent, the car's landed cost will be **Incomplete** (§5.4). Adapters MUST NOT invent these values. A listing that omits CO₂/displacement on its search card SHOULD be enriched from its detail page when feasible (and that detail cached — a car's specs don't change), otherwise flagged Incomplete.

**Verified extraction paths per source are in Appendix A.2–A.4** (e.g. AS24 `props.pageProps.listings[]`, mobile.de `window.__INITIAL_STATE__.search.srp.data.searchResults.items[]`, Standvirtual `urqlState[*].data → advertSearch.edges[].node.parameters[]`). **Confirmed in testing: `co2Gkm` is absent from most search cards on both German sources** (only ~26% of AS24 cards carried it) → CO₂ almost always requires detail-page enrichment. `engineCc` is present on the card far more often. mobile.de additionally exposes the **emission standard** directly (`attr.emc`, e.g. `Euro6d-TEMP`) and KBA type-approval numbers (`kba.hsn/tsn`), removing the need to *infer* WLTP/NEDC for those listings.

### 3.4 Normalisation rules

A single shared, I/O-free module MUST hold the cleaners (price parsing incl. localized formats like `18.500 €`, fuel/transmission label mapping, `"03/2019"` → `2019-03`). Each source adapter only describes *where* a field lives in that source's payload; the shared module decides *how* it's cleaned. This keeps every source consistent and the cleaners unit-testable.

### 3.5 Source access strategy

- **AutoScout24** SHOULD be the first working source. Its public search pages typically embed the full result set as JSON in the page (no key) — prefer that over HTML scraping where possible.
- **mobile.de** is known to block plain scraping. Treat it as **optional / pluggable**: design the source layer so mobile.de can be added later (via an official API key or a paid scraping provider) without touching the rest of the app.

✅ **RESOLVED (2026-06-22).** Access notes (full detail + field paths in Appendix A.2–A.4):

- **AutoScout24 — keyless, reliable.** Result set embedded in `<script id="__NEXT_DATA__">` of the `/lst` HTML. Page size **20**, request page N via `page=N`, usable depth ≈20 pages/query. This is the primary source.
- **mobile.de — keyless but fragile.** The `suchen.mobile.de` HTML server-renders results into `window.__INITIAL_STATE__`; there's also an internal JSON API (`m.mobile.de/consumer/api/search/hit-count` confirmed, `…/srp` exists). **However, SSR is anti-bot-gated** — a rapid filtered re-request returned an empty JS shell. So: attempt direct (with realistic headers, consent cookie, pacing, proxies), but **keep the Apify / paid-scraper fallback** as the resilient path. Page size ~27, page param `pageNumber=N` (verify). Treat as optional/pluggable exactly as below.
- **Standvirtual (PT) — keyless.** GraphQL cache in `__NEXT_DATA__ → props.pageProps.urqlState`. Page size **32**, `page=N`.

Rate limiting: the existing `direct/*` adapters already pace requests (~300 ms between pages) and cache per search; keep that discipline, especially for mobile.de.

### 3.6 Pluggable source layer (architecture requirement)

All listing retrieval MUST go through **one dispatcher seam** so the rest of the app never knows which source is live. This enables:

- A `mock` mode (deterministic sample data, no network/credentials) — this MUST exist and be the default for local dev and tests.
- Adding/removing a real source by adding one adapter, with zero changes to the engine, comparison, or UI.

---

## 4. Step 2 — Portuguese average price

### 4.1 Source(s)

| Source | URL | Notes |
|---|---|---|
| Standvirtual | https://www.standvirtual.com/ | Primary — largest PT used-car marketplace. |

✅ **RESOLVED (2026-06-22).** **Standvirtual is the primary and is dense enough to stand alone for common cars** — a tightly-filtered BMW 320d (model `320` + diesel + year ±, ≤100k km) returned **17 exact comparables** (all 1995 cm³ / 190 cv), and the unfiltered BMW pool was ~1,730. Standvirtual also returns rich structured specs (engine capacity, power, fuel, year, variant) **and its own per-listing market rating** (`priceEvaluation.indicator` = BELOW/IN/ABOVE) which we surface as free provenance.

**Decision:** Standvirtual = primary. **OLX.pt = secondary, merged when present** (it adds density for rarer models and its keyless JSON API is already implemented). Merge rule (already in `direct/ptComparison.js`): fan out with `Promise.allSettled`, a failing source is skipped (its `sampleSize:0` + error surfaced), then **dedupe across sources by URL OR by a `price+model/title` fingerprint** (dealers cross-post the same car to both platforms), then reduce to one value (§4.4). Architecture stays multi-source via the `SOURCE_FETCHERS` registry. For very thin models, prefer "Unknown" over a 1–2 sample guess (§4.4 reliability gate, min 3).

### 4.2 The brand/model matching problem (core to accuracy)

**Original concern (revised by the 2026-06-22 investigation):** the worry was that German brand/model live only in noisy title text. **In practice, all three sites expose clean structured `make` + `model` fields** (Appendix A.1). The remaining accuracy risk is not extraction — it's **matching the right *variant*** (a base trim vs a performance/equipment variant at very different prices) and **using a model token that actually exists on the PT side**.

✅ **RESOLVED (2026-06-22) — matching design:**

1. **Primary key is structured, not parsed.** Use each source's native `make` + `model`. The trim-number `model` (`320`, `X2`, `520`) is the **shared join token across AS24, mobile.de, and Standvirtual** — confirmed live (Appendix A.1). Match on `model`, **not** the German `modelGroup` (`3 Series`), which Standvirtual has no equivalent for. Standvirtual's path model slug is exactly that token (`/carros/bmw/320`), not `serie-3` (which 404s/redirects).
2. **Normalise the token** before joining: lowercase, strip the fuel/trim suffix off numeric codes (`320d`→`320`, `116i`→`116`) — the existing `normalizeModelKey` already does this. Keep word models (`Golf`, `A4`) intact.
3. **Disambiguate the variant with hard specs, not strings** — this is what prevents "too good to be true" mismatches. Require, when both sides publish the field:
   - **Displacement within ±10%** — the single most reliable discriminator (1995 vs 1499 vs 2993 cm³).
   - **Power within ±15%** — compare German **PS** ↔ PT **cv** (same metric hp scale; do not compare against raw kW; Appendix A.4).
   - **Same fuel**, **first-reg year ±1**, **mileage ±20k** (§4.3 window).
4. **AI/LLM extraction is now a narrow FALLBACK, not the primary path.** Use a free/low-cost model only to (a) parse `{brand, model, variant}` from a free-text title when a source ever lacks the structured field, or (b) decide whether two `version`/trim strings are the *same* variant when price dispersion is suspiciously wide. Keep it behind the existing single extraction/matching interface so it stays swappable and the deterministic spec-based matcher above runs without it. Until a provider/schema is chosen, the deterministic matcher (steps 1–3) is the shipped behaviour.
5. **Directional model containment** (already in code): a comparable's model must *contain* the subject's normalised token, never the reverse — so a subject `320` doesn't pull in `320 Gran Turismo` unless intended, and a flagship name can't swallow a sub-model.

### 4.3 Comparable selection

For a given German car, a PT "comparable" MUST match on (per the §4.2 matching design):

- Same **brand** + normalised trim-number **model** (`320`, `X2`),
- **First-registration year within ±1**,
- **Mileage within ±20,000 km**,
- **Same fuel type** (only reject when *both* sides publish fuel and they differ),
- **Displacement within ±10%** and **power within ±15%** when both sides publish them — these two specs are what stop a base trim from being compared against a performance/equipment variant (the historical cause of fake "amazing deal" results). Compare PT `cv` against German `PS`, not raw `kW`.

A field that is genuinely missing on one side does not disqualify the comparable (don't drop a match just because one listing omitted CO₂); a field that is present on *both* and conflicts does.

### 4.4 From comparables to one number

Reduce the matched comparables to a single robust **PT market value**:

- Trim outliers (e.g. IQR) before averaging — listing prices are noisy.
- Prefer a mileage-aware estimate (regression predicted at the subject car's km) when sample size allows; otherwise fall back to median, then mean.
- The result MUST carry its **provenance**: how many comparables, from which source(s), and which method produced the number. The UI surfaces this so the user can judge confidence.

If there are too few comparables to be meaningful, the PT value is **Unknown** (not zero, not a guess) and the card reflects that.

---

## 5. Step 3 — Simulate import tax (ISV) and other costs

This step turns a German listing into a **total landed cost in Portugal**.

### 5.1 The landed-cost formula

```
Total landed cost (PT) = German price
                       + ISV            (computed — §5.2)
                       + VAT*           (only if "new means of transport" — §5.2.1)
                       + Transport      (configured real value — §6)
                       + Legalisation   (sum of configured, enabled fees — §6)
```

IUC (annual road tax) is **shown separately** as a yearly figure — it is an ownership cost, **never added** to the one-time landed cost.

### 5.2 ISV engine (design constraints — decided)

Regardless of the exact tables (which are the investigation below), the ISV engine MUST be:

- **A pure, deterministic function** — no I/O, no DB, no network. Inputs (displacement, CO₂, emission standard, fuel, age, hybrid/electric flags) → output (ISV breakdown). This makes it fully unit-testable and trustworthy.
- **Driven by official statutory tables** kept as data (not scattered magic numbers), with a clear marker of which fiscal year (OE) they're from. Tables change ~once a year and MUST be updated deliberately, never estimated.
- **Returning a breakdown**, not just a total: cylinder component, environmental component, age reduction applied, and any special regime (electric exempt, PHEV/hybrid discount) so the UI can explain the number.

#### 5.2.1 VAT note

23% IVA applies only to a **"new means of transport"** (≤6 months old **or** ≤6,000 km). When this can't be confirmed from the data, flag it "suspect" and **do not add it** (golden rule).

🔶 **PARTIALLY RESOLVED (2026-06-22) — researched draft in Appendix B, NOT yet authoritative.** Appendix B holds the 2026 cylinder table, the CO₂ tables (petrol/diesel × WLTP/NEDC), the age-reduction schedule, the BEV/PHEV/hybrid/CNG regimes, and the diesel particulate surcharge — enough to encode the pure engine *as a draft*. **Still required before any ISV number is shown to a user:** cross-check every value against the official **Portal das Finanças / Portal Aduaneiro ISV simulator**, confirm the minimum-ISV floor, the exact age brackets in *months*, and the IUC model. Per the golden rule, **do not ship these as final until verified.** The split that matters most (petrol/diesel × WLTP/NEDC) and the fuel/emission inputs are available from the listings — mobile.de gives the emission standard directly (`attr.emc`); otherwise default WLTP for first-reg ≥ 2019.

### 5.3 Costs that aren't computable — configuration (see §6)

Transport and legalisation are **real-world costs the user negotiates/quotes**, not things we can derive from a listing. They come from the configuration store (§6), used verbatim. The engine never invents them.

### 5.4 The completeness invariant (load-bearing — decided)

**Every component of the landed cost MUST resolve to a real computed or configured value.** If any required input is missing — no CO₂/displacement on the listing, no active transport method configured, a required fee unset — then:

- `totalLandedCostEur` is `null`,
- the result is flagged **Incomplete**, with a `missing[]` list naming exactly what's absent,
- the UI shows *"Incomplete — needs: <…>"* instead of a savings verdict.

**Never fill a gap with an estimate to complete the total.** That defeats the entire purpose of the product. This rule overrides convenience everywhere.

---

## 6. Cost configuration (page + store)

All non-derivable cost values live in a small persisted store and are managed on a **Configuration** page. This guarantees the landed-cost math always runs on real, user-owned values.

### 6.1 What's configurable

Ship sensible **pre-defined rows with placeholder defaults** the user then edits. Suggested starting set:

**Transport (Germany → Portugal)** — the user picks one **active** method per run:
| Key | Label | Default | Note |
|---|---|---|---|
| `transport.open_carrier` | Open transporter | placeholder | Typical market ~€500–700 (guidance only). |
| `transport.enclosed` | Enclosed transporter | placeholder | Typical ~€800–1,200 (guidance only). |
| `transport.drive_down` | Drive it down yourself | placeholder | Fuel/tolls/time. |

**Legalisation & registration** — summed when enabled:
| Key | Label | Default | Note |
|---|---|---|---|
| `fee.dua_registration` | DUA / registration (IMT) | placeholder | Official tariff. |
| `fee.inspection_ipo` | Inspection (IPO) | placeholder | IPO centre price. |
| `fee.dav_customs` | Customs declaration (DAV) | placeholder | If applicable. |
| `fee.agent_dispatcher` | Dispatcher / agent | placeholder, **disabled by default** | Optional. |

**Other** — free-form rows the user can **add** (name + amount), included in the total when enabled.

Reference market ranges are shown as **guidance text only** next to a field — they MUST NOT feed the calculation.

### 6.2 Store

A lightweight embedded SQL store (SQLite by default). Suggested shape:

```sql
CREATE TABLE cost_config (
  key        TEXT PRIMARY KEY,           -- 'transport.enclosed', 'fee.inspection_ipo', 'other.<slug>'
  label      TEXT NOT NULL,
  category   TEXT NOT NULL,              -- 'transport' | 'legalisation' | 'other'
  amount_eur REAL NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1, -- 0 = excluded from total
  notes      TEXT,                       -- optional quote/source reference
  updated_at TEXT NOT NULL               -- ISO timestamp
);

CREATE TABLE active_settings (
  key   TEXT PRIMARY KEY,                -- e.g. 'transport.active_method', 'runtime.*'
  value TEXT NOT NULL
);
```

Seeding MUST be **idempotent** (`INSERT OR IGNORE`) so re-running setup never clobbers the user's edits.

### 6.3 Config behaviour

- The Configuration page lists rows grouped by category; each is editable inline (amount, enabled, notes), Transport also picks the active method, and the user can add Other rows.
- Saving stamps `updated_at` (shown in the UI so the user can spot stale values).
- A validation banner warns when a value the calculator needs is unset (because that forces results Incomplete).
- The calculator reads config **fresh per search run** (cached in-memory for the run, invalidated on any config write) — no restart needed for an edit to take effect.

---

## 7. Step 4 — Show results

### 7.1 Result card — collapsed

One card per car:
- Thumbnail, title (Brand Model Year), key specs (mileage, fuel, transmission),
- **German price**,
- **Total landed cost** (highlighted) — or an **Incomplete** badge, other than the total cost we should show the descriminated costs to not just see the total
- **PT market average** (or "Unknown"),
- **Saving / loss badge**: green = saving, red = loss, grey = incomplete/unknown,
- Link to the original listing.

### 7.2 Result card — expanded

Clicking expands to the full breakdown:
- ISV detail (cylinder + environmental components, age reduction, special regime),
- Transport (active method + configured value, link to Config),
- Legalisation (itemised enabled fees),
- Annual IUC (separate),
- PT comparison detail: the market value, **how many comparables and from which source(s)**, and the estimation method (§4.4).

### 7.3 Sorting

Default sort: **highest saving first**. Also offer: total landed cost ↑, German price ↑, year ↓, mileage ↑.

### 7.4 Pagination across sources (decided behaviour)

Results from multiple sources are **merged into one combined list**. If source A returns 40 and source B returns 30, the user sees **70**. A **Next** button retrieves the *next page from each source* and shows the new results — and MUST be **lazy**: next pages are fetched only when the user clicks Next, never pre-loaded. Show clearly when a source has no more pages.

---

## 8. Caching

- **Search results / listings:** cache per (normalised) search with a **TTL of 3 hours** to avoid hammering the sources.
- **PT market comparisons:** cacheable (slow-moving data); a daily-ish refresh is fine.
- **Listing detail enrichment (specs):** cache long (≥7 days) — a car's specs don't change.
- **ISV tables:** in code, updated manually per OE.
- **Cost config:** read per run, in-memory for the run, invalidated on write.

Cache keys MUST include every field that changes the result (all filters + page + source) so two different searches can't collide.

---

## 9. Nightly batch scheduler (deep search)

A free, on-demand search is shallow (it can't compute much without spamming the sources). To go deeper, the app runs **scheduled batch searches overnight**.

- A **Batch Searches** page lets the user define and save **multiple named searches** (each is a full filter set, like §3.2).
- A scheduler runs **nightly** and executes each saved search **more deeply** (more pages / more enrichment than an interactive run), then stores only the **top deals** per saved search.
- The user reviews the curated top deals the next day.
- The scheduler MUST be **safe by default**: disabled until the user opts in, with sane rate limiting between source calls, and it MUST NOT block or slow interactive use.

> 🔍 **INVESTIGATE — batch depth, ranking & alerts.** Decide: how many pages "deep" a batch goes, how "top deals" are ranked and how many are kept per search, the schedule mechanism, and whether to add email alerts when a new deal beats a user-set saving threshold (e.g. €2,000). Output: the batch config schema + ranking rule + alerting decision.

---

## 10. Non-functional requirements

- **Clean, modern, responsive UI.** Fast, uncluttered, mobile-friendly. Results readable at a glance; detail on demand.
- **Backend: Node.js.**
- **Trust first.** The completeness invariant (§5.4) and provenance (§4.4) are not optional polish — they are the product. Prefer "we don't know" over a confident wrong number, everywhere.
- **Resilience.** Any single source failing degrades gracefully; the app still returns what it could from the others.
- **Testability.** Pure engine (ISV) and pure normalisers MUST have unit tests. The source/PT layers MUST be runnable in `mock` mode with deterministic fixtures so the whole flow is testable without network or credentials.

---

## 11. Suggested API surface

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness. |
| `GET /api/brands` | Brand → models map for the filter form. |
| `POST /api/search` | Run a search; returns merged, enriched, paginated results. |
| `GET /api/config` | All cost-config rows + active settings. |
| `PUT /api/config/:key` | Update one cost row (amount / enabled / notes). |
| `POST /api/config/active` | Set the active transport method. |
| `GET/POST/PUT/DELETE /api/batches` | Manage saved batch searches (§9). |
| `GET /api/batches/results` | Curated nightly top deals. |

(Exact shapes to be finalised during implementation; keep them RESTful and consistent.)

---

## 12. Scope for v1

**In scope:** passenger cars; AutoScout24 (+ mobile.de when access is solved); Standvirtual PT comparison; ISV + configured costs landed-cost; merged paginated results; cost config; 3-hour cache; nightly batch.

**Out of scope (v1):** financing/credit, exact IUC (estimate only), non-EU-origin vehicles (customs duty), motorcycles/commercials/motorhomes, vehicle-history (Carfax) lookups, the new-resident ISV exemption, cars older than the ISV "Table B" cutoff.

---

## 13. Open investigations — index

These must be resolved (with the user, or via research the user requests) before the corresponding feature is final. **Do not implement a `{}` block's contents as final until its investigation is closed.**

1. ✅ **§3.2** Common filters across AutoScout24 & mobile.de (& Standvirtual) + param mapping — **closed**, see §3.2 + Appendix A.5/A.6.
2. ✅ **§3.5** Per-source access mechanics, pagination, rate limits — **closed**, see §3.5 + Appendix A.2–A.4.
3. ✅ **§4.1** Whether one PT source suffices; which to add — **closed** (Standvirtual primary, OLX.pt secondary), see §4.1.
4. ✅ **§4.2** Brand/model extraction + matching contract — **closed** (structured make/model + spec-based variant disambiguation; AI is fallback only), see §4.2/§4.3.
5. 🔶 **§5.2** Official ISV (and IUC) tables & formulas, per OE year — **draft in Appendix B; awaiting official Portal das Finanças cross-check**.
6. 🔍 **§9** Batch depth, top-deal ranking, and email alerts — **still open**.

When an investigation closes, replace its 🔍 block with the decided design (tables, mappings, thresholds) and update this index.

**Status (verified 2026-06-22, by live browser inspection of all three sites):** #1, #2, #3, #4 are **closed** — see §§3.2–3.5, §4, and **Appendix A** for the verified field/filter/access maps. #5 has a **researched draft** (Appendix B) that still requires official Portal das Finanças cross-check before shipping. #6 remains open.

---

## Appendix A — Verified source field & filter maps

> Captured live on **2026-06-22** by inspecting each site's embedded data and search params in a real browser. These are ground truth for the adapters. Re-verify if a site changes its front-end (the existing `direct/*` adapters already read these exact shapes — see the codebase map). Anything I could not confirm in-session is marked **(verify)**.

### A.1 The decisive accuracy finding

**All three sites expose clean, structured `make` + `model` fields — brand/model do NOT have to be parsed out of the title.** Crucially, the `model` field aligns across all three at the **trim-number** level:

| | AutoScout24 | mobile.de | Standvirtual (PT) |
|---|---|---|---|
| make | `BMW` | `BMW` | `BMW` |
| model | `320` (`vehicle.model`) | `520` (`item.model`) | `320` (param `model`, value `320`) |
| modelGroup | `3 Series` (`vehicle.modelGroup`) | — | — |

So the join key for "same car" is the **trim-number `model`** (`320`, `X2`, `520`), **not** the German `modelGroup` (`3 Series`) which has no Standvirtual equivalent. This removes most of the AI-extraction risk in the original §4.2 — see §4.2 for the revised matching design.

### A.2 AutoScout24 — extraction map

- **Retrieval:** GET the public `/lst` HTML; the full result set is embedded as JSON in `<script id="__NEXT_DATA__">` → `props.pageProps`. No key, no API. (Existing `direct/autoscout24.js` already does this.)
- **Pagination:** `props.pageProps.numberOfResults`, `numberOfPages`; **page size 20**; param `page=N`. AS24 hard-caps usable pages around 20 (≈400 cards) per query.
- **Listings array:** `props.pageProps.listings[]`. Per listing:

| Normalised field | Path in AS24 listing | Example |
|---|---|---|
| brand | `vehicle.make` | `"BMW"` |
| model | `vehicle.model` | `"320"` |
| modelGroup (aux) | `vehicle.modelGroup` | `"3 Series"` |
| variant / trim text | `vehicle.variant`, `vehicle.modelVersionInput` | `"Touring"`, `"d Touring Facelift…"` |
| priceEur | `tracking.price` (numeric string) / `price.priceFormatted` | `"24995"` / `"€ 24,995"` |
| mileageKm | `tracking.mileage` / `vehicle.mileageInKm` | `"44583"` / `"44,583 km"` |
| firstRegistration | `tracking.firstRegistration` (`MM-YYYY`) | `"03-2018"` |
| fuelType | `vehicle.fuel` / `tracking.fuelType` | `"Diesel"` / `"d"` |
| transmission | `vehicle.transmission` | `"Automatic"` |
| engineCc | `vehicle.engineDisplacementInCCM` | `"1,995 cc"` |
| powerKw | `vehicleDetails[]` where `ariaLabel==="Power"` → `.data` | `"140 kW (190 hp)"` |
| **co2Gkm** | `wltpValues[]` entry matching `/g\/km/` | `"126 g/km (comb.)"` |
| offerType | `vehicle.offerType` | `"U"` (used) / `"N"` (new) |
| url | `url` (relative, prefix `https://www.autoscout24.com`) | `/offers/…` |
| imageUrl | `images[0]` | … |
| location | `location.{zip,city,countryCode}` | `86609 / Donauwörth / DE` |

- **⚠ CO₂ coverage gap:** only ~**5 of 19** search cards carried `wltpValues` CO₂ in testing; `engineCc` was on 18/19. **CO₂ (and sometimes displacement) must be enriched from the detail page** for most listings before ISV can be computed, else the car is **Incomplete** (§5.4). This confirms the existing enrichment design.

### A.3 mobile.de — extraction map

- **Retrieval (two paths):**
  1. **SSR state (primary, keyless):** GET `https://suchen.mobile.de/fahrzeuge/search.html?…`; the result set is in `window.__INITIAL_STATE__` (a ~230 KB inline JSON, **not** `__NEXT_DATA__`) → `search.srp.data.searchResults.items[]`. The page server-renders the cards even behind the cookie-consent overlay.
  2. **Internal JSON API:** `https://m.mobile.de/consumer/api/search/hit-count?…` returns `{"count":N}` (confirmed 200); the sibling `…/consumer/api/search/srp` (domain `search/srp/getSrpData`) returns the SRP payload but rejected our hand-built params in-session **(verify exact param contract)**.
- **⚠ Anti-bot fragility:** the *first* make-only request returned full SSR state; an immediate *filtered* re-request returned only the empty JS shell (no `__INITIAL_STATE__`). mobile.de gates SSR behind consent/anti-bot heuristics. **Treat direct mobile.de as best-effort and keep the Apify/paid-provider fallback** (matches §3.5). Realistic headers, a consent cookie, pacing, and proxies are likely required for reliable direct access.
- **Pagination:** total via `search.srp.data.metaData` / breadcrumb count; **page size ~27** observed; page param `pageNumber=N` **(verify)**.
- **Items array:** `search.srp.data.searchResults.items[]`. Per item:

| Normalised field | Path in mobile.de item | Example |
|---|---|---|
| brand | `make` | `"BMW"` |
| model | `model` | `"520"` |
| title / subtitle | `shortTitle` / `subTitle` | `"BMW 520"` / `"Touring Business Paket…"` |
| priceEur | `price.grossAmount` (number) / `price.gross` | `24999` / `"24.999 €"` |
| (vat aux) | `price.net`, `price.vat` | `"21.008 €"`, `"19% MwSt."` |
| firstRegistration | `attr.fr` (`MM/YYYY`) | `"03/2020"` |
| mileageKm | `attr.ml` | `"73.826 km"` |
| powerKw | `attr.pw` | `"140 kW (190 PS)"` |
| fuelType | `attr.ft` | `"Diesel"` |
| transmission | `attr.tr` | `"Automatik"` |
| engineCc | `attr.cc` | `"1.995 cm³"` |
| **emissionStandard** | `attr.emc` | `"Euro6d-TEMP"` |
| bodyType | `attr.c` / `category` | `"EstateCar"` / `"Kombi"` |
| seats / doors / owners | `attr.sc` / `attr.door` / `attr.pvo` | `"4"` / `"4/5"` / `"2"` |
| KBA type-approval | `kba.hsn`, `kba.tsn` | `"0005"`, `"COR"` |
| price rating (aux) | `priceRating.rating` | `"GOOD_PRICE"` |
| url | `relativeUrl` (prefix `https://www.mobile.de`) | `/fahrzeuge/details.html?id=…` |
| imageUrl | `previewImage.src` | … |

- **No CO₂ on the card** (same as AS24 → enrich from detail). But `attr.emc` gives the **emission standard directly** (no need to infer WLTP/NEDC from year), and `kba.hsn/tsn` uniquely identify the exact variant for spec lookup.

### A.4 Standvirtual (PT comparison) — extraction map

- **Retrieval:** GET `https://www.standvirtual.com/carros/…` HTML; data is GraphQL (urql) cache in `<script id="__NEXT_DATA__">` → `props.pageProps.urqlState[<key>].data` (a JSON **string** — parse it) → `advertSearch`. (Existing `direct/standvirtual.js` already reads this.)
- **Pagination:** `advertSearch.totalCount`; **page size 32**; param `page=N`.
- **Listings:** `advertSearch.edges[].node`. Fields live in `node.parameters[]` (`{key, value, displayValue}`):

| Normalised field | `parameters[].key` (or node path) | `displayValue` / value |
|---|---|---|
| brand | `make` | `"BMW"` / `bmw` |
| model | `model` | `"320"` / `320` |
| variant | `version` | `"M35i Pack 50 anos M"` |
| fuelType | `fuel_type` | `"Diesel"` (value `diesel`; petrol value seen as `gaz`) |
| transmission | `gearbox` | `"Automática"` / `automatic` |
| mileageKm | `mileage` | `"44898 km"` / `44898` |
| engineCc | `engine_capacity` | `"1998 cm3"` / `1998` |
| **powerCv** | `engine_power` | `"190 cv"` / `190` — **metric hp (= German PS), ×0.7355 → kW** |
| firstRegistration | `first_registration_year` | `"2020"` |
| origin | `origin` | `"Importado"` / `imported` (vs national) |
| priceEur | `node.price.amount.units` (number) | `39950` |
| **PT price rating** | `node.priceEvaluation.indicator` | `BELOW` / `IN` / `ABOVE` (market) |
| title / url | `node.title` / `node.url` | … |
| location | `node.location.{city,region}` | `Almancil / Faro` |

- **Power units gotcha:** Standvirtual reports **cv** (metric hp), which equals the German **PS** number (both ≈190 for a 140 kW car). Compare German `PS`↔PT `cv` directly, or convert both to kW. Do **not** compare PT `cv` against German `kW` raw.
- **`priceEvaluation.indicator`** is Standvirtual's own market positioning per listing — surface it as a free provenance/sanity signal alongside our computed PT value.

### A.5 Filter → param map (our form → each source)

| Our filter | AutoScout24 (`/lst?…`) | mobile.de (`suchen.mobile.de?…`) | Standvirtual (`/carros/…`) |
|---|---|---|---|
| Brand | `mmmv=<makeId>\|\|\|` (e.g. BMW=`13`) | `ms=<makeId>;;;<name>` (BMW=`3500`) | path `/<brand-slug>` (`bmw`) |
| Model | `mmmv=<makeId>\|<modelId>\|\|` (320=`1641`) | `ms=<makeId>;<modelId>;;<name>` | path `/<brand>/<model-slug>` (`320`) |
| Price min/max | `pricefrom` / `priceto` | `p=<min>:<max>` | `search[filter_float_price:from]` / `:to` |
| Year from / to | `fregfrom` / `fregto` (year) | `fr=<minY>:<maxY>` | path `desde-<year>` or `search[filter_float_first_registration_year:from]`/`:to` |
| Max mileage | `kmto` (`kmfrom`) | `ml=:<maxKm>` | `search[filter_float_mileage:to]` (`:from`) |
| Fuel type | `fuel` (multi, comma) | `ft` (repeatable) | `search[filter_enum_fuel_type]` (multi via `[0]`,`[1]`) |
| Transmission | `gear` | `tr` | `search[filter_enum_gearbox]` |
| Power (kW) | `powerfrom`/`powerto` + `powertype=kw` | `pw=<minKw>:<maxKw>` | `search[filter_float_engine_power:from]`/`:to` — **value in cv, convert kW→cv (×1.36)** |
| Displacement | `cubicfrom`/`cubicto` (verify) | `cc=<min>:<max>` | `search[filter_float_engine_capacity:from]`/`:to` |
| Body type | `body` (1–7) | `c` (`Limousine`,`EstateCar`,…) | `search[filter_enum_body]` (slug, verify) |
| Used / new | `ustate=N,U` | `con=USED`/`NEW` | path segment `/usados/` or `/novos/` |
| Exclude damaged | `damaged_listing=exclude` | `dam=false` | n/a |
| Country | `cy=D` | (DE site) | n/a (PT only) |
| Page | `page=N` | `pageNumber=N` (verify) | `page=N` |
| Sort | `sort=<key>&desc=0/1` | `sb=rel\|pr…&od=up/down` | `search[order]=relevance_web` (or `filter_float_price:asc`…) |

**Enum value tables (verified):**

- **AS24 `fuel`:** Gasoline=`B`, Diesel=`D`, Electric=`E`, Electric/Gasoline(hybrid)=`2`, Electric/Diesel=`3`, LPG=`L`, CNG=`C`, Hydrogen=`H`, Ethanol=`M`. **`gear`:** Automatic=`A`, Manual=`M`, Semi=`S`. **`body`:** Compact=`1`, Convertible=`2`, Coupe=`3`, SUV=`4`, Station Wagon=`5`, Sedan=`6`, Van=`12`, Transporter=`13`, Other=`7`. **emission `emclass`:** Euro1..6 = `1..6`, 6b=`11`,6c=`7`,6d=`8`,6d-TEMP=`9`,6e=`10`. (make/model IDs come from the same page's `props.pageProps.taxonomy.{makeLabels,models}`.)
- **mobile.de `ft`:** `PETROL`,`DIESEL`,`ELECTRICITY`,`HYBRID`(petrol/elec),`HYBRID_DIESEL`,`LPG`,`CNG`,`ETHANOL`,`HYDROGENIUM`,`OTHER`. **`tr`:** `AUTOMATIC_GEAR`,`MANUAL_GEAR`,`SEMIAUTOMATIC_GEAR`. **`c`:** `Limousine`,`EstateCar`,`OffRoad`,`Cabrio`,`SmallCar`,`SportsCar`,`Van`,`OtherCar`. **`emc`:** `EURO1..EURO6`,`EURO6C`,`EURO6D_TEMP`,`EURO6D`,`EURO6E`,`EURO7`. **`con`:** `NEW`,`USED`. Range params take `min:max` (omit a side to leave open, e.g. `ml=:100000`). (make/model IDs come from `__INITIAL_STATE__.shared.filtersConfig`.)
- **Standvirtual `filter_enum_fuel_type`:** `petrol`,`diesel`,`electric`,`hybrid`,`plugin-hybrid`,`lpg` **(confirm petrol/electric/hybrid slugs — only `diesel` verified live; note result data uses `gaz` for petrol)**. **`filter_enum_gearbox`:** `automatic`,`manual`.

### A.6 Filters to drop or treat as one-sided

- **Drop from the comparable shape:** anything only one side supports cleanly. Body type is filterable on all three but labels diverge (German vs PT vs AS24 numeric) — keep it as a German-source *search* filter, but do **not** require body-type equality when matching to PT (the existing code already forces `bodyType=null` on German listings for this reason).
- **Power must be normalised** to one unit before filtering/matching (German kW vs PT cv/PS).
- **Year:** German sources filter by `firstRegistration` year; the PT comparison uses a year **window** (±1) rather than an exact filter (§4.3).

---

## Appendix B — ISV / IUC research draft (NOT yet authoritative)

> Researched 2026-06-22 from public PT tax summaries. **These numbers MUST be cross-checked against the official Portal das Finanças / Portal Aduaneiro ISV simulator before they drive a shipped figure** (§5.2, golden rule). Encode them as dated data tables (`OE2026`) in the pure ISV engine, not inline. The 2026 tables are reported as **unchanged from 2025** (no rate increase in the State Budget).

**Component A — Cylinder capacity (light passenger):** `ISV_A = cc × rate − parcela`.

| Displacement (cm³) | Rate / cm³ | Parcela a abater |
|---|---|---|
| ≤ 1,000 | €1.09 | €849.03 |
| 1,001–1,250 | €1.18 | €850.69 |
| > 1,250 | €5.61 | €6,194.88 |

**Component B — Environmental (CO₂):** `ISV_B = co2 × rate − parcela`, using the table for the car's **fuel × homologation cycle**. Pick WLTP vs NEDC from the listing (mobile.de `attr.emc` / detail data); default WLTP for first registration ≥ 2019.

*Petrol — WLTP:*

| CO₂ (g/km) | Rate | Parcela |
|---|---|---|
| ≤110 | €0.44 | €43.02 |
| 111–115 | €1.10 | €115.80 |
| 116–120 | €1.38 | €147.79 |
| 121–130 | €5.27 | €619.17 |
| 131–145 | €6.38 | €762.73 |
| 146–175 | €41.54 | €5,819.56 |
| 176–195 | €51.38 | €7,247.39 |
| 196–235 | €193.01 | €34,190.52 |
| >235 | €233.81 | €41,910.96 |

*Diesel — WLTP:*

| CO₂ (g/km) | Rate | Parcela |
|---|---|---|
| ≤110 | €1.72 | €11.50 |
| 111–120 | €18.96 | €1,906.19 |
| 121–140 | €65.04 | €7,360.85 |
| 141–150 | €127.40 | €16,080.57 |
| 151–160 | €160.81 | €21,176.06 |
| 161–170 | €221.69 | €29,227.38 |
| 171–190 | €274.08 | €36,987.98 |
| >190 | €282.35 | €38,271.32 |

*(Petrol-NEDC and Diesel-NEDC tables also captured during research — encode all four. NEDC applies mainly to pre-2019 cars.)*

**Age reduction (used EU imports)** — applied as a single percentage to **(A + B)** under the post-OE2025 unified rule (so it now reduces the environmental component too):

| Age since 1st registration | Reduction |
|---|---|
| ≤1 yr | 10% |
| 1–2 | 20% |
| 2–3 | 28% |
| 3–4 | 35% |
| 4–5 | 43% |
| 5–6 | 52% |
| 6–7 | 60% |
| 7–8 | 65% |
| 8–9 | 70% |
| 9–10 | 75% |
| >10 | 80% |

**Special regimes:**
- **Battery-electric (BEV): exempt** from ISV (and IUC).
- **PHEV** (plug-in, ≥50 km electric range, CO₂ <50 g/km — Euro 6e-bis raises the CO₂ ceiling to 80 g/km in 2026): **75% reduction** on the ISV total.
- **Full hybrid** (qualifying): **40% reduction**.
- **CNG** (mono-fuel): **60% reduction**.
- **Diesel particulate surcharge:** **+€500** (≈€615 with VAT) for diesel light passenger cars emitting ≥0.001 g/km particulates or lacking official particulate data.
- **Minimum ISV / floor:** **(verify exact value)**.

**Caveats to resolve before shipping:** exact NEDC tables, the statutory age-reduction brackets in **months** (sources disagree on year vs month boundaries), the minimum-ISV floor, and the precise PHEV/hybrid qualifying conditions — all against the official simulator. Non-EU-origin cars get **no** age reduction (out of v1 scope anyway, §12).

**IUC (annual, shown separately — never added to landed cost):** still **open** — compute from displacement + CO₂ + fuel + first-registration year bracket (post-2007 "Categoria B" cars use the additive cc + CO₂ model). Encode as its own dated table once verified. For now, if IUC can't be computed, show it as "—", never a guess.

*Sources consulted (summaries, not authoritative):* impostosobreveiculos.info, ecoimport.pt, caetano.pt, autogo.pt, veiculo.pt, CGD Saldo Positivo, ACP. **Authoritative source = Portal das Finanças ISV simulator.**
