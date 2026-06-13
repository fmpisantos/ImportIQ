import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eur } from '../api.js';

const SOURCE_LABELS = {
  mobilede: 'mobile.de',
  autoscout24: 'AutoScout24',
  autouncle: 'AutoUncle',
};

function SavingBadge({ result }) {
  if (result.incomplete) {
    return <span className="badge incomplete">Incomplete</span>;
  }
  if (result.savingEur == null) return null;
  const saving = result.savingEur >= 0;
  return (
    <span className={`badge ${saving ? 'save' : 'premium'}`}>
      {saving ? '▼ Save ' : '▲ Premium '}
      {eur(Math.abs(result.savingEur))}
      {result.savingPct != null && ` (${saving ? '+' : ''}${result.savingPct}%)`}
    </span>
  );
}

function PtMarketModal({ comparison, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>PT market average — {eur(comparison.avgPriceEur)}</h3>
          <button className="modal-close" type="button" onClick={onClose}>×</button>
        </div>
        <p className="muted">
          Based on {comparison.sampleSize} listings ({comparison.source}).
        </p>
        {comparison.matchedCriteria && (
          <p className="muted">
            Matched on{' '}
            {[
              comparison.matchedCriteria.model,
              comparison.matchedCriteria.fuelType,
              comparison.matchedCriteria.transmission,
            ]
              .filter(Boolean)
              .join(' · ') || 'brand only'}
            , {comparison.criteria?.yearRange?.join('–')}.
          </p>
        )}
        {comparison.lowConfidence && (
          <p className="warn">
            ⚠ Low confidence — fewer than 5 comparable listings matched.
          </p>
        )}
        {comparison.searchUrl && (
          <a href={comparison.searchUrl} target="_blank" rel="noreferrer" className="ext">
            Open this search on OLX.pt ↗
          </a>
        )}
        {comparison.sampleListings?.length > 0 && (
          <ul className="modal-listings">
            {comparison.sampleListings.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">{s.title ?? 'Listing'} ↗</a>
                <span className="modal-price">{eur(s.priceEur)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ResultCard({ result }) {
  const [open, setOpen] = useState(false);
  const [ptModalOpen, setPtModalOpen] = useState(false);
  const { listing, breakdown } = result;
  const isv = breakdown.isv;
  const comparison = result.comparison;
  const hasPtDetails =
    comparison != null &&
    (comparison.sampleListings?.length > 0 || comparison.searchUrl != null);

  return (
    <div className={`result card ${result.incomplete ? 'is-incomplete' : ''}`}>
      <div className="result-head" onClick={() => setOpen((o) => !o)}>
        <img src={listing.thumbnailUrl} alt="" className="thumb" />
        <div className="result-main">
          <div className="result-title">
            {listing.brand} {listing.model} · {listing.year}
            {listing.source && (
              <span className="badge source">{SOURCE_LABELS[listing.source] ?? listing.source}</span>
            )}
          </div>
          <div className="result-sub">
            {listing.mileageKm != null ? `${listing.mileageKm.toLocaleString()} km` : 'mileage n/a'} ·{' '}
            {listing.fuelType ?? 'n/a'} · {listing.transmission ?? 'n/a'}
          </div>
          <div className="result-prices">
            <span>
              German:{' '}
              {listing.url ? (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="price-link"
                  title={`Open the listing on ${SOURCE_LABELS[listing.source] ?? listing.source}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <strong>{eur(listing.priceEur)}</strong> ↗
                </a>
              ) : (
                <strong>{eur(listing.priceEur)}</strong>
              )}
            </span>
            <span className="landed">
              Landed: <strong>{result.incomplete ? '—' : eur(result.totalLandedCostEur)}</strong>
            </span>
            <span>
              PT avg:{' '}
              {hasPtDetails ? (
                <button
                  type="button"
                  className="price-link pt-avg-btn"
                  title="See the PT listings behind this average"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPtModalOpen(true);
                  }}
                >
                  <strong>{eur(comparison.avgPriceEur)}</strong> ▾
                </button>
              ) : (
                <strong>{eur(comparison?.avgPriceEur)}</strong>
              )}
            </span>
          </div>
        </div>
        <div className="result-right">
          <SavingBadge result={result} />
          <button className="expand" type="button">{open ? 'Hide' : 'Details'}</button>
        </div>
      </div>

      {result.incomplete && (
        <div className="incomplete-note">
          {(() => {
            const missing = result.missingConfig ?? [];
            const listingGaps = missing.filter((k) => k.startsWith('listing.'));
            const configGaps = missing.filter((k) => !k.startsWith('listing.'));
            return (
              <>
                {configGaps.length > 0 && (
                  <>
                    Configure: {configGaps.join(', ')} — <Link to="/config">open Configuration</Link>
                    {listingGaps.length > 0 && '. '}
                  </>
                )}
                {listingGaps.length > 0 &&
                  `Listing doesn't publish: ${listingGaps
                    .map((k) => k.replace('listing.', ''))
                    .join(', ')} — ISV can't be computed.`}
              </>
            );
          })()}
        </div>
      )}

      {open && (
        <div className="result-breakdown">
          <div className="bd-col">
            <h4>ISV {isv.exempt && <span className="chip">Exempt</span>}</h4>
            {isv.exempt ? (
              <p className="muted">100% electric — exempt (€0).</p>
            ) : (
              <ul>
                <li>Cylinder component: {eur(isv.cylinderComponent)}</li>
                <li>Environmental ({isv.emissionStandard}): {eur(isv.environmentalComponent)}</li>
                <li>Age reduction: {(isv.ageReductionRate * 100).toFixed(0)}%</li>
                {isv.specialRegime !== 'none' && <li>Regime: {isv.specialRegime}</li>}
                {isv.dieselSurcharge > 0 && <li>Diesel particle surcharge: {eur(isv.dieselSurcharge)}</li>}
                <li className="total">ISV total: <strong>{eur(isv.isv)}</strong></li>
              </ul>
            )}
            {isv.notes?.length > 0 && (
              <ul className="notes">
                {isv.notes.map((n, i) => <li key={i}>⚠️ {n}</li>)}
              </ul>
            )}
          </div>

          <div className="bd-col">
            <h4>Transport & legalisation</h4>
            <ul>
              <li>
                Transport ({breakdown.transport.label ?? 'unset'}): {eur(breakdown.transport.amountEur)}{' '}
                <Link to="/config" className="mini">edit</Link>
              </li>
              {breakdown.legalisation.items.map((i) => (
                <li key={i.key}>{i.label}: {eur(i.amountEur)}</li>
              ))}
              <li className="total">Legalisation total: <strong>{eur(breakdown.legalisation.totalEur)}</strong></li>
            </ul>
          </div>

          <div className="bd-col">
            <h4>Comparison & ownership</h4>
            <ul>
              <li>PT market avg: {eur(comparison?.avgPriceEur)}</li>
              <li className="muted">based on {comparison?.sampleSize ?? 0} listings ({comparison?.source})</li>
              <li>Annual IUC (est.): {eur(breakdown.iuc.annualIucEur)}/yr</li>
            </ul>
            {hasPtDetails && (
              <button type="button" className="ext linkish" onClick={() => setPtModalOpen(true)}>
                View the PT listings behind this average ▾
              </button>
            )}
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noreferrer" className="ext">
                View on {SOURCE_LABELS[listing.source] ?? 'source'} ↗
              </a>
            )}
          </div>
        </div>
      )}

      {ptModalOpen && (
        <PtMarketModal comparison={comparison} onClose={() => setPtModalOpen(false)} />
      )}
    </div>
  );
}
