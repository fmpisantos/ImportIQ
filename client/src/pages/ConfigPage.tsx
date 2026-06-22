import { useEffect, useState } from "react";
import type {
  ConfigCategory,
  ConfigResponse,
  CostConfigRow,
} from "@importiq/shared";
import {
  addOtherConfigRow,
  ApiError,
  deleteConfigRow,
  getConfig,
  setActiveTransport,
  updateConfigRow,
} from "../api";
import { formatDateTime } from "../format";

const CATEGORY_LABELS: Record<ConfigCategory, string> = {
  transport: "Transport",
  legalisation: "Legalisation",
  other: "Other",
};

const CATEGORY_ORDER: ConfigCategory[] = ["transport", "legalisation", "other"];

export function ConfigPage() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [otherLabel, setOtherLabel] = useState("");
  const [otherAmount, setOtherAmount] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setConfig(await getConfig());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load config.");
    } finally {
      setLoading(false);
    }
  }

  // Generic mutation runner: shows per-row saving state and swaps in the fresh
  // ConfigResponse the server returns.
  async function mutate(key: string, fn: () => Promise<ConfigResponse>) {
    setSavingKey(key);
    setError(null);
    try {
      setConfig(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setSavingKey(null);
    }
  }

  async function addOther() {
    const amount = Number(otherAmount);
    if (!otherLabel.trim() || !Number.isFinite(amount)) return;
    await mutate("__other__", () => addOtherConfigRow(otherLabel.trim(), amount));
    setOtherLabel("");
    setOtherAmount("");
  }

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  if (!config) {
    return (
      <div className="page">
        {error && <div className="alert alert--error">{error}</div>}
        <button className="btn btn--secondary" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  const grouped: Record<ConfigCategory, CostConfigRow[]> = {
    transport: [],
    legalisation: [],
    other: [],
  };
  for (const row of config.rows) grouped[row.category].push(row);

  return (
    <div className="page">
      <section className="panel">
        <h2>Cost configuration</h2>

        {error && <div className="alert alert--error">{error}</div>}

        {config.validationWarnings.length > 0 && (
          <div className="alert alert--warn">
            <strong>Configuration incomplete.</strong> The calculator needs:{" "}
            {config.validationWarnings.join(", ")}.
          </div>
        )}

        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="config-group">
            <h3>{CATEGORY_LABELS[cat]}</h3>
            {grouped[cat].length === 0 ? (
              <p className="muted">No rows.</p>
            ) : (
              <table className="config-table">
                <thead>
                  <tr>
                    {cat === "transport" && <th>Active</th>}
                    <th>Item</th>
                    <th>Amount (EUR)</th>
                    <th>Enabled</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[cat].map((row) => (
                    <ConfigRowEditor
                      key={row.key}
                      row={row}
                      isTransport={cat === "transport"}
                      isActive={config.activeTransportMethod === row.key}
                      saving={savingKey === row.key}
                      onSave={(patch) =>
                        mutate(row.key, () => updateConfigRow(row.key, patch))
                      }
                      onSetActive={() =>
                        mutate(row.key, () => setActiveTransport(row.key))
                      }
                      onDelete={
                        cat === "other"
                          ? () =>
                              mutate(row.key, () => deleteConfigRow(row.key))
                          : undefined
                      }
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        <div className="config-group">
          <h3>Add an "Other" cost</h3>
          <div className="add-other">
            <input
              type="text"
              placeholder="Label"
              value={otherLabel}
              onChange={(e) => setOtherLabel(e.target.value)}
            />
            <input
              type="number"
              placeholder="Amount (EUR)"
              value={otherAmount}
              onChange={(e) => setOtherAmount(e.target.value)}
            />
            <button
              className="btn btn--secondary"
              onClick={addOther}
              disabled={savingKey === "__other__"}
            >
              Add
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ConfigRowEditor({
  row,
  isTransport,
  isActive,
  saving,
  onSave,
  onSetActive,
  onDelete,
}: {
  row: CostConfigRow;
  isTransport: boolean;
  isActive: boolean;
  saving: boolean;
  onSave: (patch: {
    amountEur?: number;
    enabled?: boolean;
    notes?: string | null;
  }) => void;
  onSetActive: () => void;
  onDelete?: () => void;
}) {
  // Local draft state so typing doesn't fire a request on every keystroke;
  // changes are committed on blur.
  const [amount, setAmount] = useState(String(row.amountEur));
  const [notes, setNotes] = useState(row.notes ?? "");

  // Re-sync drafts when the server returns a fresh row.
  useEffect(() => {
    setAmount(String(row.amountEur));
    setNotes(row.notes ?? "");
  }, [row.amountEur, row.notes]);

  const commitAmount = () => {
    const n = Number(amount);
    if (Number.isFinite(n) && n !== row.amountEur) onSave({ amountEur: n });
  };

  const commitNotes = () => {
    const next = notes.trim() === "" ? null : notes;
    if (next !== row.notes) onSave({ notes: next });
  };

  return (
    <tr className={saving ? "row--saving" : ""}>
      {isTransport && (
        <td>
          <input
            type="radio"
            name="active-transport"
            checked={isActive}
            onChange={onSetActive}
            aria-label={`Use ${row.label}`}
          />
        </td>
      )}
      <td>
        <div className="cell-label">{row.label}</div>
        {row.guidance && <div className="cell-guidance">{row.guidance}</div>}
        <div className="cell-updated">Updated {formatDateTime(row.updatedAt)}</div>
      </td>
      <td>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={commitAmount}
          className="cell-amount"
        />
      </td>
      <td>
        <label className="switch">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onSave({ enabled: e.target.checked })}
          />
          <span>{row.enabled ? "On" : "Off"}</span>
        </label>
      </td>
      <td>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          placeholder="—"
          className="cell-notes"
        />
      </td>
      <td>
        {onDelete && (
          <button
            className="btn btn--danger btn--small"
            onClick={onDelete}
            aria-label={`Delete ${row.label}`}
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}
