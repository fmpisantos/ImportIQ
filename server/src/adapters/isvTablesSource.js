// Best-effort scraper + validator for the statutory ISV environmental tables.
//
// There is no official government API: the OE tables are published in law and
// republished by simulator/reference sites. This module fetches several such
// pages, parses the gasolina/gasóleo × WLTP/NEDC brackets out of each, and then
// — crucially — only accepts a table when at least two independent sources agree
// AND it passes structural validation. Anything else is rejected and the caller
// keeps the hardcoded baseline. The parser is intentionally tolerant/brittle;
// the agreement guardrail in validateAndMerge() is what makes that safe.

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml',
};

const FUEL_STANDARD_KEYS = ['gasoline.WLTP', 'gasoline.NEDC', 'diesel.WLTP', 'diesel.NEDC'];

// --- number + text parsing --------------------------------------------------

/**
 * Parse a Portuguese- or English-formatted decimal string into a Number.
 * Handles "1.906,19", "7,360.85", "11,50", "1,72", "500". Returns NaN if no
 * digits are present.
 */
export function parsePtNumber(raw) {
  const cleaned = String(raw).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return NaN;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalised;
  if (lastComma !== -1 && lastDot !== -1) {
    // Both separators present — the rightmost is the decimal point.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    normalised = cleaned.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const after = cleaned.slice(cleaned.lastIndexOf(sep) + 1);
    // 3 digits after a lone separator ⇒ thousands grouping (e.g. "1.906");
    // 1–2 digits ⇒ decimal (e.g. "11,50", "1,72").
    if (after.length === 3) normalised = cleaned.split(sep).join('');
    else normalised = cleaned.replace(sep, '.');
  } else {
    normalised = cleaned;
  }
  return Number(normalised);
}

/** Derive a bracket `max` from a CO₂ range descriptor like "80 a 95" / "Até 79" / "Mais de 160". */
export function parseBracketMax(rangeText) {
  const t = String(rangeText).toLowerCase();
  if (/(mais de|acima|superior|>|\+|maior)/.test(t)) return Infinity;
  const nums = (t.match(/\d+/g) || []).map(Number);
  if (nums.length === 0) return null;
  // "até N" → N; a range "A a B" → B (the upper bound). Either way: the largest.
  return Math.max(...nums);
}

/**
 * Convert raw HTML to text lines, one per table row, with cells joined by ' | '.
 * Closing cell tags become a cell separator (so a row stays on one line); row /
 * block boundaries become newlines. This lets the row parser treat the first
 * cell as the CO₂ range and the rest as figures.
 */
function htmlToLines(html) {
  return String(html)
    // Neutralise the source's own newlines/tabs FIRST so cells split only on the
    // structural boundaries we insert below — otherwise `<td>5,78</td>\r\n<td>…`
    // puts every cell on its own line and rows never form.
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/<\s*\/(td|th)\s*>/gi, ' | ') // cell boundary — keep the row intact
    .replace(/<\s*(br|tr|\/tr|\/p|p|\/h[1-6]|\/li|li|\/table|table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Parse the environmental tables out of one page's HTML. Returns a partial
 * `{ 'fuel.STANDARD': brackets[] }` map containing only the tables it could
 * confidently extract. Never throws — unparseable input yields {}.
 */
export function parseIsvTablesFromHtml(html) {
  const lines = htmlToLines(html);
  const out = {};
  // A fuel.standard table is "closed" once we have seen its `Mais de …`
  // (Infinity) catch-all row — a valid ISV bracket list ends there. Without
  // this, rows from following tables (cylinder, age-reduction %, IVA variants)
  // bleed into the section and corrupt it. Closing on the catch-all bounds each
  // table to its real extent, in document order, before any sorting.
  const closed = new Set();
  let fuel = null;
  let standard = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Update the active section context from any heading-ish line.
    if (/gas[oó]leo|diesel/.test(lower)) fuel = 'diesel';
    else if (/gasolina|gasoline|petrol/.test(lower)) fuel = 'gasoline';
    if (/wltp/.test(lower)) standard = 'WLTP';
    else if (/nedc/.test(lower)) standard = 'NEDC';

    if (!line.includes('|') || !fuel || !standard) continue; // only table rows in a known section

    const key = `${fuel}.${standard}`;
    if (closed.has(key)) continue; // already captured a complete table for this key

    // First cell is the CO₂ range; remaining numeric cells are rate + deduction.
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;

    const max = parseBracketMax(cells[0]);
    if (max === null) continue;

    const values = cells
      .slice(1)
      .map(parsePtNumber)
      .filter((n) => Number.isFinite(n));
    if (values.length < 2) continue;
    const [ratePerGkm, deduction] = values;
    if (!(ratePerGkm > 0)) continue;

    if (!out[key]) out[key] = [];
    out[key].push({ max, ratePerGkm, deduction });
    if (max === Infinity) closed.add(key); // catch-all reached → table complete
  }

  // Keep brackets in ascending `max` order (Infinity last).
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => a.max - b.max);
  }
  return out;
}

