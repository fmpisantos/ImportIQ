import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Test bench for the fuzzy vehicle matcher: type any free-text string and see the
// ranked brand+model (+submodel) it resolves to. Deliberately tolerant — it always
// returns the closest matches, never requiring an exact hit, so non-matching words
// (year, fuel, mileage, typos) are fine.
const EXAMPLES = [
  'mercedez benz c220 amg 2019',
  'vw gold gti',
  'bmw 320d touring diesel 120000km',
  'audo a4 avant',
  'porsh 911 turbo s',
  'tesla model 3 long range',
];

const PCT = (n) => `${Math.round((n ?? 0) * 100)}%`;

export default function MatchPage() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    api.getVehicleStats().then(setStats).catch(() => {});
  }, []);

  // Debounced live matching: re-query 200ms after the last keystroke.
  useEffect(() => {
    clearTimeout(timer.current);
    const query = q.trim();
    if (!query) {
      setRes(null);
      setError(null);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setBusy(true);
        setError(null);
        setRes(await api.matchVehicle(query, 8));
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q]);

  const best = res?.best;

  return (
    <div className="page match-page">
      <h2>Vehicle Matcher</h2>
      <p className="muted">
        Type any free-text car description — brand, model, trim, plus noise like year,
        fuel or mileage. The fuzzy matcher resolves it to the closest known
        <strong> brand → model → submodel</strong> in the catalog. It returns the best
        match, not an exact one, so typos and extra words are fine.
        {stats && (
          <>
            {' '}Matching against <strong>{stats.brands.toLocaleString()}</strong> brands and{' '}
            <strong>{stats.models.toLocaleString()}</strong> models, built from public datasets
            (US year-indexed set + Wikidata) covering 2010+ cars.
          </>
        )}
      </p>

      <input
        className="match-input"
        autoFocus
        placeholder="e.g. mercedez benz c220 amg 2019"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="match-examples">
        <span className="muted small">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="pill" onClick={() => setQ(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      {best && (
        <div className="card match-best">
          <div className="muted small">Best match {busy && '· …'}</div>
          <div className="match-best-title">
            {best.brand} <span className="match-arrow">›</span> {best.model}
            {best.submodel && (
              <>
                {' '}
                <span className="match-arrow">›</span> <span className="match-sub">{best.submodel}</span>
              </>
            )}
          </div>
          <div className="match-meta">
            <ConfidenceBadge confidence={best.confidence} score={best.score} />
            <span className="muted small">
              brand {PCT(best.breakdown.brand)} · model {PCT(best.breakdown.model)}
              {best.breakdown.submodel != null && ` · submodel ${PCT(best.breakdown.submodel)}`}
            </span>
          </div>
        </div>
      )}

      {res && res.matches.length > 1 && (
        <table className="match-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Brand</th>
              <th>Model</th>
              <th>Submodel</th>
              <th>Score</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {res.matches.map((m, i) => (
              <tr key={`${m.brand}-${m.model}`} className={i === 0 ? 'is-best' : ''}>
                <td className="muted">{i + 1}</td>
                <td>{m.brand}</td>
                <td>{m.model}</td>
                <td className="muted">{m.submodel ?? '—'}</td>
                <td>
                  <ScoreBar score={m.score} />
                </td>
                <td>
                  <ConfidenceBadge confidence={m.confidence} score={m.score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {res && res.matches.length === 0 && (
        <p className="muted">No candidates — try adding a brand or model name.</p>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }) {
  return <span className={`match-conf ${confidence}`}>{confidence}</span>;
}

function ScoreBar({ score }) {
  return (
    <span className="score-bar" title={PCT(score)}>
      <span className="score-bar-fill" style={{ width: PCT(score) }} />
      <span className="score-bar-num">{PCT(score)}</span>
    </span>
  );
}
