import { useEffect, useState } from "react";
import type {
  BrandsResponse,
  ResultCard as ResultCardType,
  SearchFilters,
  SearchResponse,
  SortKey,
  SourceId,
} from "@importiq/shared";
import { ApiError, getBrands, postSearch } from "../api";
import { emptyFilters, FilterForm } from "../components/FilterForm";
import { ResultCard } from "../components/ResultCard";
import { SourceBanner } from "../components/SourceBanner";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "savingDesc", label: "Highest saving" },
  { value: "landedCostAsc", label: "Landed cost ↑" },
  { value: "germanPriceAsc", label: "German price ↑" },
  { value: "yearDesc", label: "Year ↓" },
  { value: "mileageAsc", label: "Mileage ↑" },
];

export function SearchPage() {
  const [brands, setBrands] = useState<BrandsResponse | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [sort, setSort] = useState<SortKey>("savingDesc");

  const [results, setResults] = useState<ResultCardType[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    getBrands()
      .then(setBrands)
      .catch(() => setBrands(null));
  }, []);

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      // Fresh search: no page cursors, results replace the list.
      const res = await postSearch({ filters, sort });
      setResponse(res);
      setResults(res.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed.");
      setResults([]);
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!response) return;
    // Advance the page only for sources that report hasMore (§7.4).
    const nextPages: Partial<Record<SourceId, number>> = { ...response.pages };
    for (const s of response.sources) {
      if (s.hasMore) {
        nextPages[s.sourceId] = (response.pages[s.sourceId] ?? s.page) + 1;
      }
    }
    setLoadingMore(true);
    setError(null);
    try {
      const res = await postSearch({ filters, sort, pages: nextPages });
      // Append, never pre-load.
      setResults((prev) => [...prev, ...res.results]);
      setResponse(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  const anyHasMore = response?.sources.some((s) => s.ok && s.hasMore) ?? false;

  return (
    <div className="page">
      <section className="panel">
        <h2>Find a car</h2>
        <FilterForm filters={filters} onChange={setFilters} brands={brands} />

        <div className="search-controls">
          <div className="field">
            <label htmlFor="sort">Sort by</label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={runSearch}
            disabled={loading}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </section>

      {error && <div className="alert alert--error">{error}</div>}

      {response && <SourceBanner sources={response.sources} />}

      {searched && !loading && results.length === 0 && !error && (
        <div className="empty-state">
          No results. Try widening your filters.
        </div>
      )}

      <div className="card-grid">
        {results.map((card, i) => (
          <ResultCard key={`${card.listing.sourceId}-${card.listing.sourceListingId}-${i}`} card={card} />
        ))}
      </div>

      {results.length > 0 && (
        <div className="load-more">
          {anyHasMore ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Next"}
            </button>
          ) : (
            <p className="muted">No more results from any source.</p>
          )}
        </div>
      )}
    </div>
  );
}
