import { useMemo, useState } from 'react';
import FilterForm from '../components/FilterForm.jsx';
import ResultCard from '../components/ResultCard.jsx';
import { api, downloadExport } from '../api.js';

const SORTS = {
  landed: { label: 'Total landed cost (low → high)', fn: (a, b) => (a.totalLandedCostEur ?? Infinity) - (b.totalLandedCostEur ?? Infinity) },
  saving: { label: 'Saving vs PT (highest first)', fn: (a, b) => (b.savingEur ?? -Infinity) - (a.savingEur ?? -Infinity) },
  german: { label: 'German price (low → high)', fn: (a, b) => a.listing.priceEur - b.listing.priceEur },
  year: { label: 'Year (newest first)', fn: (a, b) => b.listing.year - a.listing.year },
  mileage: { label: 'Mileage (lowest first)', fn: (a, b) => a.listing.mileageKm - b.listing.mileageKm },
};

export default function SearchPage() {
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('landed');

  const run = async (filters) => {
    setRunning(true);
    setError(null);
    try {
      setData(await api.runSearch(filters));
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const sorted = useMemo(() => {
    if (!data?.results) return [];
    return [...data.results].sort(SORTS[sort].fn);
  }, [data, sort]);

  return (
    <div className="page">
      <FilterForm onRun={run} running={running} />

      {error && <div className="error">⚠️ {error}</div>}

      {data && (
        <div className="results-section">
          <div className="results-toolbar">
            <span>{data.count} result{data.count === 1 ? '' : 's'} · active transport: {data.activeTransportMethod ?? 'unset'}</span>
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

          {sorted.map((r) => (
            <ResultCard key={r.listing.id} result={r} />
          ))}
          {sorted.length === 0 && <p className="muted">No listings matched your filters.</p>}
        </div>
      )}

      {!data && !running && (
        <p className="muted hint">Set your filters and click <strong>Run Bot</strong> to query mobile.de and compute landed costs.</p>
      )}
    </div>
  );
}
