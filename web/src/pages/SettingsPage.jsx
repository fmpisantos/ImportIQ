import { useEffect, useState } from 'react';
import { api } from '../api.js';

const SOURCES = [
  { key: 'mock', label: 'Mock (sample data)', blurb: 'Deterministic sample listings — no credentials, full flow works offline. Great for a first end-to-end test.' },
  { key: 'apify', label: 'Apify (live scraping)', blurb: 'Live mobile.de + AutoScout24 + AutoUncle via Apify actors. Needs an Apify token (paid). This is the recommended real-data path.' },
  { key: 'official', label: 'Official mobile.de API', blurb: 'Real mobile.de Search API. Needs a mobile.de dealer account (username + password).' },
];

const ALL_SITES = ['mobilede', 'autoscout24', 'autouncle'];
const SECRET_KEYS = ['apify_token', 'mobilede_pass', 'olx_api_key', 'standvirtual_token'];

// A masked password field that shows whether a value is already stored and lets
// the user replace or clear it. Typed value is only sent on save.
function SecretField({ label, name, field, value, onChange, cleared, onToggleClear }) {
  return (
    <label className="secret-field">
      {label}
      <input
        type="password"
        autoComplete="new-password"
        placeholder={cleared ? '(will be cleared)' : field?.set ? `${field.hint} — leave blank to keep` : 'not set'}
        value={value}
        disabled={cleared}
        onChange={(e) => onChange(name, e.target.value)}
      />
      <span className="field-meta">
        <SourceTag source={cleared ? 'unset' : field?.source} />
        {field?.set && (
          <button type="button" className="linkish" onClick={() => onToggleClear(name)}>
            {cleared ? 'keep' : 'clear'}
          </button>
        )}
      </span>
    </label>
  );
}

function SourceTag({ source }) {
  if (!source || source === 'unset') return <span className="source-tag unset">not set</span>;
  const labels = { override: 'saved here', env: 'from .env', default: 'default' };
  return <span className={`source-tag ${source}`}>{labels[source] ?? source}</span>;
}

