import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, eur } from '../api.js';

const SOURCE_LABELS = {
  mobilede: 'mobile.de',
  autoscout24: 'AutoScout24',
  autouncle: 'AutoUncle',
};

const METHOD_LABELS = {
  'mileage-regression': 'mileage-adjusted',
  median: 'median',
  mean: 'mean',
};

// Caveats that should keep a result out of the clean green "deal" badge: VAT on
// a nearly-new import, or an implausibly-low German price.
function cautionNotes(result) {
  const notes = [];
  const vat = result.breakdown?.vat;
  if (vat?.applicable) {
    notes.push(
      `+${vat.vatRatePct}% IVA likely due (≈ ${eur(vat.vatEur)}) on this nearly-new import — ${vat.reasons.join('; ')}. Already included in the landed cost above.`
    );
  } else if (vat?.suspect) {
    notes.push(
      `IVA (23%) may be due — ${vat.reasons.join('; ')}. Not added to the total; verify before trusting the saving.`
    );
  }
  if (result.germanPriceSuspicious) notes.push(...(result.germanPriceNotes ?? []));
  return notes;
}

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
        {comparison.marketValueEur != null &&
          comparison.marketValueMethod &&
          comparison.marketValueMethod !== 'none' && (
            <p className="muted">
              Estimate used: <strong>{eur(comparison.marketValueEur)}</strong> (
              {METHOD_LABELS[comparison.marketValueMethod] ?? comparison.marketValueMethod}
              {comparison.medianPriceEur != null && `; median ${eur(comparison.medianPriceEur)}`})
            </p>
          )}
        {comparison.sources?.length > 0 && (
          <p className="muted">
            Sources:{' '}
            {comparison.sources
              .map((s) => `${s.source} (${s.sampleSize}${s.error ? ', failed' : ''})`)
              .join(' · ')}
          </p>
        )}
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

export default function ResultCard({ result: incomingResult }) {
  const [open, setOpen] = useState(false);
  const [ptModalOpen, setPtModalOpen] = useState(false);
  // Local copy so a per-listing emission-standard override re-costs this card in
  // place. Reset whenever the parent hands us a new result (new search / page).
  const [result, setResult] = useState(incomingResult);
  const [recomputing, setRecomputing] = useState(false);
  const [standardOverridden, setStandardOverridden] = useState(false);
  const [recomputeError, setRecomputeError] = useState(null);
  useEffect(() => {
    setResult(incomingResult);
    setStandardOverridden(false);
    setRecomputeError(null);
  }, [incomingResult]);

  const changeEmissionStandard = async (standard) => {
    if (recomputing || standard === result.breakdown.isv.emissionStandard) return;
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const { result: updated } = await api.recompute(result, standard);
      setResult(updated);
      setStandardOverridden(true);
    } catch (e) {
      setRecomputeError(e.message);
    } finally {
      setRecomputing(false);
    }
  };

  const { listing, breakdown } = result;
  const isv = breakdown.isv;
  const comparison = result.comparison;
  const hasPtDetails =
    comparison != null &&
    (comparison.sampleListings?.length > 0 || comparison.searchUrl != null);
  const cautions = result.incomplete ? [] : cautionNotes(result);

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
              PT asking avg:{' '}
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
          {cautions.length > 0 && <span className="badge caution">⚠ Verify</span>}
          <button className="expand" type="button">{open ? 'Hide' : 'Details'}</button>
        </div>
      </div>

      {cautions.length > 0 && (
        <div className="caution-note">
          {cautions.map((n, i) => (
            <div key={i}>⚠️ {n}</div>
          ))}
        </div>
      )}

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
                {!isv.unavailable && (
                  <li className="emission-standard">
                    <span className="muted">Emission standard:</span>{' '}
                    {['WLTP', 'NEDC'].map((std) => (
                      <button
                        key={std}
                        type="button"
                        className={`std-toggle ${isv.emissionStandard === std ? 'active' : ''}`}
                        disabled={recomputing}
                        onClick={() => changeEmissionStandard(std)}
                        title={`Re-cost ISV using the ${std} environmental table`}
                      >
                        {std}
                      </button>
                    ))}
                    {recomputing ? (
                      <span className="muted"> recomputing…</span>
                    ) : standardOverridden ? (
                      <span className="muted"> · confirmed</span>
                    ) : (
                      listing.emissionStandardInferred && (
                        <span className="muted" title="Inferred from the registration date — confirm if you know which standard applies">
                          {' '}· inferred
                        </span>
                      )
                    )}
                    {recomputeError && <span className="warn"> · {recomputeError}</span>}
                  </li>
                )}
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
              {breakdown.vat?.applicable && (
                <li className="total">
                  IVA ({breakdown.vat.vatRatePct}%, nearly-new): <strong>{eur(breakdown.vat.vatEur)}</strong>
                </li>
              )}
            </ul>
          </div>

          <div className="bd-col">
            <h4>Comparison & ownership</h4>
            <ul>
              <li>PT asking avg: {eur(comparison?.avgPriceEur)}</li>
              {comparison?.marketValueEur != null &&
                comparison.marketValueMethod &&
                comparison.marketValueMethod !== 'mean' && (
                  <li>
                    Estimate ({METHOD_LABELS[comparison.marketValueMethod] ?? comparison.marketValueMethod}):{' '}
                    {eur(comparison.marketValueEur)}
                  </li>
                )}
              <li className="muted">based on {comparison?.sampleSize ?? 0} listings ({comparison?.source})</li>
              {result.estimatedResaleEur != null && (
                <li>
                  Est. resale (−{result.resaleHaircutPct}%): {eur(result.estimatedResaleEur)} →{' '}
                  <strong>margin {eur(result.marginEur)}</strong>
                  {result.marginPct != null && ` (${result.marginPct}%)`}
                </li>
              )}
              <li>Annual IUC: {eur(breakdown.iuc.annualIucEur)}/yr</li>
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
