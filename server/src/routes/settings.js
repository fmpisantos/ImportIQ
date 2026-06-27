// Runtime settings API — lets the Settings UI configure the data source and
// credentials without editing .env or restarting the server.
//
//   GET  /api/settings        → effective settings (secrets masked) + provenance
//   PUT  /api/settings        → write overrides (and/or clear named overrides)
//   POST /api/settings/test   → probe connectivity for the active data source
//
// Overrides are stored as `runtime.*` rows in active_settings; config.js layers
// them over env/defaults on every request (see config.js `rt()`).

import { Router } from 'express';
import { getRuntimeSettings, setActiveSetting, getDb, clearSearchCaches } from '../db.js';
import { getDataSource, getApifyConfig, getMobiledeConfig } from '../config.js';
import { mobiledeAccess } from '../adapters/directSearch.js';

const router = Router();

// Field catalogue: which runtime keys exist, their env fallback, defaults, and
// whether the value is a secret (masked in GET, never echoed back).
const FIELDS = [
  { key: 'data_source', env: 'DATA_SOURCE', default: 'mock' },
  { key: 'direct_max_results', env: 'DIRECT_MAX_RESULTS', default: '60' },
  { key: 'apify_token', env: 'APIFY_TOKEN', secret: true },
  { key: 'apify_sites', env: 'APIFY_SITES', default: 'mobilede,autoscout24,autouncle' },
  { key: 'apify_max_per_site', env: 'APIFY_MAX_PER_SITE', default: '50' },
  { key: 'apify_use_proxy', env: 'APIFY_USE_PROXY', default: 'true' },
  { key: 'mobilede_user', env: 'MOBILEDE_USER' },
  { key: 'mobilede_pass', env: 'MOBILEDE_PASS', secret: true },
  { key: 'pt_provider', env: 'PT_PROVIDER', default: 'olx' },
  { key: 'olx_api_key', env: 'OLX_API_KEY', secret: true },
  { key: 'standvirtual_token', env: 'STANDVIRTUAL_TOKEN', secret: true },
];
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

const VALID_SITES = ['mobilede', 'autoscout24', 'autouncle'];
const VALID_SOURCES = ['mock', 'direct', 'official', 'apify'];
const VALID_PROVIDERS = ['olx', 'standvirtual'];
const BOOLISH = /^(1|0|true|false|yes|no)$/i;

// Build the GET view: effective value + where it came from. Secrets never leave
// the server — only a `set` flag and a short masked hint.
function describe() {
  const overrides = getRuntimeSettings();
  const fields = {};
  for (const f of FIELDS) {
    const hasOverride = overrides[f.key] != null && overrides[f.key] !== '';
    const envVal = process.env[f.env];
    const hasEnv = envVal != null && envVal !== '';
    const effective = hasOverride ? overrides[f.key] : hasEnv ? envVal : f.default ?? '';
    const source = hasOverride ? 'override' : hasEnv ? 'env' : f.default != null ? 'default' : 'unset';

    if (f.secret) {
      const set = effective !== '';
      fields[f.key] = {
        secret: true,
        set,
        hint: set ? `••••${String(effective).slice(-4)}` : '',
        source: set ? source : 'unset',
      };
    } else {
      fields[f.key] = { value: effective, source };
    }
  }
  return { dataSource: getDataSource(), fields };
}

router.get('/', (req, res) => {
  res.json(describe());
});

// Validate a single field's incoming value. Returns an error string or null.
function validate(key, value) {
  const v = String(value);
  switch (key) {
    case 'data_source':
      return VALID_SOURCES.includes(v.toLowerCase()) ? null : `data_source must be one of ${VALID_SOURCES.join(', ')}`;
    case 'pt_provider':
      return VALID_PROVIDERS.includes(v.toLowerCase()) ? null : `pt_provider must be one of ${VALID_PROVIDERS.join(', ')}`;
    case 'apify_max_per_site':
      return Number.isFinite(Number(v)) && Number(v) > 0 ? null : 'apify_max_per_site must be a positive number';
    case 'direct_max_results':
      return Number.isFinite(Number(v)) && Number(v) > 0 ? null : 'direct_max_results must be a positive number';
    case 'apify_use_proxy':
      return BOOLISH.test(v) ? null : 'apify_use_proxy must be a boolean';
    case 'apify_sites': {
      const sites = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (!sites.length) return 'apify_sites must list at least one site';
      const bad = sites.filter((s) => !VALID_SITES.includes(s));
      return bad.length ? `Unknown site(s): ${bad.join(', ')}` : null;
    }
    default:
      return null; // free-text credentials / usernames
  }
}

router.put('/', (req, res) => {
  const body = req.body ?? {};
  const updates = body.updates ?? {};
  const clear = Array.isArray(body.clear) ? body.clear : [];

  // Validate every incoming key first — write nothing on any error.
  for (const [key, value] of Object.entries(updates)) {
    if (!FIELD_BY_KEY[key]) return res.status(400).json({ error: `Unknown setting: ${key}` });
    // Blank secret = "leave unchanged"; never overwrite a stored secret with ''.
    if (FIELD_BY_KEY[key].secret && (value == null || value === '')) continue;
    const err = validate(key, value);
    if (err) return res.status(400).json({ error: err });
  }
  for (const key of clear) {
    if (!FIELD_BY_KEY[key]) return res.status(400).json({ error: `Unknown setting: ${key}` });
  }

  // Apply.
  for (const [key, value] of Object.entries(updates)) {
    if (FIELD_BY_KEY[key].secret && (value == null || value === '')) continue;
    setActiveSetting(`runtime.${key}`, String(value));
  }
  for (const key of clear) {
    getDb().prepare('DELETE FROM active_settings WHERE key = ?').run(`runtime.${key}`);
  }

  res.json(describe());
});