// --- fetching ---------------------------------------------------------------

async function fetchPage(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ISV table fetch failed (${res.status}) for ${url}`);
  return res.text();
}

/**
 * Fetch + parse every configured source. Returns one entry per URL:
 *   { url, tables } on success, { url, error } on failure. Never throws.
 */
export async function fetchIsvTables({ sourceUrls, fetchImpl = fetch } = {}) {
  const urls = sourceUrls || [];
  return Promise.all(
    urls.map(async (url) => {
      try {
        const html = await fetchPage(url, fetchImpl);
        return { url, tables: parseIsvTablesFromHtml(html) };
      } catch (err) {
        return { url, error: String(err?.message || err) };
      }
    })
  );
}

// --- validation + merge -----------------------------------------------------

const sameBrackets = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.max === b[i].max && x.ratePerGkm === b[i].ratePerGkm && x.deduction === b[i].deduction
  );

/** Structural sanity: ascending non-overlapping brackets, Infinity catch-all, positive rates. */
function isStructurallyValid(brackets) {
  if (!Array.isArray(brackets) || brackets.length === 0) return false;
  const last = brackets[brackets.length - 1];
  if (last.max !== Infinity) return false;
  let prevMax = -Infinity;
  for (const b of brackets) {
    if (typeof b.ratePerGkm !== 'number' || b.ratePerGkm <= 0) return false;
    if (typeof b.deduction !== 'number' || b.deduction < 0) return false;
    if (typeof b.max !== 'number' || b.max <= prevMax) return false; // strictly ascending
    prevMax = b.max;
  }
  return true;
}

// Evaluate a CO₂ value against a bracket array (mirrors the engine's lookup).
function envAt(brackets, co2) {
  const b = brackets.find((x) => co2 <= x.max) ?? brackets[brackets.length - 1];
  return co2 * b.ratePerGkm - b.deduction;
}

/**
 * Merge freshly-fetched tables over a baseline, accepting a key only when ≥2
 * sources agree exactly and it is structurally valid. Returns:
 *   { environmental, accepted: string[], changed: boolean, flags: string[] }
 * `environmental` is always a complete, safe table set (baseline for any key not
 * accepted). `flags` explains every rejection for human review.
 */
export function validateAndMerge(perSource, baseline) {
  const merged = { ...baseline };
  const accepted = [];
  const flags = [];

  for (const entry of perSource) {
    if (entry.error) flags.push(`source ${entry.url}: fetch/parse error — ${entry.error}`);
  }

  for (const key of FUEL_STANDARD_KEYS) {
    const candidates = perSource
      .filter((s) => s.tables && Array.isArray(s.tables[key]))
      .map((s) => ({ url: s.url, brackets: s.tables[key] }));

    if (candidates.length < 2) {
      if (candidates.length === 1) flags.push(`${key}: only one source parsed it — not accepted`);
      continue; // keep baseline silently when nobody parsed it
    }

    // Find a value shared by ≥2 sources.
    let agreed = null;
    for (let i = 0; i < candidates.length; i++) {
      const matches = candidates.filter((c) => sameBrackets(c.brackets, candidates[i].brackets));
      if (matches.length >= 2) {
        agreed = candidates[i].brackets;
        break;
      }
    }

    if (!agreed) {
      flags.push(`${key}: sources disagree — not accepted`);
      continue;
    }
    if (!isStructurallyValid(agreed)) {
      flags.push(`${key}: agreed value failed structural validation — not accepted`);
      continue;
    }

    merged[key] = agreed;
    accepted.push(key);
  }

  // Cross-fuel sanity: diesel must cost at least as much as gasoline at a few
  // representative CO₂ points. If not, something is wrong — drop the diesel keys.
  for (const standard of ['WLTP', 'NEDC']) {
    const g = merged[`gasoline.${standard}`];
    const d = merged[`diesel.${standard}`];
    if (!g || !d) continue;
    const breached = [90, 130, 170].some((co2) => envAt(d, co2) + 1e-6 < envAt(g, co2));
    if (breached && accepted.includes(`diesel.${standard}`)) {
      flags.push(`diesel.${standard}: rejected — computed below gasoline at a sample CO₂ point`);
      merged[`diesel.${standard}`] = baseline[`diesel.${standard}`];
      const idx = accepted.indexOf(`diesel.${standard}`);
      if (idx !== -1) accepted.splice(idx, 1);
    }
  }

  const changed = FUEL_STANDARD_KEYS.some((key) => !sameBrackets(merged[key], baseline[key]));
  return { environmental: merged, accepted, changed, flags };
}
