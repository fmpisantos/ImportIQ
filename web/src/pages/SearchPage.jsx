import { useMemo, useState } from 'react';
import FilterForm from '../components/FilterForm.jsx';
import ResultCard from '../components/ResultCard.jsx';
import { api, downloadExport } from '../api.js';

const SORTS = {
  landed: { label: 'Total landed cost (low → high)', fn: (a, b) => (a.totalLandedCostEur ?? Infinity) - (b.totalLandedCostEur ?? Infinity) },
  saving: { label: 'Saving vs PT asking (highest first)', fn: (a, b) => (b.savingEur ?? -Infinity) - (a.savingEur ?? -Infinity) },
  margin: { label: 'Expected resale margin (highest first)', fn: (a, b) => (b.marginEur ?? -Infinity) - (a.marginEur ?? -Infinity) },
  german: { label: 'German price (low → high)', fn: (a, b) => a.listing.priceEur - b.listing.priceEur },
  year: { label: 'Year (newest first)', fn: (a, b) => b.listing.year - a.listing.year },
  mileage: { label: 'Mileage (lowest first)', fn: (a, b) => a.listing.mileageKm - b.listing.mileageKm },
};

const PAGE_SIZE = 50;

export default function SearchPage() {
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('landed');
  // Remember the active filters so paging re-runs the same search on a new page.
  const [filters, setFilters] = useState(null);

  const fetchPage = async (baseFilters, page) => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.runSearch({ ...baseFilters, page, pageSize: PAGE_SIZE });
      setData(result);
      // Jump back to the top when changing pages.
      if (page > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  // New search (Run Bot) — reset to page 1 and remember the filters.
  const run = (newFilters) => {
    setFilters(newFilters);
    return fetchPage(newFilters, 1);
  };

  const goToPage = (page) => {
    if (!filters || running) return;
    fetchPage(filters, page);
  };

  // Sorting applies to the current page (server-side pagination computes one
  // page at a time — see the note below the toolbar).
  const sorted = useMemo(() => {
    if (!data?.results) return [];
    return [...data.results].sort(SORTS[sort].fn);
  }, [data, sort]);

  const page = data?.page ?? 1;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="page">
      <FilterForm onRun={run} running={running} />

      {error && <div className="error">⚠️ {error}</div>}

      {data && (
        <div className="results-section">
          <div className="results-toolbar">
            <span>
              {data.total ?? data.count} result{(data.total ?? data.count) === 1 ? '' : 's'}
              {totalPages > 1 && ` · page ${page}/${totalPages}`} · active transport:{' '}
              {data.activeTransportMethod ?? 'unset'}
            </span>
            <div className="toolbar-right">
              <label>
                Sort:{' '}
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {Object.entries(SORTS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <button onClick={() => downloadExport('csv', data.results)}>Export CSV</button>
              <button onClick={() => downloadExport('json', data.results)}>Export JSON</button>
            </div>
          </div>

          {totalPages > 1 && (
            <p className="muted small page-note">
              Sort applies to this page. Landed cost &amp; PT comparison are computed per page —
              page {page} of {totalPages}.
            </p>
          )}

          {sorted.map((r) => (
            <ResultCard key={r.listing.id} result={r} />
          ))}
          {sorted.length === 0 && <p className="muted">No listings matched your filters.</p>}

          {totalPages > 1 && (
            <div className="pagination">
              <button disabled={page <= 1 || running} onClick={() => goToPage(page - 1)}>
                ← Prev
              </button>
              <span className="muted">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages || running} onClick={() => goToPage(page + 1)}>
                {running ? 'Loading…' : 'Next →'}
              </button>
            </div>
          )}
        </div>
      )}

      {!data && !running && (
        <p className="muted hint">Set your filters and click <strong>Run Bot</strong> to query mobile.de and compute landed costs.</p>
      )}
    </div>
  );
}
