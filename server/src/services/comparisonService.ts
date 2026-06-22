/**
 * PT comparison service (Specification §4.1, §4.4).
 *
 * Fans out to every active PT source with `Promise.allSettled` (a failing source
 * is skipped, its error surfaced), dedupes across sources (dealers cross-post the
 * same car), applies the precise variant matcher, then reduces to one robust
 * value with provenance. Cacheable slow-moving data → cached per subject spec.
 */

import type { NormalizedListing, PtComparison } from "@importiq/shared";
import { config } from "../config.js";
import { estimatePtValue } from "../domain/comparison/estimate.js";
import { selectComparables } from "../domain/comparison/matching.js";
import type { PtComparable } from "../domain/comparison/types.js";
import { normalizeModelKey, yearOf } from "../domain/normalize.js";
import { getActivePtSources } from "../adapters/pt/registry.js";
import type { PtFetchResult } from "../adapters/pt/types.js";
import { cacheThrough } from "../store/cache.js";

/** Cache key: every subject field that changes the matched comparable set. */
function cacheKey(subject: NormalizedListing): string {
  return [
    "pt",
    subject.brand.toLowerCase(),
    normalizeModelKey(subject.model) ?? "?",
    yearOf(subject.firstRegistration) ?? "?",
    subject.fuelType ?? "?",
    subject.engineCc ?? "?",
    subject.powerKw ?? "?",
    subject.mileageKm ?? "?",
  ].join(":");
}

/** Dedupe across sources by URL, else by a price + model fingerprint (§4.1). */
function dedupe(comparables: PtComparable[]): PtComparable[] {
  const seen = new Set<string>();
  const out: PtComparable[] = [];
  for (const c of comparables) {
    const fingerprint = c.url || `${c.priceEur}|${normalizeModelKey(c.model)}|${c.year}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(c);
  }
  return out;
}

export async function comparePt(subject: NormalizedListing): Promise<PtComparison> {
  return cacheThrough(cacheKey(subject), config.ptCacheTtlMs, async () => {
    const sources = getActivePtSources();
    const settled = await Promise.allSettled(sources.map((s) => s.fetch(subject)));

    const pool: PtComparable[] = [];
    const failedSources: PtComparison["sources"] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const r: PtFetchResult = result.value;
        if (r.error) failedSources.push({ sourceId: r.sourceId, sampleSize: 0, error: r.error });
        else pool.push(...r.comparables);
      } else {
        failedSources.push({
          sourceId: sources[i]!.id,
          sampleSize: 0,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    const matched = selectComparables(subject, dedupe(pool));
    return estimatePtValue(matched, subject.mileageKm, failedSources);
  });
}
