#!/usr/bin/env node
// Build the vehicle catalog (brand → models) for the fuzzy matcher from PUBLIC
// datasets — no API keys, no paid tiers. No single public source is both
// European-complete AND recency-accurate, so we use a hybrid, each source for
// its strength:
//
//   1. abhionlyone/us-car-models-data (GitHub, free) — per-year CSVs 2010→present.
//      Clean and YEAR-ACCURATE, so taking years ≥ 2010 inherently satisfies the
//      "2010+" requirement. Covers ~45 brands incl. Audi/BMW/Mercedes/VW/Volvo/
//      Porsche/Toyota/Tesla/Mini… but, being a US-market list, OMITS the core
//      European marques this DE→PT tool needs.
//
//   2. Wikidata (CC0, free, no key) — fills the European brands the US set lacks
//      (Opel, Peugeot, Citroën, Škoda, SEAT, Dacia, Renault, Cupra, DS, Suzuki…).
//      Wikidata's production dates are too sparse to filter by year (≈90% of
//      models are undated), so for these brands we instead strip generation codes,
//      drop pre-war/displacement-named noise ("1.2 litre", "10/40 PS") and any
//      model with a known discontinued date < 2010.
//
//   3. The hand-written seed (vehicleCatalog.js) overlays brand aliases ("vw",
//      "merc", "mercedez") and curated submodels/trims onto matching models.
//
// Only EU-relevant marques are emitted (US-domestic-only brands like Buick/GMC/Ram
// are excluded). Output is committed so the app works without re-running.
//
// Usage:  node scripts/build-vehicle-catalog.mjs
// Output: server/src/data/vehicleCatalog.generated.json

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VEHICLE_CATALOG } from '../server/src/data/vehicleCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'server', 'src', 'data', 'vehicleCatalog.generated.json');

const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'ImportIQ-catalog/1.0 (vehicle make/model catalog build)';
const US_BASE = 'https://raw.githubusercontent.com/abhionlyone/us-car-models-data/master';
const US_YEARS = Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2010 + i); // 2010..2026
const CUTOFF_YEAR = 2010;

// EU-relevant marques. Sourced from the US dataset when present, else Wikidata.
const ALLOWLIST = [
  'Abarth', 'Alfa Romeo', 'Alpine', 'Aston Martin', 'Audi', 'Bentley', 'BMW',
  'Bugatti', 'BYD', 'Chevrolet', 'Citroën', 'Cupra', 'Dacia', 'DS Automobiles',
  'Ferrari', 'Fiat', 'Ford', 'Genesis', 'Honda', 'Hyundai', 'Jaguar', 'Jeep',
  'Kia', 'Lada', 'Lamborghini', 'Lancia', 'Land Rover', 'Lexus', 'Lotus',
  'Lynk & Co', 'Maserati', 'Maybach', 'Mazda', 'McLaren', 'Mercedes-Benz', 'MG',
  'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Polestar', 'Porsche',
  'Renault', 'Rolls-Royce', 'Saab', 'SEAT', 'Škoda', 'Smart', 'SsangYong',
  'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Vauxhall', 'Volkswagen', 'Volvo',
];

// Brands to ALWAYS source from Wikidata — either absent from the US dataset, or
// present only for years before they exited the US market (so the US list is
// stale for current EU models, e.g. Suzuki left the US in 2013).
const WIKIDATA_BRANDS = new Set([
  'Abarth', 'Alpine', 'BYD', 'Citroën', 'Cupra', 'Dacia', 'DS Automobiles',
  'Lada', 'Lancia', 'Lynk & Co', 'MG', 'Opel', 'Peugeot', 'Renault', 'Saab',
  'SEAT', 'Škoda', 'SsangYong', 'Suzuki', 'Vauxhall',
]);

