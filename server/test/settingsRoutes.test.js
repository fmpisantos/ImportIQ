// Tests for the runtime settings API (routes/settings.js) and the config
// override layer it feeds (config.js rt()). Runs against a real express
// listener and a throwaway SQLite file — no network: the /test probes stub
// the process-global fetch, passing through only calls to the local server.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the SQLite store at a throwaway file BEFORE db.js loads — DB_PATH is
// resolved at module load. Likewise drop any env that would shadow defaults.
process.env.IMPORTIQ_DB = join(mkdtempSync(join(tmpdir(), 'importiq-settings-')), 'test.db');
for (const key of [
  'DATA_SOURCE',
  'APIFY_TOKEN',
  'APIFY_SITES',
  'APIFY_MAX_PER_SITE',
  'APIFY_USE_PROXY',
  'MOBILEDE_USER',
  'MOBILEDE_PASS',
  'PT_PROVIDER',
  'OLX_API_KEY',
  'STANDVIRTUAL_TOKEN',
  'DIRECT_MAX_RESULTS',
]) {
  delete process.env[key];
}

const { default: express } = await import('express');
const { default: settingsRouter } = await import('../src/routes/settings.js');
const { getDb } = await import('../src/db.js');
const { getDataSource } = await import('../src/config.js');

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/settings`;
});

after(() => server.close());

// Every test starts from a clean override state.
beforeEach(() => {
  getDb().prepare("DELETE FROM active_settings WHERE key LIKE 'runtime.%'").run();
});

const getSettings = async () => (await fetch(base)).json();
const put = (body) =>
  fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const overrideRows = () =>
  getDb().prepare("SELECT key, value FROM active_settings WHERE key LIKE 'runtime.%'").all();

// --- GET: effective values, provenance, masking ------------------------------

test('GET returns defaults with correct provenance when nothing is set', async () => {
  const body = await getSettings();
  assert.equal(body.dataSource, 'mock');
  assert.deepEqual(body.fields.data_source, { value: 'mock', source: 'default' });
  assert.deepEqual(body.fields.direct_max_results, { value: '60', source: 'default' });
  assert.deepEqual(body.fields.apify_token, { secret: true, set: false, hint: '', source: 'unset' });
  assert.deepEqual(body.fields.mobilede_user, { value: '', source: 'unset' });
});

test('GET masks stored secrets — raw value never appears in the response', async () => {
  const secret = 'apify_api_supersecret1234';
  const res = await put({ updates: { apify_token: secret } });
  assert.equal(res.status, 200);
  assert.ok(!JSON.stringify(await res.json()).includes(secret), 'PUT response leaked the secret');

  const body = await getSettings();
  assert.ok(!JSON.stringify(body).includes(secret), 'GET response leaked the secret');
  assert.equal(body.fields.apify_token.set, true);
  assert.equal(body.fields.apify_token.hint, '••••1234');
  assert.equal(body.fields.apify_token.source, 'override');
});

// --- PUT: persistence, blank-secret no-op, clear -----------------------------

test('PUT persists overrides as runtime.* rows and they take effect', async () => {
  const res = await put({ updates: { data_source: 'direct', direct_max_results: '40' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.fields.data_source, { value: 'direct', source: 'override' });
  assert.equal(getDataSource(), 'direct');
  assert.deepEqual(
    overrideRows().map((r) => r.key).sort(),
    ['runtime.data_source', 'runtime.direct_max_results']
  );
});

test('PUT with a blank secret leaves the stored secret untouched', async () => {
  await put({ updates: { apify_token: 'tok_original_9999' } });
  await put({ updates: { apify_token: '' } });
  const body = await getSettings();
  assert.equal(body.fields.apify_token.set, true);
  assert.equal(body.fields.apify_token.hint, '••••9999');
});

test('PUT clear deletes overrides and falls back to the default', async () => {
  await put({ updates: { data_source: 'direct', apify_token: 'tok_to_clear_1' } });
  const res = await put({ clear: ['data_source', 'apify_token'] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fields.data_source.value, 'mock');
  assert.equal(body.fields.data_source.source, 'default');
  assert.equal(body.fields.apify_token.set, false);
  assert.equal(overrideRows().length, 0);
});

// --- Validation: 400 and nothing written --------------------------------------

const REJECTED = [
  ['unknown data_source', { data_source: 'scrapyard' }],
  ['unknown pt_provider', { pt_provider: 'ebay' }],
  ['zero apify_max_per_site', { apify_max_per_site: '0' }],
  ['non-numeric apify_max_per_site', { apify_max_per_site: 'lots' }],
  ['non-boolean apify_use_proxy', { apify_use_proxy: 'maybe' }],
  ['unknown apify site', { apify_sites: 'mobilede,ebaymotors' }],
  ['empty apify_sites', { apify_sites: ' , ' }],
  ['non-positive direct_max_results', { direct_max_results: '-5' }],
  ['unknown setting key', { not_a_setting: 'x' }],
];

for (const [label, updates] of REJECTED) {
  test(`PUT rejects ${label} with 400 and writes nothing`, async () => {
    const res = await put({ updates });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
    assert.equal(overrideRows().length, 0);
  });
}

test('PUT is atomic — one invalid field rejects the whole batch', async () => {
  const res = await put({ updates: { mobilede_user: 'dealer1', data_source: 'scrapyard' } });
  assert.equal(res.status, 400);
  assert.equal(overrideRows().length, 0, 'valid sibling field must not be written');
});

test('PUT rejects clearing an unknown key', async () => {
  const res = await put({ clear: ['not_a_setting'] });
  assert.equal(res.status, 400);
});

// --- Override precedence: override → env → default ----------------------------

test('data_source resolves override over env over default', async () => {
  try {
    process.env.DATA_SOURCE = 'official';
    assert.equal(getDataSource(), 'official');
    assert.equal((await getSettings()).fields.data_source.source, 'env');

    await put({ updates: { data_source: 'direct' } });
    assert.equal(getDataSource(), 'direct');
    assert.equal((await getSettings()).fields.data_source.source, 'override');

    await put({ clear: ['data_source'] });
    assert.equal(getDataSource(), 'official'); // back to env

    delete process.env.DATA_SOURCE;
    assert.equal(getDataSource(), 'mock'); // back to default
  } finally {
    delete process.env.DATA_SOURCE;
  }
});

// --- POST /test: offline probes ------------------------------------------------

// The /test probes use the process-global fetch — same one this test file uses
// to reach the local server. Pass localhost through, fake the external hosts.
async function withFakeExternalFetch(responses, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    for (const [needle, make] of responses) {
      if (u.includes(needle)) return make();
    }
    throw new Error(`unexpected external fetch in test: ${u}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const testConnection = async () => {
  const res = await fetch(`${base}/test`, { method: 'POST' });
  return { status: res.status, body: await res.json() };
};

