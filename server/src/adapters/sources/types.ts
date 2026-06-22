/**
 * The single dispatcher seam for German listing retrieval (Specification §3.6).
 *
 * The rest of the app only ever sees `SourceAdapter`; it never knows which
 * source is live. Adding/removing a real source means adding one adapter and
 * registering it — zero changes to the engine, comparison, or UI.
 */

import type { NormalizedListing, SearchFilters, SourceId } from "@importiq/shared";

export interface SourcePage {
  listings: NormalizedListing[];
  /** 1-based page just fetched. */
  page: number;
  /** Whether a further page exists for this query. */
  hasMore: boolean;
}

export interface SourceAdapter {
  id: SourceId;
  /** Fetch one page of normalised listings for the given filters. */
  search(filters: SearchFilters, page: number): Promise<SourcePage>;
}
