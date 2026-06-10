# Car Import Bot — Product Specification

> A web application that searches mobile.de for used cars matching user-defined filters, calculates the full cost of importing each car to Portugal, and compares it against equivalent listings on the Portuguese market.

---

## 1. Purpose

Buying a used car in Germany (via mobile.de) and importing it to Portugal can be significantly cheaper than buying the same car in Portugal — but only after accounting for all import taxes and fees. This tool automates the discovery, cost calculation, and comparison so the user can immediately see whether an import is worth pursuing.

---

## 2. User Flow

1. User opens the landing page.
2. User sets their car search filters (brand, model, year, mileage, price, fuel, transmission).
3. User provides the technical details needed for ISV calculation (engine cc, CO₂ g/km, emission standard).
4. User clicks **Run Bot**.
5. The bot queries mobile.de (via API or scraper adapter) and retrieves matching listings.
6. For each listing, the app calculates the total landed cost in Portugal.
7. The app fetches comparable listings from a Portuguese market source (e.g. Standvirtual, OLX) and displays the average asking price for the same model/year/mileage bracket.
8. Each result card shows: German price, import costs breakdown, total landed cost, PT market price, and the saving or premium.
9. User can sort, filter results, expand cost breakdowns, and export to CSV.

---

## 3. Search Filters

| Filter | Type | Notes |
|---|---|---|
| Brand | Dropdown | BMW, Mercedes-Benz, Audi, VW, Porsche, Toyota, Ford, Skoda, Opel, Hyundai, Kia, Tesla, Renault, etc. |
| Model | Dependent dropdown | Populates based on selected brand |
| Body type | Dropdown | SUV, Saloon, Estate, Coupé, Convertible, Van, Small |
| Price range | Min / max numeric inputs | In EUR |
| Year from | Dropdown | 2010 to current year |
| Max mileage | Dropdown | 10k / 30k / 50k / 80k / 100k / 150k / 200k km |
| Fuel type | Multi-select pills | Petrol, Diesel, Electric, Hybrid, PHEV, LPG |
| Transmission | Dropdown | Any / Automatic / Manual |
| Location radius | Zip code + km radius | Defaults to all Germany |

### Technical inputs (for ISV calculation)

These can be pre-filled automatically if the listing includes them, or entered manually:

| Field | Notes |
|---|---|
| Engine displacement (cm³) | Used for ISV cylinder component |
| CO₂ emissions (g/km) | Used for ISV environmental component |
| Emission standard | NEDC or WLTP — critical for correct table lookup |
| Hybrid type | None / Full hybrid / PHEV (affects ISV discount) |

---

## 4. Import Cost Calculator

For each car retrieved from mobile.de, the app calculates the full cost of importing it to Portugal. All figures are based on Portuguese law in force as of 2025/2026 (OE2025 reforms, maintained in OE2026).

### 4.1 ISV — Imposto Sobre Veículos

The largest single cost. Paid once at first registration in Portugal.

**Formula:**

```
ISV = (Cylinder component + Environmental component) × (1 − age_reduction)
```

**Cylinder component (gasoline/diesel, passenger cars):**

| Displacement | Rate per cm³ | Deduction |
|---|---|---|
| Up to 1,000 cm³ | €1.09 | €849.03 |
| 1,001 – 1,250 cm³ | €1.18 | €850.69 |
| Over 1,250 cm³ | €5.61 | €6,194.88 |

Example: 1,498 cm³ → 1,498 × 5.61 − 6,194.88 = **€2,209.90**

**Environmental component — Gasoline, WLTP:**

| CO₂ (g/km) | Rate per g/km | Deduction |
|---|---|---|
| Up to 110 | €0.44 | €43.02 |
| 111 – 115 | €1.10 | €115.80 |
| 116 – 120 | €1.38 | €147.79 |
| 121 – 130 | €5.27 | €619.17 |
| 131 – 145 | €6.38 | €762.73 |
| 146 – 175 | €41.54 | €5,819.56 |
| 176 – 195 | €98.78 | €16,128.51 |
| Over 195 | €148.45 | €25,847.36 |

