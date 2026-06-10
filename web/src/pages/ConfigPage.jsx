import { useEffect, useState } from 'react';
import { api, eur } from '../api.js';

const CATEGORY_LABELS = {
  transport: 'Transport',
  legalisation: 'Legalisation',
  other: 'Other',
};

function Row({ row, isActive, onSave, onActivate }) {
  const [amount, setAmount] = useState(row.amount_eur);
  const [enabled, setEnabled] = useState(row.enabled);
  const [notes, setNotes] = useState(row.notes ?? '');
  const dirty = amount !== row.amount_eur || enabled !== row.enabled || notes !== (row.notes ?? '');

  return (
    <tr className={enabled ? '' : 'disabled'}>
      <td>
        <div className="row-label">{row.label}</div>
        <code className="row-key">{row.key}</code>
      </td>
      <td>
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="amount-input"
        />
      </td>
      <td>
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{enabled ? 'On' : 'Off'}</span>
        </label>
      </td>
      <td>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="notes-input"
          placeholder="source / quote reference"
        />
      </td>
      <td className="row-meta">
        <span className="updated" title={`Updated ${row.updated_at}`}>
          {row.updated_at?.slice(0, 10)}
        </span>
      </td>
      <td className="row-actions">
        {row.category === 'transport' && (
          <button
            className={`activate ${isActive ? 'is-active' : ''}`}
            disabled={isActive || !enabled}
            onClick={() => onActivate(row.key)}
          >
            {isActive ? '✓ Active' : 'Set active'}
          </button>
        )}
        <button className="save" disabled={!dirty} onClick={() => onSave(row.key, { amount_eur: amount, enabled, notes })}>
          Save
        </button>
      </td>
    </tr>
  );
}

export default function ConfigPage() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const load = () => api.getConfig().then(setConfig).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const activeMethod = config?.activeSettings?.['transport.active_method'];

  const save = async (key, patch) => {
    try {
      await api.updateConfig(key, patch);
      setFlash(`Saved ${key}`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const activate = async (key) => {
    try {
      await api.setActiveTransport(key);
      setFlash(`Active transport → ${key}`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!config) return <div className="page"><p className="muted">Loading configuration…</p></div>;

  // Validation: warn if the active transport is unset/disabled or no legalisation
  // fee is enabled — either forces results into the Incomplete state.
  const rows = config.costConfig;
  const activeRow = rows.find((r) => r.key === activeMethod);
  const warnings = [];
  if (!activeMethod || !activeRow?.enabled) warnings.push('No active transport method is enabled.');
  if (!rows.some((r) => r.category === 'legalisation' && r.enabled)) warnings.push('No legalisation fee is enabled.');

  const grouped = rows.reduce((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="page config-page">
      <h2>Configuration</h2>
      <p className="muted">
        These are the real, user-owned cost values the calculator uses. No estimates are
        baked in — if a required field is unset, results show <strong>Incomplete</strong>.
      </p>

      {warnings.length > 0 && (
        <div className="warn-banner">
          ⚠️ {warnings.join(' ')} Results will be marked Incomplete until fixed.
        </div>
      )}
      {error && <div className="error">⚠️ {error}</div>}
      {flash && <div className="flash" onAnimationEnd={() => setFlash(null)}>{flash}</div>}

      {Object.entries(grouped).map(([category, catRows]) => (
        <section key={category} className="config-group card">
          <h3>{CATEGORY_LABELS[category] ?? category}</h3>
          <table className="config-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Amount (€)</th>
                <th>Enabled</th>
                <th>Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {catRows.map((row) => (
                <Row
                  key={row.key}
                  row={row}
                  isActive={row.key === activeMethod}
                  onSave={save}
                  onActivate={activate}
                />
              ))}
            </tbody>
          </table>
          {category === 'transport' && (
            <p className="muted small">
              Active method total used in every landed-cost calculation: <strong>{eur(activeRow?.amount_eur)}</strong>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
