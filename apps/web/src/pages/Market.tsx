import { useEffect, useMemo, useState } from 'react';
import { api, type Fish, type Me } from '../lib/api';
import { fishGlyph, formatPct, formatStars, pnlClass } from '../lib/format';

const MEMES = [
  'Someone bought 400 Arowanas. Nobody knows why. Bullish.',
  'Quantum Koi slipped. Scientists refuse to comment.',
  'A whale entered the tank. We don’t know which fish.',
  'Prices move. Feelings move faster.',
];

export function Market({
  me,
  onSelectFish,
}: {
  me: Me;
  onSelectFish: (id: string) => void;
}) {
  const [fish, setFish] = useState<Fish[]>([]);
  const [error, setError] = useState<string | null>(null);
  const meme = useMemo(
    () => MEMES[Math.floor(Math.random() * MEMES.length)],
    [],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .fish()
      .then((data) => {
        if (!cancelled) setFish(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const movers = [...fish].sort(
    (a, b) =>
      Math.abs(Number(b.dailyChangePercent)) -
      Math.abs(Number(a.dailyChangePercent)),
  );

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>Rare Fish Market</h1>
          <p>Virtual prices. Real vibes.</p>
        </div>
        <div className="stat-stack">
          <div className="label">Game balance</div>
          <div className="value">⭐ {formatStars(me.balance)}</div>
        </div>
      </div>

      <div className="summary">
        <div className="summary-item">
          <div className="label">Portfolio</div>
          <div className="value">⭐ {formatStars(me.portfolioValue)}</div>
        </div>
        <div className="summary-item">
          <div className="label">Listed fish</div>
          <div className="value">{fish.length}</div>
        </div>
      </div>

      <div className="section-title">Top movers</div>
      {error && <div className="error-box">{error}</div>}
      {!error && fish.length === 0 && (
        <div className="state-box">Loading the aquarium…</div>
      )}

      <div className="list">
        {movers.map((f) => (
          <button
            key={f.id}
            className="row"
            type="button"
            onClick={() => onSelectFish(f.id)}
          >
            <div className="glyph">{fishGlyph(f.symbol)}</div>
            <div className="row-main">
              <div className="name">{f.name}</div>
              <div className="meta">
                {f.symbol} · {f.rarity}
                {f.isFrozen ? ' · FROZEN' : ''}
              </div>
            </div>
            <div className="row-side">
              <div className="price">⭐ {formatStars(f.currentPrice)}</div>
              <div className={`chg ${pnlClass(f.dailyChangePercent)}`}>
                {formatPct(f.dailyChangePercent)}
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="meme">🚨 {meme}</p>
    </div>
  );
}
