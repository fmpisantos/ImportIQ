import { useState } from 'react';
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

export default function ResultCard({ result }) {
  const [open, setOpen] = useState(false);
  const { listing, breakdown } = result;
  const isv = breakdown.isv;

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
            <span>German: <strong>{eur(listing.priceEur)}</strong></span>
            <span className="landed">
              Landed: <strong>{result.incomplete ? '—' : eur(result.totalLandedCostEur)}</strong>
            </span>
            <span>PT avg: <strong>{eur(result.comparison?.avgPriceEur)}</strong></span>
          </div>
        </div>
        <div className="result-right">
          <SavingBadge result={result} />
          <button className="expand" type="button">{open ? 'Hide' : 'Details'}</button>
        </div>
      </div>

      {result.incomplete && (
        <div className="incomplete-note">
          Configure: {result.missingConfig.join(', ')} —{' '}
          <Link to="/config">open Configuration</Link>
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
              <li>PT market avg: {eur(result.comparison?.avgPriceEur)}</li>
              <li className="muted">based on {result.comparison?.sampleSize ?? 0} listings ({result.comparison?.source})</li>
              <li>Annual IUC (est.): {eur(breakdown.iuc.annualIucEur)}/yr</li>
            </ul>
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noreferrer" className="ext">
                View on {SOURCE_LABELS[listing.source] ?? 'source'} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
