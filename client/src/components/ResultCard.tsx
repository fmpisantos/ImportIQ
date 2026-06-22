import { useState } from "react";
import type { ResultCard as ResultCardType } from "@importiq/shared";
import {
  formatEur,
  formatEurPrecise,
  formatKm,
  formatPercent,
  fuelLabel,
  registrationYear,
  transmissionLabel,
} from "../format";
import { IncompleteBadge, VerdictBadge } from "./Badge";

const PT_SOURCE_LABELS: Record<string, string> = {
  standvirtual: "Standvirtual",
  olxpt: "OLX",
  mock: "Mock",
};

const SPECIAL_REGIME_LABELS: Record<string, string> = {
  none: "None",
  bev_exempt: "BEV exempt",
  phev_reduction: "PHEV reduction",
  hybrid_reduction: "Hybrid reduction",
  cng_reduction: "CNG reduction",
};

/**
 * The reusable result card, shared by Search and Batch views.
 *
 * Collapsed: thumbnail, title, key specs, German price, highlighted landed
 * cost (or Incomplete badge + missing list), discriminated cost lines, PT
 * market average, verdict badge, and a link to the listing.
 *
 * Expanded: the full §7.2 breakdown — ISV detail, transport, itemised
 * legalisation, annual IUC, and PT comparison provenance. The ISV "unverified"
 * warning is surfaced loudly whenever present (the spec's golden rule).
 */