**Environmental component — Gasoline, NEDC:**

| CO₂ (g/km) | Rate per g/km | Deduction |
|---|---|---|
| Up to 99 | €4.62 | €427.00 |
| 100 – 115 | €8.09 | €750.99 |
| 116 – 145 | €52.56 | €5,903.94 |
| 146 – 175 | €61.24 | €7,140.17 |
| 176 – 195 | €155.97 | €23,627.27 |
| Over 195 | €205.65 | €33,390.12 |

**Environmental component — Diesel:** use diesel-specific tables (slightly higher rates). Add €500 diesel surcharge if particle emissions ≥ 0.001 g/km.

**Age reduction (applied equally to both components from 2025 onward):**

| Vehicle age | Reduction |
|---|---|
| Less than 1 year | 0% |
| 1 year | 10% |
| 2 years | 20% |
| 3 years | 28% |
| 4 years | 35% |
| 5 years | 40% |
| 6 years | 52% |
| 7 years | 60% |
| 8 years | 65% |
| 9 years | 70% |
| 10+ years | 80% |

**Special regimes:**

| Type | ISV treatment |
|---|---|
| 100% Electric | Exempt (€0 ISV) |
| PHEV (≥50 km range, ≤50 g/km CO₂, or ≤80 g/km Euro 6e-bis) | 25% of calculated ISV |
| Full hybrid (≥50 km range, ≤50 g/km CO₂) | 40% discount (pays 60%) |
| PHEV registered 2015–2020, ≥25 km range | 25% ISV (intermediate regime) |
| Minimum ISV payable | €100 |

### 4.2 IUC — Imposto Único de Circulação

Annual road tax. Shown as a yearly estimate for the user's reference — not added to the one-time import cost total, but displayed separately so the user understands the ongoing ownership cost.

Calculated from engine cc, CO₂ emissions, and first registration year. For imported used cars, the base year is the original registration year in the country of origin (rule since 2020).

### 4.3 Transport cost (Germany → Portugal)

Transport is a **real, configurable cost**, not a baked-in estimate. The value is read from the configuration database (see §4.6) and is editable on the configuration page. No hardcoded fallback is used in the landed-cost total — if no transport value is configured, the result is flagged as incomplete rather than silently estimated.

The config store holds one row per transport method so the user maintains their own real quotes:

| Method (config key) | Source of value |
|---|---|
| `transport.enclosed` | Real quote from the user's preferred transporter |
| `transport.open_carrier` | Real quote |
| `transport.drive_down` | Real quote |

The user selects the active method per run (or per car); the calculator uses the exact configured amount for that method. Reference market ranges (e.g. enclosed ~€800–€1,200, open carrier ~€500–€700) are shown only as guidance text next to the input — they never feed the calculation.

### 4.4 Legalisation & registration fees

Each legalisation fee is a **real, configurable line item** stored in the configuration database (see §4.6) and editable on the configuration page. These are statutory or quoted amounts the user fills in from official sources, not estimates:

| Fee (config key) | Source of value |
|---|---|
| `fee.dua_registration` | Official IMT / registration tariff |
| `fee.inspection_ipo` | Real IPO centre price |
| `fee.dav_customs` | Customs declaration cost, if applicable |
| `fee.agent_dispatcher` | Real dispatcher quote (optional; toggleable) |

The total legalisation cost is the sum of the enabled, configured line items — there is no default lump sum. Reference market ranges may be shown as guidance text but are never used in the calculation.

### 4.5 Total landed cost formula

```
Total landed cost = German price + ISV + Transport + Legalisation fees
```

Where:
- **ISV** is computed by the calculation engine from the official tables (a real, deterministic value).
- **Transport** is the exact amount configured for the selected method (§4.3).
- **Legalisation fees** is the sum of the configured, enabled line items (§4.4).

Every component must resolve to a real configured or computed value. If any required component is missing from the configuration store, the result is marked **Incomplete** (with the missing fields listed) instead of being completed with an estimate, so the user never sees a "worth importing" verdict based on guessed numbers.