// --- Cache management ------------------------------------------------------
// Flush the scrape/search caches so the next search re-fetches live. Useful when
// results look stale ("same cars") or after changing filters/source.
router.post('/clear-cache', (req, res) => {
  const cleared = clearSearchCaches();
  const total = Object.values(cleared).reduce((a, b) => a + b, 0);
  res.json({ ok: true, cleared, total });
});

// --- Connection test -------------------------------------------------------
// Probes the *active* data source so the user can confirm a full flow is wired
// before running a real search.
router.post('/test', async (req, res) => {
  const source = getDataSource();
  try {
    if (source === 'mock') {
      return res.json({ ok: true, source, message: 'Mock mode — sample data, no credentials needed. Full flow works offline.' });
    }
    if (source === 'apify') {
      const { token } = getApifyConfig();
      if (!token) return res.status(400).json({ ok: false, source, error: 'No Apify token set. Add one above and save first.' });
      const result = await timed(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`);
      if (!result.ok) {
        return res.status(400).json({ ok: false, source, error: `Apify rejected the token (HTTP ${result.status}). Check it's valid.` });
      }
      const username = result.body?.data?.username ?? 'unknown';
      return res.json({ ok: true, source, message: `Apify token valid — authenticated as “${username}”.` });
    }
    if (source === 'direct') {
      // No credentials to validate — probe that both sites answer from this
      // network: an AutoScout24 search page with embedded JSON, and OLX.pt's
      // public offers API.
      const ua = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' };
      const [as24, olx] = await Promise.all([
        timedText('https://www.autoscout24.de/lst?atype=C&cy=D&page=1', ua),
        timed('https://www.olx.pt/api/v1/offers/?category_id=378&limit=1', { ...ua, Accept: 'application/json' }),
      ]);
      const as24Ok = as24.ok && as24.body.includes('__NEXT_DATA__');
      const olxOk = olx.ok && Array.isArray(olx.body?.data);
      if (!as24Ok || !olxOk) {
        const broken = [!as24Ok && `AutoScout24 (HTTP ${as24.status})`, !olxOk && `OLX.pt (HTTP ${olx.status})`]
          .filter(Boolean)
          .join(' and ');
        return res.status(400).json({ ok: false, source, error: `Direct scraping probe failed for ${broken}. The site may be blocking this network — try again or switch source.` });
      }

      // mobile.de joins the search only when a key for it is saved — validate
      // whichever one would be used so a bad key surfaces here, not mid-search.
      const access = mobiledeAccess();
      let mobiledeStatus = 'mobile.de skipped — no dealer login or Apify token saved.';
      if (access === 'official') {
        const { username, password, baseUrl } = getMobiledeConfig();
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        const probe = await timed(`${baseUrl}/refdata/classes/Car/makes`, {
          Authorization: `Basic ${auth}`,
          Accept: 'application/vnd.de.mobile.api+json',
        });
        if (!probe.ok) {
          return res.status(400).json({ ok: false, source, error: `mobile.de dealer credentials are saved but rejected (HTTP ${probe.status}). Fix or clear them.` });
        }
        mobiledeStatus = 'mobile.de included via the official dealer API.';
      } else if (access === 'apify') {
        const { token } = getApifyConfig();
        const probe = await timed(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`);
        if (!probe.ok) {
          return res.status(400).json({ ok: false, source, error: `An Apify token is saved but rejected (HTTP ${probe.status}). Fix or clear it.` });
        }
        mobiledeStatus = `mobile.de included via Apify (authenticated as “${probe.body?.data?.username ?? 'unknown'}”, pay-per-result).`;
      }

      return res.json({ ok: true, source, message: `Direct scraping reachable — AutoScout24 (listings) and OLX.pt (PT comparison) both answered. ${mobiledeStatus}` });
    }
    if (source === 'official') {
      const { username, password, baseUrl } = getMobiledeConfig();
      if (!username || !password) {
        return res.status(400).json({ ok: false, source, error: 'mobile.de username/password not set.' });
      }
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      const result = await timed(`${baseUrl}/refdata/classes/Car/makes`, {
        Authorization: `Basic ${auth}`,
        Accept: 'application/vnd.de.mobile.api+json',
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, source, error: `mobile.de returned HTTP ${result.status}. Check credentials / API access.` });
      }
      return res.json({ ok: true, source, message: 'mobile.de credentials accepted.' });
    }
    return res.status(400).json({ ok: false, source, error: `Unknown data source: ${source}` });
  } catch (err) {
    return res.status(502).json({ ok: false, source, error: err.message ?? 'Connection test failed' });
  }
});

// GET with a 10s timeout; returns { ok, status, body? }.
async function timed(url, headers, parse = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const body =
      parse === 'text'
        ? await res.text().catch(() => '')
        : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Connection test timed out after 10s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const timedText = (url, headers) => timed(url, headers, 'text');

export default router;
