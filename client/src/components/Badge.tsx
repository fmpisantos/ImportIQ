import type { SavingVerdict } from "@importiq/shared";
import { formatEur } from "../format";

/**
 * The saving/loss/unknown verdict badge. Per the spec's trust-first ethos the
 * "unknown" state is rendered explicitly (grey), never hidden.
 */
export function VerdictBadge({
  verdict,
  savingEur,
}: {
  verdict: SavingVerdict;
  savingEur: number | null;
}) {
  if (verdict === "unknown" || savingEur === null) {
    return <span className="badge badge--grey">Saving unknown</span>;
  }
  if (verdict === "loss") {
    return (
      <span className="badge badge--red">
        Loss {formatEur(Math.abs(savingEur))}
      </span>
    );
  }
  return (
    <span className="badge badge--green">Save {formatEur(savingEur)}</span>
  );
}

export function IncompleteBadge({ missing }: { missing: string[] }) {
  return (
    <span
      className="badge badge--amber"
      title={`Missing: ${missing.join(", ")}`}
    >
      Incomplete
    </span>
  );
}
