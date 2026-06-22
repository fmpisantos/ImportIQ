/**
 * The Portuguese comparison source seam (Specification §4.1).
 *
 * Each fetcher returns a *candidate pool* for a subject German car (loosely
 * matched on brand + model at the source side); the precise variant matching
 * (§4.2–§4.3) is applied afterwards by the comparison service so the rule is
 * identical across sources. A failing source returns an `error` and an empty
 * pool — it is skipped, never fatal (§4.1 merge rule).
 */

import type { NormalizedListing, PtSourceId } from "@importiq/shared";
import type { PtComparable } from "../../domain/comparison/types.js";

export interface PtFetchResult {
  sourceId: PtSourceId;
  comparables: PtComparable[];
  error: string | null;
}

export interface PtSourceFetcher {
  id: PtSourceId;
  /** Fetch PT candidate comparables for the given German subject car. */
  fetch(subject: NormalizedListing): Promise<PtFetchResult>;
}
