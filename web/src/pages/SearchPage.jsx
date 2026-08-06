import { useMemo, useState } from 'react';
import FilterForm from '../components/FilterForm.jsx';
import ResultCard from '../components/ResultCard.jsx';
import { api, downloadExport } from '../api.js';

// A car with no PT benchmark (no comparables found, too few to trust, or not
// costable) has no verdict to show, so it never takes a top slot — it sorts
// below every benchmarked car whatever the key, mirroring the server's ordering
// (server/src/engine/ranking.js). `savingEur` is the same signal the server
// uses. Without this tier the client re-sort below would undo it.
const noBenchmark = (r) => (r.savingEur == null ? 1 : 0);
const tiered = (fn) => (a, b) => noBenchmark(a) - noBenchmark(b) || fn(a, b);

// Then, within a tier: unknown keys last in EITHER direction, and only then the
// numeric comparison — the same three steps as the server's rankComputedResults.
// Reading a key raw would put unknowns FIRST on an ascending sort (`null - 5`
// coerces to `-5`) or make the comparator inconsistent (`undefined - 5` is NaN,
// leaving the order unspecified), which is exactly what the benchmark tier
// exists to prevent. Not every key is always present — a listing can be costed
// and benchmarked with no odometer (see engine/landedCost.js).
const num = (v) => (Number.isFinite(v) ? v : null);
const byKey = (read, desc) =>
  tiered((a, b) => {
    const av = num(read(a));
    const bv = num(read(b));
    if (av == null || bv == null) return (av == null ? 1 : 0) - (bv == null ? 1 : 0);
    return desc ? bv - av : av - bv;
  });

const SORTS = {
  saving: { label: 'Saving vs PT asking (highest first)', fn: byKey((r) => r.savingEur, true) },
  landed: { label: 'Total landed cost (low → high)', fn: byKey((r) => r.totalLandedCostEur, false) },
  margin: { label: 'Expected resale margin (highest first)', fn: byKey((r) => r.marginEur, true) },
  german: { label: 'German price (low → high)', fn: byKey((r) => r.listing.priceEur, false) },
  year: { label: 'Year (newest first)', fn: byKey((r) => r.listing.year, true) },
  mileage: { label: 'Mileage (lowest first)', fn: byKey((r) => r.listing.mileageKm, false) },
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
      // A new page is fresh content — snap to the top so the first items are visible.
      window.scrollTo({ top: 0, behavior: 'auto' });
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

  // Keep paging/sorting within whichever mode produced the current results, so
  // Next on a live scrape stays live (and reaches deeper AS24 pages) instead of
  // silently dropping back to the store.
  const currentlyLive = data?.source === 'live';

  const goToPage = (page) => {
    if (!filters || running) return;
    fetchPage(filters, page, sort, currentlyLive);
  };

  const changeSort = (key) => {
    setSort(key);
    if (filters && !running) fetchPage(filters, 1, key, currentlyLive);
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
              {data.totalAvailable && data.totalAvailable > (data.total ?? 0) ? (
                <>first {data.total} of {data.totalAvailable} results</>
              ) : (
                <>{data.total ?? data.count} result{(data.total ?? data.count) === 1 ? '' : 's'}</>
              )}
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
