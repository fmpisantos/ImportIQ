/**
 * Configuration service (Specification §6.3).
 *
 * Bridges the cost-config store and the pure landed-cost engine: it projects the
 * stored rows + active transport method into `ResolvedCosts`, and builds the
 * `ConfigResponse` (with validation warnings) for the API.
 *
 * The resolved costs are cached in-memory for the duration of a search run and
 * invalidated on ANY config write, so an edit takes effect on the next search
 * with no restart (§6.3).
 */

import type { ConfigResponse } from "@importiq/shared";
import type { ResolvedCosts } from "../domain/landedCost.js";
import {
  ACTIVE_TRANSPORT_KEY,
  getActiveTransportMethod,
  listConfig,
} from "../store/costConfig.js";

let cached: ResolvedCosts | null = null;

/** Call after any config write so the next search re-reads fresh values. */
export function invalidateConfigCache(): void {
  cached = null;
}

export function resolveCosts(): ResolvedCosts {
  if (cached) return cached;

  const rows = listConfig();
  const activeMethod = getActiveTransportMethod();

  // --- Transport: only the active method, and only when usable ------------
  let transport: ResolvedCosts["transport"] = null;
  let transportMissing: string | null = null;
  if (!activeMethod) {
    transportMissing = "active transport method not selected";
  } else {
    const row = rows.find((r) => r.key === activeMethod);
    if (!row) transportMissing = "active transport method not found";
    else if (!row.enabled) transportMissing = `transport method "${row.label}" is disabled`;
    else if (row.amountEur <= 0) transportMissing = `transport method "${row.label}" amount not set`;
    else transport = { label: row.label, amountEur: row.amountEur };
  }

  // --- Legalisation + Other: every enabled cost row with a real amount -----
  const billable = rows.filter(
    (r) => (r.category === "legalisation" || r.category === "other") && r.enabled,
  );
  const legalisationItems = billable
    .filter((r) => r.amountEur > 0)
    .map((r) => ({ key: r.key, label: r.label, amountEur: r.amountEur }));
  const legalisationUnset = billable.filter((r) => r.amountEur <= 0).map((r) => r.label);

  cached = { transport, transportMissing, legalisationItems, legalisationUnset };
  return cached;
}

/** Build the API view of configuration, including the validation banner. */
export function getConfigResponse(): ConfigResponse {
  const rows = listConfig();
  const activeTransportMethod = getActiveTransportMethod();
  const resolved = resolveCosts();

  const validationWarnings: string[] = [];
  if (!resolved.transport && resolved.transportMissing) {
    validationWarnings.push(`Transport: ${resolved.transportMissing}.`);
  }
  for (const label of resolved.legalisationUnset) {
    validationWarnings.push(`Fee "${label}" is enabled but its amount is not set.`);
  }

  return { rows, activeTransportMethod, validationWarnings };
}

export { ACTIVE_TRANSPORT_KEY };
