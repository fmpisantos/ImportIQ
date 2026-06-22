import type { SourceStatus } from "@importiq/shared";

const SOURCE_LABELS: Record<string, string> = {
  autoscout24: "AutoScout24",
  mobilede: "mobile.de",
  mock: "Mock source",
};

/**
 * Renders the per-source status row (§7). A failed source shows "source
 * unavailable" with its error but must never hide results from other sources.
 */
export function SourceBanner({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="source-banner" role="status">
      {sources.map((s) => (
        <div
          key={s.sourceId}
          className={`source-pill ${s.ok ? "source-pill--ok" : "source-pill--down"}`}
          title={s.error ?? undefined}
        >
          <span className="source-pill__name">
            {SOURCE_LABELS[s.sourceId] ?? s.sourceId}
          </span>
          {s.ok ? (
            <span className="source-pill__meta">
              {s.count} result{s.count === 1 ? "" : "s"}
              {s.hasMore ? " · more available" : ""}
            </span>
          ) : (
            <span className="source-pill__meta">
              source unavailable{s.error ? ` — ${s.error}` : ""}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