test('POST /test in mock mode passes without any network', async () => {
  const { status, body } = await testConnection();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /mock/i);
});

test('POST /test in direct mode reports mobile.de skipped when no key is saved', async () => {
  await put({ updates: { data_source: 'direct' } });
  const { status, body } = await withFakeExternalFetch(
    [
      ['autoscout24.de', () => new Response('<html><script id="__NEXT_DATA__">{}</script>', { status: 200 })],
      ['olx.pt', () => Response.json({ data: [] })],
    ],
    testConnection
  );
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /mobile\.de skipped/);
});

test('POST /test in direct mode fails clearly when a saved Apify token is rejected', async () => {
  await put({ updates: { data_source: 'direct', apify_token: 'tok_bogus_0000' } });
  const { status, body } = await withFakeExternalFetch(
    [
      ['autoscout24.de', () => new Response('<html><script id="__NEXT_DATA__">{}</script>', { status: 200 })],
      ['olx.pt', () => Response.json({ data: [] })],
      ['api.apify.com', () => Response.json({ error: 'auth' }, { status: 401 })],
    ],
    testConnection
  );
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /token .* rejected/i);
});

test('POST /test in direct mode fails when AutoScout24 is blocked', async () => {
  await put({ updates: { data_source: 'direct' } });
  const { status, body } = await withFakeExternalFetch(
    [
      ['autoscout24.de', () => new Response('Access denied', { status: 403 })],
      ['olx.pt', () => Response.json({ data: [] })],
    ],
    testConnection
  );
  assert.equal(status, 400);
  assert.match(body.error, /AutoScout24 \(HTTP 403\)/);
});