export function ResultCard({ card }: { card: ResultCardType }) {
  const [open, setOpen] = useState(false);
  const { listing, landedCost, ptComparison, savingEur, verdict } = card;
  const { breakdown } = landedCost;
  const isv = breakdown.isv;

  const title = `${listing.brand} ${listing.model} ${registrationYear(
    listing.firstRegistration,
  )}`;

  return (
    <article className={`card ${verdict === "loss" ? "card--loss" : ""}`}>
      <div className="card__main">
        <div className="card__thumb">
          {listing.imageUrl ? (
            <img src={listing.imageUrl} alt={title} loading="lazy" />
          ) : (
            <div className="card__thumb--placeholder">No image</div>
          )}
        </div>

        <div className="card__body">
          <header className="card__header">
            <h3 className="card__title">
              <a href={listing.url} target="_blank" rel="noreferrer noopener">
                {title}
              </a>
            </h3>
            <VerdictBadge verdict={verdict} savingEur={savingEur} />
          </header>

          {listing.variant && (
            <p className="card__variant">{listing.variant}</p>
          )}

          <ul className="card__specs">
            <li>{formatKm(listing.mileageKm)}</li>
            <li>{fuelLabel(listing.fuelType)}</li>
            <li>{transmissionLabel(listing.transmission)}</li>
            {listing.powerKw !== null && <li>{listing.powerKw} kW</li>}
          </ul>

          <div className="card__prices">
            <div className="price-block">
              <span className="price-block__label">German price</span>
              <span className="price-block__value">
                {formatEur(listing.priceEur)}
              </span>
            </div>
            <div className="price-block price-block--landed">
              <span className="price-block__label">Total landed cost</span>
              <span className="price-block__value">
                {landedCost.totalLandedCostEur !== null ? (
                  formatEur(landedCost.totalLandedCostEur)
                ) : (
                  <IncompleteBadge missing={landedCost.missing} />
                )}
              </span>
            </div>
            <div className="price-block">
              <span className="price-block__label">PT market avg.</span>
              <span className="price-block__value">
                {ptComparison.unknown || ptComparison.marketValueEur === null
                  ? "Unknown"
                  : formatEur(ptComparison.marketValueEur)}
              </span>
            </div>
          </div>

          {/* Discriminated costs shown even when collapsed (§7.1). */}
          <ul className="card__costlines">
            <li>
              <span>ISV</span>
              <span>
                {isv ? formatEur(isv.totalEur) : "—"}
                {isv?.unverified && (
                  <span className="tag tag--warn" title="ISV from draft tables">
                    unverified
                  </span>
                )}
              </span>
            </li>
            {breakdown.vatApplicable && (
              <li>
                <span>VAT</span>
                <span>{formatEur(breakdown.vatEur)}</span>
              </li>
            )}
            <li>
              <span>Transport</span>
              <span>{formatEur(breakdown.transportEur)}</span>
            </li>
            <li>
              <span>Legalisation</span>
              <span>{formatEur(breakdown.legalisationEur)}</span>
            </li>
          </ul>

          {landedCost.missing.length > 0 && (
            <p className="card__missing">
              Missing: {landedCost.missing.join(", ")}
            </p>
          )}

          {isv?.unverified && (
            <p className="warning-strip">
              ⚠ ISV unverified — computed from draft tables. Confirm against the
              Portal das Finanças simulator before relying on this figure.
            </p>
          )}

          <div className="card__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? "Hide breakdown" : "Show full breakdown"}
            </button>
            <a
              className="btn btn--ghost"
              href={listing.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              View listing ↗
            </a>
          </div>
        </div>
      </div>

      {open && (
        <div className="card__detail">
          {/* ISV detail */}
          <section className="detail-section">
            <h4>ISV</h4>
            {isv ? (
              <dl className="detail-grid">
                <dt>Cylinder component</dt>
                <dd>{formatEur(isv.cylinderComponentEur)}</dd>
                <dt>Environmental component</dt>
                <dd>
                  {formatEur(isv.environmentalComponentEur)} ({isv.cycle})
                </dd>
                {isv.particulateSurchargeEur > 0 && (
                  <>
                    <dt>Particulate surcharge</dt>
                    <dd>{formatEur(isv.particulateSurchargeEur)}</dd>
                  </>
                )}
                <dt>Age reduction</dt>
                <dd>{formatPercent(isv.ageReductionFraction)}</dd>
                <dt>Special regime</dt>
                <dd>
                  {SPECIAL_REGIME_LABELS[isv.specialRegime] ?? isv.specialRegime}
                  {isv.specialRegimeReductionFraction > 0 &&
                    ` (−${formatPercent(isv.specialRegimeReductionFraction)})`}
                </dd>
                <dt>Total ISV</dt>
                <dd>
                  <strong>{formatEur(isv.totalEur)}</strong>
                </dd>
                <dt>Tables version</dt>
                <dd>
                  {isv.tablesVersion}
                  {isv.unverified && (
                    <span className="tag tag--warn">unverified</span>
                  )}
                </dd>
              </dl>
            ) : (
              <p className="muted">ISV could not be computed.</p>
            )}
          </section>

          {/* Transport */}
          <section className="detail-section">
            <h4>Transport</h4>
            <dl className="detail-grid">
              <dt>Method</dt>
              <dd>{breakdown.transportMethodLabel ?? "—"}</dd>
              <dt>Value</dt>
              <dd>{formatEur(breakdown.transportEur)}</dd>
            </dl>
          </section>

          {/* Legalisation itemised */}
          <section className="detail-section">
            <h4>Legalisation</h4>
            {breakdown.legalisationItems.length > 0 ? (
              <dl className="detail-grid">
                {breakdown.legalisationItems.map((item) => (
                  <div key={item.key} className="detail-grid__row">
                    <dt>{item.label}</dt>
                    <dd>{formatEurPrecise(item.amountEur)}</dd>
                  </div>
                ))}
                <dt>Total</dt>
                <dd>
                  <strong>{formatEur(breakdown.legalisationEur)}</strong>
                </dd>
              </dl>
            ) : (
              <p className="muted">No legalisation items.</p>
            )}
          </section>

          {/* Annual IUC — shown separately, never folded into landed cost. */}
          <section className="detail-section">
            <h4>Annual IUC</h4>
            <p>
              {landedCost.iuc.annualEur !== null
                ? formatEur(landedCost.iuc.annualEur)
                : `— ${landedCost.iuc.note ? `(${landedCost.iuc.note})` : ""}`}
              {landedCost.iuc.unverified && (
                <span className="tag tag--warn">unverified</span>
              )}
            </p>
          </section>

          {/* PT comparison provenance */}
          <section className="detail-section detail-section--wide">
            <h4>Portuguese market comparison</h4>
            <dl className="detail-grid">
              <dt>Market value</dt>
              <dd>
                {ptComparison.marketValueEur !== null
                  ? formatEur(ptComparison.marketValueEur)
                  : "Unknown"}
              </dd>
              <dt>Sample size</dt>
              <dd>{ptComparison.sampleSize}</dd>
              <dt>Method</dt>
              <dd>{ptComparison.method ?? "—"}</dd>
            </dl>

            {ptComparison.sources.length > 0 && (
              <div className="pt-sources">
                {ptComparison.sources.map((src) => (
                  <span
                    key={src.sourceId}
                    className={`tag ${src.error ? "tag--warn" : ""}`}
                    title={src.error ?? undefined}
                  >
                    {PT_SOURCE_LABELS[src.sourceId] ?? src.sourceId}: {src.sampleSize}
                    {src.error ? " (error)" : ""}
                  </span>
                ))}
              </div>
            )}

            {ptComparison.ratingSignal && (
              <p className="pt-rating">
                Standvirtual rating signal — below market:{" "}
                {ptComparison.ratingSignal.below}, in market:{" "}
                {ptComparison.ratingSignal.in}, above market:{" "}
                {ptComparison.ratingSignal.above}
              </p>
            )}

            {ptComparison.note && (
              <p className="muted">{ptComparison.note}</p>
            )}
          </section>
        </div>
      )}
    </article>
  );
}
