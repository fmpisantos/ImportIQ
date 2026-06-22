/**
 * Search orchestration (Specification §3, §7).
 *
 * For one search request it: fetches one page per active source (resilient —
 * a failing source degrades gracefully and is reported, never fatal), computes
 * the PT comparison and landed cost for every listing, builds result cards, and
 * returns them merged and sorted with per-source status + page cursors for lazy
 * "Next" pagination (§7.4).
 */

import type {
  ResultCard,
  SearchRequest,
  SearchResponse,
  SortKey,
  SourceId,
  SourceStatus,
} from "@importiq/shared";
import { config } from "../config.js";
import { computeLandedCost, type ResolvedCosts } from "../domain/landedCost.js";
import { buildResultCard, sortResults } from "../domain/results.js";
import { getActiveSources } from "../adapters/sources/registry.js";
import type { SourceAdapter, SourcePage } from "../adapters/sources/types.js";
import { cacheThrough } from "../store/cache.js";
import { comparePt } from "./comparisonService.js";
import { invalidateConfigCache, resolveCosts } from "./configService.js";

const DEFAULT_SORT: SortKey = "savingDesc";

/** Cache key: every filter that changes the result + source + page (§8). */
function sourceCacheKey(source: SourceId, req: SearchRequest, page: number): string {
  return `search:${source}:${page}:${JSON.stringify(req.filters)}`;
}

async function fetchSourcePage(
  source: SourceAdapter,
  req: SearchRequest,
  page: number,
): Promise<SourcePage> {
  return cacheThrough(sourceCacheKey(source.id, req, page), config.searchCacheTtlMs, () =>
    source.search(req.filters, page),
  );
}

/** Build one result card: comparison + landed cost for a single listing. */
async function buildCard(
  listing: SourcePage["listings"][number],
  costs: ResolvedCosts,
  asOf: Date,
): Promise<ResultCard> {
  const ptComparison = await comparePt(listing);
  const landedCost = computeLandedCost(listing, costs, asOf);
  return buildResultCard(listing, landedCost, ptComparison);
}

export async function runSearch(req: SearchRequest): Promise<SearchResponse> {
  const sort = req.sort ?? DEFAULT_SORT;
  const sources = getActiveSources();

  // Read configuration fresh for this run (§6.3).
  invalidateConfigCache();
  const costs = resolveCosts();
  const asOf = new Date();

  const pageOf = (id: SourceId): number => Math.max(1, req.pages?.[id] ?? 1);

  // Fetch one page per source, resiliently.
  const fetches = await Promise.allSettled(
    sources.map((s) => fetchSourcePage(s, req, pageOf(s.id))),
  );

  const statuses: SourceStatus[] = [];
  const pages: Partial<Record<SourceId, number>> = {};
  const listings: SourcePage["listings"] = [];

  fetches.forEach((res, i) => {
    const source = sources[i]!;
    const page = pageOf(source.id);
    pages[source.id] = page;
    if (res.status === "fulfilled") {
      listings.push(...res.value.listings);
      statuses.push({
        sourceId: source.id,
        ok: true,
        page,
        hasMore: res.value.hasMore,
        count: res.value.listings.length,
        error: null,
      });
    } else {
      statuses.push({
        sourceId: source.id,
        ok: false,
        page,
        hasMore: false,
        count: 0,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  const cards = await Promise.all(listings.map((l) => buildCard(l, costs, asOf)));

  return { results: sortResults(cards, sort), sources: statuses, pages, sort };
}