IUC is shown separately as an annual figure.

### 4.6 Configuration data store

All values that are not derivable from the listing or the ISV tables — transport costs, legalisation fees, and any other cost assumptions — are persisted in a small SQL database and managed through a frontend **Configuration** page. This guarantees the landed-cost calculation always runs on real, user-owned values rather than hardcoded estimates.

**Storage:** a lightweight embedded SQL database (SQLite by default; any SQL engine works) with a single key/value-style settings table plus typed cost-config tables.

**Proposed schema:**

```sql
-- Generic editable cost parameters (transport methods, fees, surcharges, etc.)
CREATE TABLE cost_config (
  key          TEXT PRIMARY KEY,   -- e.g. 'transport.enclosed', 'fee.inspection_ipo'
  label        TEXT NOT NULL,      -- human-readable name shown on the config page
  category     TEXT NOT NULL,      -- 'transport' | 'legalisation' | 'other'
  amount_eur   REAL NOT NULL,      -- the real value, in EUR
  enabled      INTEGER NOT NULL DEFAULT 1,  -- include in total (0 = excluded)
  notes        TEXT,               -- optional source/quote reference
  updated_at   TEXT NOT NULL       -- ISO timestamp of last edit
);

-- Which transport method is active for the calculation
CREATE TABLE active_settings (
  key          TEXT PRIMARY KEY,   -- e.g. 'transport.active_method'
  value        TEXT NOT NULL
);
```

**Configuration page (frontend):**
- Lists every `cost_config` row grouped by category (Transport / Legalisation / Other).
- Each row is editable inline: amount, enabled toggle, and notes.
- Transport section also picks the active method.
- Saving writes back to the SQL store via the backend config API and stamps `updated_at`.
- A validation banner warns if any field required by the calculator is unset, since that would force results into the **Incomplete** state.

**Backend config API:**
- `GET /api/config` → returns all cost-config rows and active settings.
- `PUT /api/config/:key` → updates a single row (amount / enabled / notes).
- `POST /api/config/active` → sets the active transport method.

The calculation engine reads these values at run time so every result reflects the latest configured real costs. ISV tables remain hardcoded (they are statutory and change once a year per OE), but everything the user can negotiate or quote lives in the config DB.

---

## 5. Portugal Market Comparison

For each result, the app fetches or estimates the average Portuguese market price for the equivalent car:

- Same brand + model
- Same year ± 1
- Similar mileage bracket (±20,000 km)

**Data sources to integrate:**
- Standvirtual.com (largest PT used car marketplace) — scrape or use unofficial API
- OLX Portugal (secondary)
- Carforyou Portugal (optional)

**Comparison output:**

```
German price:          €18,500
ISV (computed):        €3,840
Transport (config):    €850   ← real configured value
Legalisation (config): €540   ← sum of configured fees
─────────────────────────────
Total landed cost:     €23,730

Portugal market avg:   €27,500
─────────────────────────────
Estimated saving:      €3,770  ✅ (+14%)
```

Transport and legalisation amounts shown are the exact values from the configuration store (§4.6), not estimates. If any required config value is missing, the card shows **Incomplete — configure: <missing fields>** instead of a saving/premium verdict.

If landed cost > PT market price, show a warning: ⚠️ Import may not be cost-effective.

---

## 6. Results Display

### Result card (collapsed view)

Each car shows:
- Thumbnail image
- Title: Brand + Model + Year
- Mileage, fuel type, transmission
- German asking price
- Total landed cost (highlighted)
- PT market avg price
- Saving / premium badge (green = saving, red = premium)
- "View on mobile.de" external link

### Result card (expanded view)

Clicking a card expands it to show the full cost breakdown:
- ISV calculation detail (cylinder component + environmental component, age reduction applied, special regime if any)
- Transport cost — the active configured value, with the method name and a link to the Configuration page
- Legalisation cost — itemised list of the enabled configured fees that make up the total
- Annual IUC estimate
- PT market comparison with number of listings used to compute the average