// US dataset make spelling → our canonical ALLOWLIST name.
const US_NAME_MAP = {
  FIAT: 'Fiat', MAZDA: 'Mazda', MINI: 'Mini', smart: 'Smart',
  'Mercedes-Benz': 'Mercedes-Benz', 'Land Rover': 'Land Rover',
};

const CURATED = new Map(VEHICLE_CATALOG.map((c) => [norm(c.brand), c]));
const ALLOW_NORM = new Map(ALLOWLIST.map((b) => [norm(b), b]));

function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const yearOf = (v) => (v ? Number(String(v).slice(0, 4)) : null);
const qid = (uri) => uri.replace(/.*\/(Q\d+)$/, '$1');

async function sparql(query) {
  const url = `${SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return (await res.json()).results.bindings;
}

// --- Model-name cleanup (shared) --------------------------------------------
// Only strip multi-letter roman generation tails ("Jetta VI", "Golf VII") — never
// single letters, which are real model names ("Model X", "Model S", "Audi V8").
const ROMAN_TAIL = /\s+(?:ii|iii|iv|vi|vii|viii|ix)$/i;
// Pre-war / displacement-named historic noise found in Wikidata's deep history.
const HISTORIC = /\b(litre|liter)\b|\b\d+\s*(?:ps|hp)\b|^\d+\s*\/\s*\d+/i;

// Targeted noise patterns for Wikidata's deep historic/commercial entries that
// carry no usable production date (Renault is the worst offender): combined-model
// disambiguations ("9 and 11"), weight-class vans ("1 000 kg"), pre-war tax-HP
// names ("4CV"), internal chassis codes ("ACx"), and "number + trim" classics
// ("16 TS", "5 Turbo") — but NOT modern number revivals ("5 E-Tech", "4 E-Tech").
const WD_NOISE = [
  / and /i, /\bkg\b/i, /\b\d+\s*cv\b/i, /^[a-z]{1,3}x$/i,
  /^\d{1,2}\s+(?!e-?tech\b)/i, /^\d{1,2}$/,
];

function cleanModel(label, brandName, { strip = true, collapseGen = false } = {}) {
  if (!label || /^Q\d+$/.test(label)) return null;
  let m = label;
  if (strip) {
    m = m.replace(new RegExp(`^${escapeRe(brandName)}\\s+`, 'i'), '');
    const bn = brandName.split(/[\s-]/)[0];
    if (bn) m = m.replace(new RegExp(`^${escapeRe(bn)}\\s+`, 'i'), '');
  }
  m = m.replace(/\s*\([^)]*\)\s*/g, ' ');     // drop "(F30)" chassis codes
  m = m.replace(/\s+Mk\.?\s*\d+$/i, '');       // "Golf Mk7"
  if (ROMAN_TAIL.test(m) && m.trim().split(/\s+/).length > 1) m = m.replace(ROMAN_TAIL, '');
  // Collapse trailing single-letter generation codes ("Astra F", "Ascona C",
  // "Clio V") to the base model — for Wikidata sources only, where these are
  // per-generation items. (US/curated keep "Model X", "Model S" intact.)
  if (collapseGen && /\s+[A-Z]$/.test(m) && m.trim().split(/\s+/).length > 1) {
    m = m.replace(/\s+[A-Z]$/, '');
  }
  m = m.replace(/\s+/g, ' ').trim();
  return m && m.length >= 1 ? m : null;
}

// --- Source 1: US year-indexed dataset --------------------------------------
function parseCsvLine(line) {
  // Columns: year,make,model,body_styles — where body_styles is a quoted field
  // that varies by year: "[""Sedan""]", "" (empty), or absent. Strip that trailing
  // field (it may itself contain commas inside the quotes), then take the rest.
  const head = line.replace(/,(?:"(?:[^"]|"")*"|[^,]*)$/, '').split(',');
  if (head.length < 3 || !/^\d{4}$/.test(head[0])) return null;
  return { year: Number(head[0]), make: head[1].trim(), model: head.slice(2).join(',').trim() };
}

async function fetchUsModels() {
  const byBrand = new Map(); // canonical brand → Set(model)
  for (const year of US_YEARS) {
    const res = await fetch(`${US_BASE}/${year}.csv`, { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.warn(`  US ${year}: http ${res.status}, skipped`); continue; }
    const text = await res.text();
    let kept = 0;
    for (const line of text.split('\n').slice(1)) {
      const row = parseCsvLine(line);
      if (!row || row.year < CUTOFF_YEAR) continue;
      const canon = US_NAME_MAP[row.make] ?? ALLOW_NORM.get(norm(row.make));
      if (!canon || WIKIDATA_BRANDS.has(canon)) continue; // skip non-allowed + Wikidata-owned
      const name = cleanModel(row.model, canon, { strip: false });
      if (!name) continue;
      if (!byBrand.has(canon)) byBrand.set(canon, new Map());
      const mk = norm(name);
      if (!byBrand.get(canon).has(mk)) byBrand.get(canon).set(mk, name);
      kept++;
    }
    console.log(`  US ${year}: +${kept} model-rows`);
  }
  return byBrand;
}

// --- Source 2: Wikidata (European fill) -------------------------------------
// Resolve one brand name to the Wikidata entity that, among all items labelled
// (or aliased) with that name, owns the most car models. Requiring ≥1 car model
// rejects homonyms (films, people) without depending on how the brand entity
// itself is typed — which is inconsistent on Wikidata (e.g. Peugeot isn't a clean
// subclass of "automobile manufacturer").
async function resolveOne(name) {
  const lit = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const rows = await sparql(`
    SELECT ?brand (COUNT(DISTINCT ?m) AS ?n) WHERE {
      ?brand ?lp ?l .
      VALUES ?lp { rdfs:label skos:altLabel }
      FILTER(LANG(?l)="en" && (LCASE(STR(?l)) = LCASE("${lit}") || STRSTARTS(LCASE(STR(?l)), LCASE("${lit} "))))
      ?m wdt:P176 ?brand . ?m wdt:P31/wdt:P279* wd:Q3231690 .
    } GROUP BY ?brand ORDER BY DESC(?n) LIMIT 1`);
  return rows[0] ? { name, id: qid(rows[0].brand.value), models: Number(rows[0].n.value) } : null;
}

async function resolveBrandQids(names) {
  const settled = await Promise.all(names.map((n) => resolveOne(n).catch(() => null)));
  const resolved = settled.filter(Boolean);
  const missing = names.filter((n, i) => !settled[i]);
  if (missing.length) console.warn('  ⚠️  unresolved Wikidata brands:', missing.join(', '));
  return resolved;
}

async function fetchWikidataModels(brands) {
  const byBrand = new Map();
  const chunks = [];
  for (let i = 0; i < brands.length; i += 12) chunks.push(brands.slice(i, i + 12));
  for (const [i, chunk] of chunks.entries()) {
    const values = chunk.map((b) => `wd:${b.id}`).join(' ');
    const rows = await sparql(`
      SELECT ?brand ?modelLabel ?start ?disc WHERE {
        VALUES ?brand { ${values} }
        ?model wdt:P176 ?brand .
        ?model wdt:P31/wdt:P279* wd:Q3231690 .
        FILTER NOT EXISTS { ?model wdt:P31 wd:Q850270 }     # concept car
        FILTER NOT EXISTS { ?model wdt:P31 wd:Q10301427 }   # racing automobile
        OPTIONAL { ?model wdt:P571 ?start. }
        OPTIONAL { ?model wdt:P2669 ?disc. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`);
    const nameById = Object.fromEntries(chunk.map((b) => [b.id, b.name]));
    for (const r of rows) {
      const brand = nameById[qid(r.brand.value)];
      const start = yearOf(r.start?.value);
      const disc = yearOf(r.disc?.value);
      if (disc != null && disc < CUTOFF_YEAR) continue;          // discontinued pre-2010
      if (start != null && start < 2000 && disc == null) continue; // dated-historic
      const name = cleanModel(r.modelLabel?.value, brand, { collapseGen: true });
      if (!name || HISTORIC.test(name) || WD_NOISE.some((re) => re.test(name))) continue;
      // Drop ALL bare-numeric names — historic on Wikidata regardless of brand
      // (Peugeot 201–309, Škoda 120, Renault 16). Modern numeric models (Peugeot
      // 208/3008, Fiat 500) are supplied cleanly by the curated overlay instead.
      if (/^\d{2,4}$/.test(name)) continue;
      if (!byBrand.has(brand)) byBrand.set(brand, new Map());
      const mk = norm(name);
      if (!byBrand.get(brand).has(mk)) byBrand.get(brand).set(mk, name);
    }
    console.log(`  Wikidata chunk ${i + 1}/${chunks.length}: +${rows.length} rows`);
  }
  return byBrand;
}

// --- Assemble + overlay curated aliases/submodels ---------------------------
function assemble(usBrands, wdBrands) {
  const merged = new Map(); // canonical brand → Map(modelKey → name)
  for (const src of [usBrands, wdBrands]) {
    for (const [brand, models] of src) {
      if (!merged.has(brand)) merged.set(brand, new Map());
      for (const [mk, name] of models) if (!merged.get(brand).has(mk)) merged.get(brand).set(mk, name);
    }
  }
  // Merge the curated seed's models in fully — it carries EU-only models that the
  // US dataset omits (VW Polo/T-Roc/Touran, Ford Fiesta, Hyundai i30…) and the
  // submodels/trims + brand aliases the public sources don't provide.
  for (const c of VEHICLE_CATALOG) {
    if (!merged.has(c.brand)) merged.set(c.brand, new Map());
    for (const m of Object.keys(c.models)) {
      const mk = norm(m);
      if (mk && !merged.get(c.brand).has(mk)) merged.get(c.brand).set(mk, m);
    }
  }

  const catalog = [];
  for (const brand of [...merged.keys()].sort((a, b) => a.localeCompare(b))) {
    const curated = CURATED.get(norm(brand));
    const subByModel = new Map();
    if (curated) for (const [m, s] of Object.entries(curated.models)) subByModel.set(norm(m), s);
    const modelObj = {};
    for (const name of [...merged.get(brand).values()].sort((a, b) => a.localeCompare(b))) {
      modelObj[name] = subByModel.get(norm(name)) ?? [];
    }
    catalog.push({ brand, aliases: curated?.aliases ?? [], models: modelObj });
  }
  return catalog;
}

async function main() {
  console.log('Building vehicle catalog (US dataset + Wikidata)…');
  console.log('Source 1 — US year-indexed dataset (2010+):');
  const usBrands = await fetchUsModels();
  console.log(`  → ${usBrands.size} brands from US data.`);

  console.log('Source 2 — Wikidata (European fill):');
  const resolved = await resolveBrandQids([...WIKIDATA_BRANDS]);
  console.log(`  resolved ${resolved.length}/${WIKIDATA_BRANDS.size} brands to QIDs.`);
  const wdBrands = await fetchWikidataModels(resolved);
  console.log(`  → ${wdBrands.size} brands from Wikidata.`);

  const catalog = assemble(usBrands, wdBrands);
  const totalModels = catalog.reduce((n, b) => n + Object.keys(b.models).length, 0);
  writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`\n✓ Wrote ${catalog.length} brands / ${totalModels} models → ${OUT}`);
  for (const b of catalog.filter((c) => ['Opel', 'Peugeot', 'Renault', 'BMW', 'Tesla'].includes(c.brand))) {
    console.log(`  ${b.brand} (${Object.keys(b.models).length}): ${Object.keys(b.models).slice(0, 14).join(', ')}…`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
