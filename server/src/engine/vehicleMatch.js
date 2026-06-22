// Fuzzy vehicle matcher (pure, no I/O).
//
// Resolves a free-text input — "mercedez benz c220 amg", "vw gold gti 2019",
// "bmw 320d touring" — to the best brand + model (+ best submodel) in the
// catalog. It always returns the closest matches it can find; it never requires
// an exact hit. Non-matching/noise words (year, fuel, mileage, junk) are simply
// ignored because they fail to align with any catalogue token.
//
// Algorithm, per catalogue entry (one brand+model):
//   score = BRAND_WEIGHT*brandScore + MODEL_WEIGHT*modelScore (+ small submodel bonus)
// where each field score is token-coverage: every field token finds its most
// similar query token (length-weighted average), with brand aliases short-circuiting
// to a perfect brand score. Similarity is Sørensen–Dice on character bigrams plus
// prefix/containment handling — robust to typos ("mercedez"≈"mercedes") and partial
// model designations ("320d"≈"320").

const BRAND_WEIGHT = 0.5;
const MODEL_WEIGHT = 0.5;
const SUBMODEL_ID_WEIGHT = 0.85; // how much a submodel hit counts toward model identity
const COVERAGE_WEIGHT = 0.2; // how much explaining more of the query nudges the score

// Confidence buckets for the UI — purely presentational.
const CONFIDENCE = [
  { min: 0.8, label: 'high' },
  { min: 0.55, label: 'medium' },
  { min: 0.0, label: 'low' },
];

/** Lowercase, strip diacritics, and split into alphanumeric tokens. */
export function tokenize(input) {
  return normalizeStr(input)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

/** Lowercase + diacritic-fold a string (keeps original separators). */
export function normalizeStr(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // drop combining accents
    .toLowerCase()
    .trim();
}

/** Character-bigram set for the Dice coefficient. */
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. */
export function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let overlap = 0;
  for (const [g, count] of aGrams) {
    const bc = bGrams.get(g);
    if (bc) overlap += Math.min(count, bc);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/**
 * Similarity between two single tokens, 0..1. Layers exact match, prefix and
 * containment bonuses (so "320d"≈"320", "amg"≈"amgline") over the Dice base.
 */
export function tokenSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 2 && long.startsWith(short)) {
    return 0.82 + 0.18 * (short.length / long.length);
  }
  if (short.length >= 3 && long.includes(short)) {
    return 0.7 + 0.2 * (short.length / long.length);
  }
  const dice = diceCoefficient(a, b);
  if (short.length < 2) {
    // Single-char tokens get no bigrams; reward a containment instead.
    return long.includes(short) ? Math.max(dice, 0.3) : dice;
  }
  return dice;
}

/**
 * Coverage of a multi-token field by the query: each field token takes its best
 * similarity to any query token, length-weighted so "3 series" needs both "3"
 * and "series" to score well. Returns { score, matchedTokens }.
 */
function fieldCoverage(fieldTokens, queryTokens) {
  if (!fieldTokens.length) return { score: 0, matched: [] };
  let weighted = 0;
  let weightSum = 0;
  const matched = new Set();
  for (const ft of fieldTokens) {
    let best = 0;
    let bestQt = null;
    for (const qt of queryTokens) {
      const s = tokenSim(ft, qt);
      if (s > best) {
        best = s;
        bestQt = qt;
      }
    }
    const w = Math.max(1, ft.length);
    weighted += best * w;
    weightSum += w;
    if (best >= 0.6 && bestQt) matched.add(bestQt);
  }
  return { score: weighted / weightSum, matched: [...matched] };
}

/**
 * Build the flat, pre-tokenized index the matcher scans. Accepts the catalog
 * shape (array of { brand, aliases?, models }). Returns { entries, brandAliases }.
 * Call once and reuse — tokenization is the per-entry cost.
 */