Inline edits to transport/legalisation on a card write through to the configuration store (§4.6), so changes persist and apply to all future runs — there are no per-card throwaway estimates.

### Sort options

- Total landed cost (low to high) — default
- Saving vs. PT market (highest saving first)
- German price (low to high)
- Year (newest first)
- Mileage (lowest first)

---

## 7. Bot Schedule & Alerts

| Option | Description |
|---|---|
| Manual only | User clicks Run Bot each time |
| Every hour | Bot re-runs in the background and flags new listings |
| Daily | Once per day |
| Weekly | Once per week |

Email alert toggle: when on, sends a notification when a new listing appears that meets filters and shows a saving above a user-defined threshold (e.g. €2,000).

---

## 8. Export

- **CSV export**: one row per result, columns: brand, model, year, km, fuel, German price, ISV, transport, legalisation, total landed, PT market avg, saving
- **JSON export**: full structured data including ISV breakdown
- **Share link**: URL-encodes the current filter state so it can be bookmarked or shared

---

## 9. Technical Architecture

### Frontend
- Single-page application (React + Vite recommended)
- Mobile-responsive
- Filter state persisted to URL query params

### Backend / Bot layer
- Node.js or Python service
- **mobile.de data**: official Seller API (requires dealer registration) or a third-party adapter (Carapis, Apify mobile.de scraper)
- **PT market data**: scraper for Standvirtual / OLX, or Carapis PT endpoint
- ISV calculation engine: pure function, no external dependency — based on the official Portuguese tables (hardcoded, updated per OE)
- **Configuration store**: small SQL database (SQLite by default) holding all non-derivable cost values — transport methods, legalisation fees, surcharges (see §4.6). Exposed via the config API and edited on the Configuration page. The calculator reads real values from here at run time; it never falls back to hardcoded estimates.
- Scheduler: cron jobs (daily/hourly) with email via SendGrid or similar

### Data flow

```
User sets filters
        ↓
Bot queries mobile.de API / scraper
        ↓
Load real cost values from config DB (§4.6)
        ↓
For each listing:
  → Calculate ISV (local engine)
  → Add active transport + enabled legalisation fees (real configured values)
  → If any required config value missing → mark result Incomplete
  → Query PT market comparison cache
        ↓
Return enriched results to frontend
        ↓
Render cards with cost breakdown + comparison
```

### Caching
- PT market prices: refreshed daily (slow-moving data)
- mobile.de listings: refreshed per bot run
- ISV tables: hardcoded, updated manually per OE (once a year)
- Cost config (transport / legalisation): read from the SQL store per bot run; cached in memory for the duration of a run and invalidated whenever the config API writes a change

---

## 10. Known Limitations & Caveats

- ISV figures are computed from the official tables but remain an approximation. The official simulator on Portal das Finanças is the authoritative source. Users should verify before committing.
- Transport and legalisation costs are only as accurate as the values the user enters in the configuration store (§4.6). The app uses these real values verbatim — it does not estimate them — so an out-of-date or wrong config produces a wrong landed cost. The Configuration page shows `updated_at` per field to help keep values current.
- WLTP vs. NEDC matters a lot. The app should prompt the user to confirm which standard applies if the listing does not specify.
- The diesel particle surcharge (€500) only applies if emissions ≥ 0.001 g/km — this data is rarely in listings and should be shown as a warning.
- PT market comparisons are approximate; results depend on the number of equivalent listings available at query time.
- Cars registered before 1970 use different ISV rules (Table B) and are not in scope for v1.
- The ISV exemption for new residents transferring from another EU country is not calculated here — that is a one-off personal exemption handled separately.

---

## 11. Out of Scope (v1)

- Financing / credit comparisons
- IUC exact calculation (estimate only)
- Non-EU origin vehicles (customs duty applies and varies)
- Motorcycles, commercial vehicles, motorhomes
- Buying agent services integration
- In-app vehicle history / Carfax lookup