export default function SettingsPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [clear, setClear] = useState(new Set());
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await api.getSettings();
      setData(d);
      const f = d.fields;
      setForm({
        data_source: f.data_source.value,
        apify_sites: (f.apify_sites.value || '').split(',').map((s) => s.trim()).filter(Boolean),
        apify_max_per_site: f.apify_max_per_site.value,
        apify_use_proxy: /^(1|true|yes)$/i.test(f.apify_use_proxy.value),
        mobilede_user: f.mobilede_user.value || '',
        pt_provider: f.pt_provider.value,
        // secret inputs start blank — placeholder shows whether one is stored
        apify_token: '',
        mobilede_pass: '',
        olx_api_key: '',
        standvirtual_token: '',
      });
      setClear(new Set());
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  if (!form) return <div className="page"><p className="muted">Loading settings…</p></div>;

  const set = (patch) => setForm((s) => ({ ...s, ...patch }));
  const setSecret = (name, value) => setForm((s) => ({ ...s, [name]: value }));
  const toggleClear = (name) =>
    setClear((c) => {
      const next = new Set(c);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const toggleSite = (site) =>
    set({
      apify_sites: form.apify_sites.includes(site)
        ? form.apify_sites.filter((s) => s !== site)
        : [...form.apify_sites, site],
    });

  const save = async () => {
    setError(null);
    if (form.data_source === 'apify' && form.apify_sites.length === 0) {
      setError('Pick at least one Apify site to query.');
      return;
    }
    const updates = {
      data_source: form.data_source,
      apify_sites: form.apify_sites.join(','),
      apify_max_per_site: String(form.apify_max_per_site),
      apify_use_proxy: form.apify_use_proxy ? 'true' : 'false',
      mobilede_user: form.mobilede_user,
      pt_provider: form.pt_provider,
    };
    for (const k of SECRET_KEYS) if (form[k] && !clear.has(k)) updates[k] = form[k];
    try {
      setBusy(true);
      await api.updateSettings(updates, [...clear]);
      setFlash('Settings saved — takes effect on your next search.');
      setTest(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setError(null);
    setTest({ pending: true });
    try {
      const r = await api.testConnection();
      setTest(r);
    } catch (e) {
      setTest({ ok: false, error: e.message });
    }
  };

  const f = data.fields;
  const active = form.data_source;

  return (
    <div className="page settings-page">
      <h2>Settings</h2>
      <p className="muted">
        Configure the data source and credentials for a full end-to-end run. Values resolve as
        <strong> saved-here → .env → default</strong>; changes take effect on your next search, no restart.
        Secrets are stored server-side and never shown back.
      </p>

      {error && <div className="error">⚠️ {error}</div>}
      {flash && <div className="flash" onAnimationEnd={() => setFlash(null)}>{flash}</div>}

      {/* Data source */}
      <section className="card">
        <h3>Data source</h3>
        <div className="source-options">
          {SOURCES.map((s) => (
            <label key={s.key} className={`source-option ${active === s.key ? 'selected' : ''}`}>
              <input
                type="radio"
                name="data_source"
                checked={active === s.key}
                onChange={() => set({ data_source: s.key })}
              />
              <div>
                <div className="source-option-label">{s.label}</div>
                <div className="muted small">{s.blurb}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Apify */}
      <section className={`card ${active === 'apify' ? '' : 'dim'}`}>
        <h3>Apify <span className="muted small">— for live scraping</span></h3>
        <div className="grid">
          <SecretField
            label="Apify token"
            name="apify_token"
            field={f.apify_token}
            value={form.apify_token}
            onChange={setSecret}
            cleared={clear.has('apify_token')}
            onToggleClear={toggleClear}
          />
          <label>
            Max listings per site
            <input
              type="number"
              min="1"
              value={form.apify_max_per_site}
              onChange={(e) => set({ apify_max_per_site: e.target.value })}
            />
          </label>
        </div>

        <div className="sites-row">
          <span className="pill-label">Sites</span>
          {ALL_SITES.map((site) => (
            <button
              type="button"
              key={site}
              className={`pill ${form.apify_sites.includes(site) ? 'on' : ''}`}
              onClick={() => toggleSite(site)}
            >
              {site}
            </button>
          ))}
        </div>

        <label className="switch inline">
          <input
            type="checkbox"
            checked={form.apify_use_proxy}
            onChange={(e) => set({ apify_use_proxy: e.target.checked })}
          />
          <span>Route through Apify Proxy (recommended — beats anti-bot)</span>
        </label>
      </section>

      {/* mobile.de official */}
      <section className={`card ${active === 'official' ? '' : 'dim'}`}>
        <h3>mobile.de official API <span className="muted small">— dealer account</span></h3>
        <div className="grid">
          <label>
            Username
            <input
              type="text"
              autoComplete="off"
              value={form.mobilede_user}
              onChange={(e) => set({ mobilede_user: e.target.value })}
            />
            <span className="field-meta"><SourceTag source={f.mobilede_user.source} /></span>
          </label>
          <SecretField
            label="Password"
            name="mobilede_pass"
            field={f.mobilede_pass}
            value={form.mobilede_pass}
            onChange={setSecret}
            cleared={clear.has('mobilede_pass')}
            onToggleClear={toggleClear}
          />
        </div>
      </section>

      {/* PT market */}
      <section className="card">
        <h3>PT market comparison</h3>
        <p className="muted small">
          Provider used for the Portuguese price comparison (the Save/Premium verdict). Read access for
          market search is provider-dependent — see the README caveat.
        </p>
        <div className="grid">
          <label>
            Provider
            <select value={form.pt_provider} onChange={(e) => set({ pt_provider: e.target.value })}>
              <option value="olx">OLX Portugal</option>
              <option value="standvirtual">Standvirtual</option>
            </select>
          </label>
          {form.pt_provider === 'olx' ? (
            <SecretField
              label="OLX API key"
              name="olx_api_key"
              field={f.olx_api_key}
              value={form.olx_api_key}
              onChange={setSecret}
              cleared={clear.has('olx_api_key')}
              onToggleClear={toggleClear}
            />
          ) : (
            <SecretField
              label="Standvirtual token"
              name="standvirtual_token"
              field={f.standvirtual_token}
              value={form.standvirtual_token}
              onChange={setSecret}
              cleared={clear.has('standvirtual_token')}
              onToggleClear={toggleClear}
            />
          )}
        </div>
      </section>

      <div className="settings-actions">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        <button onClick={runTest} disabled={busy || test?.pending}>
          {test?.pending ? 'Testing…' : `Test ${active} connection`}
        </button>
      </div>

      {test && !test.pending && (
        <div className={test.ok ? 'flash persist' : 'error'}>
          {test.ok ? '✓ ' : '⚠️ '}
          {test.message ?? test.error}
        </div>
      )}

      <p className="muted small">
        Once saved (and a connection test passes for a real source), head to <strong>Search</strong> and
        run the bot to exercise the full flow: listings → landed cost → PT comparison → export.
      </p>
    </div>
  );
}
