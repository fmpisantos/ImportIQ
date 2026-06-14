import { useMemo, useState } from 'react';
import FilterForm from '../components/FilterForm.jsx';
import ResultCard from '../components/ResultCard.jsx';
import { api, downloadExport } from '../api.js';

const SORTS = {
  saving: { label: 'Saving vs PT asking (highest first)', fn: (a, b) => (b.savingEur ?? -Infinity) - (a.savingEur ?? -Infinity) },
  landed: { label: 'Total landed cost (low → high)', fn: (a, b) => (a.totalLandedCostEur ?? Infinity) - (b.totalLandedCostEur ?? Infinity) },
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
  const [sort, setSort] = useState('saving');
  // Remember the active filters so paging / re-sorting re-runs the same search.
  const [filters, setFilters] = useState(null);

  // The store sorts and paginates server-side, so a sort change or a new page is
  // a fresh request (not just a client-side reorder of the current page).
  const fetchPage = async (baseFilters, page, sortKey = sort, live = false) => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.runSearch({ ...baseFilters, page, pageSize: PAGE_SIZE, sort: sortKey, live });
      setData(result);
      if (page > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  // New search — reset to page 1 and remember the filters.
  const run = (newFilters) => {
    setFilters(newFilters);
    return fetchPage(newFilters, 1);
  };

  const goToPage = (page) => {
    if (!filters || running) return;
    fetchPage(filters, page);
  };

  const changeSort = (key) => {
    setSort(key);
    if (filters && !running) fetchPage(filters, 1, key);
  };

  // On-demand live scrape of the current search (bypasses the store) — useful
  // when the store is empty/stale or you want the very latest for one query.
  const refreshLive = () => {
    if (!filters || running) return;
    fetchPage(filters, 1, sort, true);
  };

  // Keep the visible page ordered by the chosen key even if the server tie-breaks
  // differently (server sort already spans all pages; this is a within-page tidy).
  const sorted = useMemo(() => {
    if (!data?.results) return [];
    return [...data.results].sort(SORTS[sort].fn);
  }, [data, sort]);

  const page = data?.page ?? 1;
  const totalPages = data?.totalPages ?? 1;
  const isLive = data?.source === 'live';

  return (
    <div className="page">
      <FilterForm onRun={run} running={running} />

      {error && <div className="error">⚠️ {error}</div>}

      {data && (
        <div className="results-section">
          <div className="results-toolbar">
            <span>
              {data.total ?? data.count} result{(data.total ?? data.count) === 1 ? '' : 's'}
              {totalPages > 1 && ` · page ${page}/${totalPages}`} ·{' '}
              {isLive ? 'live scrape' : 'deal store'} · active transport:{' '}
              {data.activeTransportMethod ?? 'unset'}
            </span>
            <div className="toolbar-right">
              <label>
                Sort:{' '}
                <select value={sort} onChange={(e) => changeSort(e.target.value)} disabled={running}>
                  {Object.entries(SORTS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <button onClick={refreshLive} disabled={running} title="Scrape this search live, bypassing the store">
                ↻ Refresh live
              </button>
              <button onClick={() => downloadExport('csv', data.results)}>Export CSV</button>
              <button onClick={() => downloadExport('json', data.results)}>Export JSON</button>
            </div>
          </div>

          {sorted.map((r) => (
            <ResultCard key={r.listing.id} result={r} />
          ))}

          {sorted.length === 0 && (
            <div className="muted empty-results">
              {isLive ? (
                <p>No listings matched your filters in a live scrape.</p>
              ) : (
                <>
                  <p>No matching deals in the store yet.</p>
                  <p className="small">
                    The store is filled by the daily batch — run <code>npm run ingest</code> to
                    populate it, or click <strong>↻ Refresh live</strong> to scrape this search now.
                  </p>
                </>
              )}
            </div>
          )}

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
        <p className="muted hint">
          Set your filters and click <strong>Search</strong> to browse pre-computed deals from the
          store (filled by the daily ingestion batch). Use <strong>↻ Refresh live</strong> on the
          results to scrape a single search on demand.
        </p>
      )}
    </div>
  );
}
