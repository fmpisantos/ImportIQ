/**
 * Standvirtual PT comparison fetcher (Specification §4.1, Appendix A.4).
 *
 * Keyless: data is a urql GraphQL cache in `__NEXT_DATA__` →
 * `props.pageProps.urqlState[<key>].data` (a JSON *string* — parse it) →
 * `advertSearch.edges[].node`. Power is reported in cv (= German PS) and
 * converted to kW here so the matcher compares like with like (§4.2).
 *
 * Best-effort; failures are caught by the comparison service and surfaced as a
 * skipped source, never fatal.
 */

import type { NormalizedListing } from "@importiq/shared";
import type { PtComparable } from "../../domain/comparison/types.js";
import {
  normalizeFuel,
  normalizeModelKey,
  parseInteger,
  powerToKw,
  yearOf,
} from "../../domain/normalize.js";
import { extractNextData, fetchText } from "../http.js";
import type { PtFetchResult, PtSourceFetcher } from "./types.js";

const BASE = "https://www.standvirtual.com";

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

function buildUrl(subject: NormalizedListing): string {
  const brand = slug(subject.brand);
  const modelKey = normalizeModelKey(subject.model);
  const path = modelKey ? `/carros/${brand}/${modelKey}` : `/carros/${brand}`;
  const p = new URLSearchParams();
  const year = yearOf(subject.firstRegistration);
  if (year != null) {
    p.set("search[filter_float_first_registration_year:from]", String(year - 1));
    p.set("search[filter_float_first_registration_year:to]", String(year + 1));
  }
  if (subject.mileageKm != null) {
    p.set("search[filter_float_mileage:to]", String(subject.mileageKm + 20000));
  }
  return `${BASE}${path}?${p.toString()}`;
}

interface SvParameter {
  key: string;
  value?: string;
  displayValue?: string;
}
interface SvNode {
  title?: string;
  url?: string;
  price?: { amount?: { units?: number } };
  priceEvaluation?: { indicator?: string };
  parameters?: SvParameter[];
}

function paramMap(node: SvNode): Map<string, SvParameter> {
  const map = new Map<string, SvParameter>();
  for (const p of node.parameters ?? []) map.set(p.key, p);
  return map;
}

function mapNode(node: SvNode): PtComparable | null {
  const m = paramMap(node);
  const brand = m.get("make")?.displayValue;
  const model = m.get("model")?.value ?? m.get("model")?.displayValue;
  const priceEur = node.price?.amount?.units;
  if (!brand || !model || priceEur == null) return null;

  const cv = parseInteger(m.get("engine_power")?.value ?? null);
  const indicator = node.priceEvaluation?.indicator as PtComparable["ratingIndicator"];

  return {
    sourceId: "standvirtual",
    url: node.url ?? BASE,
    title: node.title ?? `${brand} ${model}`,
    brand,
    model,
    variant: m.get("version")?.displayValue ?? null,
    priceEur,
    mileageKm: parseInteger(m.get("mileage")?.value ?? null),
    year: parseInteger(m.get("first_registration_year")?.value ?? null),
    fuelType: normalizeFuel(m.get("fuel_type")?.value ?? m.get("fuel_type")?.displayValue),
    engineCc: parseInteger(m.get("engine_capacity")?.value ?? null),
    powerKw: powerToKw(cv, "cv"),
    ratingIndicator: indicator ?? null,
  };
}

function extractNodes(data: unknown): SvNode[] {
  const urqlState = (data as { props?: { pageProps?: { urqlState?: Record<string, { data?: string }> } } })
    ?.props?.pageProps?.urqlState;
  if (!urqlState) return [];
  for (const entry of Object.values(urqlState)) {
    if (!entry?.data) continue;
    try {
      const parsed = JSON.parse(entry.data) as {
        advertSearch?: { edges?: { node?: SvNode }[] };
      };
      const edges = parsed.advertSearch?.edges;
      if (edges) return edges.map((e) => e.node).filter((n): n is SvNode => !!n);
    } catch {
      /* not the advertSearch entry — skip */
    }
  }
  return [];
}

export const standvirtualPtSource: PtSourceFetcher = {
  id: "standvirtual",
  async fetch(subject: NormalizedListing): Promise<PtFetchResult> {
    try {
      const html = await fetchText(buildUrl(subject));
      const nodes = extractNodes(extractNextData(html));
      const comparables = nodes
        .map(mapNode)
        .filter((c): c is PtComparable => c !== null);
      return { sourceId: "standvirtual", comparables, error: null };
    } catch (err) {
      return {
        sourceId: "standvirtual",
        comparables: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