export function buildVehicleIndex(catalog) {
  const entries = [];
  const brandAliases = new Map(); // normalized alias → brand display name

  for (const { brand, aliases = [], models = {} } of catalog) {
    const brandTokens = tokenize(brand);
    const aliasNorms = [normalizeStr(brand), ...aliases.map(normalizeStr)];
    for (const a of aliasNorms) brandAliases.set(a, brand);

    for (const [model, submodels] of Object.entries(models)) {
      entries.push({
        brand,
        model,
        submodels: submodels ?? [],
        brandTokens,
        aliasNorms,
        modelTokens: tokenize(model),
        submodelTokens: (submodels ?? []).map((s) => ({ label: s, tokens: tokenize(s) })),
      });
    }
  }
  return { entries, brandAliases };
}

/** Best brand score: alias hit (perfect) else token coverage. */
function brandScore(entry, queryTokens, normQuery) {
  // A whole-alias hit anywhere in the query is a definitive brand signal.
  for (const alias of entry.aliasNorms) {
    if (!alias) continue;
    if (alias.includes(' ') ? normQuery.includes(alias) : queryTokens.includes(alias)) {
      return { score: 1, matched: tokenize(alias) };
    }
  }
  return fieldCoverage(entry.brandTokens, queryTokens);
}

/** Best submodel for an entry given the query tokens, or null. */
function bestSubmodel(entry, queryTokens) {
  let best = null;
  for (const sm of entry.submodelTokens) {
    if (!sm.tokens.length) continue;
    const { score, matched } = fieldCoverage(sm.tokens, queryTokens);
    if (!best || score > best.score) best = { label: sm.label, score, matched };
  }
  return best && best.score >= 0.5 ? best : null;
}

function confidenceLabel(score) {
  return CONFIDENCE.find((c) => score >= c.min).label;
}

/**
 * Rank catalogue entries against a free-text query. Returns up to `limit`
 * candidates, best first, each: { brand, model, submodel, score (0..1),
 * confidence, breakdown: { brand, model, submodel } }.
 *
 * @param {string} query
 * @param {{entries:object[],brandAliases:Map}} index  from buildVehicleIndex()
 * @param {{limit?:number}} [opts]
 */
export function matchVehicle(query, index, opts = {}) {
  const limit = opts.limit ?? 5;
  const normQuery = normalizeStr(query);
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const scored = index.entries.map((entry) => {
    const b = brandScore(entry, queryTokens, normQuery);
    // Score the model over the tokens the brand DIDN'T already consume, so a brand
    // word inside a model name ("Mercedes-AMG GT") can't double-count the brand.
    const brandMatched = new Set(b.matched);
    const rest = queryTokens.filter((t) => !brandMatched.has(t));
    const m = fieldCoverage(entry.modelTokens, rest);
    const sub = bestSubmodel(entry, rest);
    // A strong submodel hit ("320d", "C 220 d") identifies the model too, so fold
    // it into model identity rather than treating it as a small additive bonus.
    const modelId = Math.max(m.score, sub ? SUBMODEL_ID_WEIGHT * sub.score : 0);
    const base = BRAND_WEIGHT * b.score + MODEL_WEIGHT * modelId;
    // Query coverage: prefer the candidate that explains MORE of the input, so
    // "vw polo gti" beats bare "GTI" (Polo+GTI covers polo & gti; GTI leaves polo).
    const covered = new Set([...b.matched, ...m.matched, ...(sub?.matched ?? [])]);
    const coverage = covered.size / queryTokens.length;
    const score = base * (1 - COVERAGE_WEIGHT + COVERAGE_WEIGHT * coverage);
    return {
      brand: entry.brand,
      model: entry.model,
      submodel: sub?.label ?? null,
      score,
      confidence: confidenceLabel(score),
      breakdown: {
        brand: round(b.score),
        model: round(modelId),
        submodel: sub ? round(sub.score) : null,
        coverage: round(coverage),
      },
    };
  });

  scored.sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand));
  return scored.slice(0, limit).map((s) => ({ ...s, score: round(s.score) }));
}

const round = (n) => Math.round(n * 1000) / 1000;
