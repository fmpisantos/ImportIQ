/**
 * Nightly batch deep-search (Specification §9).
 *
 * A batch runs a saved search MORE DEEPLY than an interactive run (several pages
 * per source vs one), then keeps only the top deals. The §9 investigation
 * (depth / ranking / alerts) is still open, so the defaults here are explicit and
 * config-driven:
 *   - depth  = `config.batchDepthPages` pages per source
 *   - ranking = highest saving first; only genuine savings are kept
 *   - keep    = `config.batchTopDeals` per saved search
 *   - alerts  = none yet (deferred — §9 investigation)
 */

import type { ResultCard, SearchFilters } from "@importiq/shared";
import { config } from "../config.js";
import { computeLandedCost } from "../domain/landedCost.js";
import { buildResultCard, sortResults } from "../domain/results.js";
import { getActiveSources } from "../adapters/sources/registry.js";
import { listBatches, saveBatchResult } from "../store/batches.js";
import { comparePt } from "./comparisonService.js";
import { invalidateConfigCache, resolveCosts } from "./configService.js";

async function deepFetch(filters: SearchFilters) {
  const sources = getActiveSources();
  const all = (
    await Promise.all(
      sources.map(async (source) => {
        const listings = [];
        for (let page = 1; page <= config.batchDepthPages; page++) {
          const res = await source.search(filters, page);
          listings.push(...res.listings);
          if (!res.hasMore) break;
        }
        return listings;
      }),
    )
  ).flat();
  return all;
}

export async function runBatch(batchId: string, name: string, filters: SearchFilters): Promise<ResultCard[]> {
  invalidateConfigCache();
  const costs = resolveCosts();
  const asOf = new Date();

  const listings = await deepFetch(filters);
  const cards = await Promise.all(
    listings.map(async (l) => buildResultCard(l, computeLandedCost(l, costs, asOf), await comparePt(l))),
  );

  // Ranking: only real savings, highest first, capped (§9 default).
  const topDeals = sortResults(
    cards.filter((c) => c.verdict === "saving" && (c.savingEur ?? 0) > 0),
    "savingDesc",
  ).slice(0, config.batchTopDeals);

  saveBatchResult(batchId, topDeals);
  console.log(`[batch] "${name}" → ${topDeals.length} top deals from ${listings.length} listings`);
  return topDeals;
}

/** Run every enabled saved batch (invoked by the scheduler). */
export async function runAllBatches(): Promise<void> {
  const batches = listBatches().filter((b) => b.enabled);
  console.log(`[batch] running ${batches.length} enabled batch search(es)`);
  for (const b of batches) {
    try {
      await runBatch(b.id, b.name, b.filters);
    } catch (err) {
      console.error(`[batch] "${b.name}" failed:`, err);
    }
  }
}
