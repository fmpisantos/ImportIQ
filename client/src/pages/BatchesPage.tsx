import { useEffect, useState } from "react";
import type {
  BatchResult,
  BatchSearch,
  BrandsResponse,
  SearchFilters,
} from "@importiq/shared";
import {
  ApiError,
  createBatch,
  deleteBatch,
  getBatches,
  getBatchResults,
  getBrands,
  updateBatch,
} from "../api";
import { emptyFilters, FilterForm } from "../components/FilterForm";
import { ResultCard } from "../components/ResultCard";
import { formatDateTime } from "../format";

export function BatchesPage() {
  const [brands, setBrands] = useState<BrandsResponse | null>(null);
  const [batches, setBatches] = useState<BatchSearch[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Editor state: either creating (id === null) or editing an existing batch.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(emptyFilters);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getBrands().then(setBrands).catch(() => setBrands(null));
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, r] = await Promise.all([getBatches(), getBatchResults()]);
      setBatches(b);
      setResults(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load batches.");
    } finally {
      setLoading(false);
    }
  }

  function startCreate() {
    setEditingId(null);
    setDraftName("");
    setDraftFilters(emptyFilters());
    setCreating(true);
  }

  function startEdit(b: BatchSearch) {
    setEditingId(b.id);
    setDraftName(b.name);
    setDraftFilters(b.filters);
    setCreating(true);
  }

  function cancelEdit() {
    setCreating(false);
    setEditingId(null);
  }

  async function save() {
    if (!draftName.trim()) return;
    setError(null);
    try {
      if (editingId) {
        await updateBatch(editingId, {
          name: draftName.trim(),
          filters: draftFilters,
        });
      } else {
        await createBatch(draftName.trim(), draftFilters);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  async function toggleEnabled(b: BatchSearch) {
    setError(null);
    try {
      await updateBatch(b.id, { enabled: !b.enabled });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    }
  }

  async function remove(b: BatchSearch) {
    setError(null);
    try {
      await deleteBatch(b.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  return (
    <div className="page">
      <section className="panel">
        <div className="panel__header">
          <h2>Batch searches</h2>
          {!creating && (
            <button className="btn btn--primary" onClick={startCreate}>
              New batch
            </button>
          )}
        </div>

        {error && <div className="alert alert--error">{error}</div>}

        {creating && (
          <div className="batch-editor">
            <div className="field">
              <label htmlFor="batch-name">Name</label>
              <input
                id="batch-name"
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Cheap diesel wagons"
              />
            </div>
            <FilterForm
              filters={draftFilters}
              onChange={setDraftFilters}
              brands={brands}
              idPrefix="batch"
            />
            <div className="batch-editor__actions">
              <button className="btn btn--primary" onClick={save}>
                {editingId ? "Save changes" : "Create batch"}
              </button>
              <button className="btn btn--ghost" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="muted">No saved batches yet.</p>
        ) : (
          <ul className="batch-list">
            {batches.map((b) => (
              <li key={b.id} className="batch-item">
                <div className="batch-item__info">
                  <strong>{b.name}</strong>
                  <span className="muted">
                    {filterSummary(b.filters)} · updated{" "}
                    {formatDateTime(b.updatedAt)}
                  </span>
                </div>
                <div className="batch-item__actions">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={b.enabled}
                      onChange={() => toggleEnabled(b)}
                    />
                    <span>{b.enabled ? "Enabled" : "Disabled"}</span>
                  </label>
                  <button className="btn btn--ghost btn--small" onClick={() => startEdit(b)}>
                    Edit
                  </button>
                  <button
                    className="btn btn--danger btn--small"
                    onClick={() => remove(b)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Top deals</h2>
        {results.length === 0 ? (
          <p className="muted">No curated deals yet. Run some batches first.</p>
        ) : (
          results.map((br) => (
            <div key={br.batchId} className="batch-results">
              <h3>
                {br.batchName}{" "}
                <span className="muted">
                  · generated {formatDateTime(br.generatedAt)}
                </span>
              </h3>
              {br.topDeals.length === 0 ? (
                <p className="muted">No deals found for this batch.</p>
              ) : (
                <div className="card-grid">
                  {br.topDeals.map((card, i) => (
                    <ResultCard
                      key={`${br.batchId}-${card.listing.sourceListingId}-${i}`}
                      card={card}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/** Compact one-line summary of a batch's filters for the list view. */
function filterSummary(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.brand) parts.push(f.brand + (f.model ? ` ${f.model}` : ""));
  if (f.yearFrom) parts.push(`from ${f.yearFrom}`);
  if (f.priceMaxEur) parts.push(`≤ €${f.priceMaxEur.toLocaleString("pt-PT")}`);
  if (f.maxMileageKm)
    parts.push(`≤ ${f.maxMileageKm.toLocaleString("pt-PT")} km`);
  if (f.fuelTypes.length) parts.push(f.fuelTypes.join("/"));
  return parts.length ? parts.join(" · ") : "Any car";
}
