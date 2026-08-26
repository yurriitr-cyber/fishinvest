import { useEffect, useMemo, useState } from 'react';
import { api, type Fish, type Me } from '../lib/api';
import { fishGlyph, formatPct, formatStars, pnlClass } from '../lib/format';

const MEMES = [
  'Arowana volume spike. Nobody knows why.',
  'Quantum Koi dipped. Scientists offline.',
  'Whale entered the tank. Species unknown.',
  '24h movers: feelings faster than price.',
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
          <div className="eyebrow">
            <span className="live-dot" /> Markets
          </div>
          <h1>Rare Fish</h1>
          <p>Spot · game credits</p>
        </div>
        <div className="balance-pill">
          <div className="label">Balance</div>
          <div className="value">⭐ {formatStars(me.balance)}</div>
        </div>
      </div>

      <div className="ticker">
        <div className="ticker-card">
          <div className="label">Portfolio</div>
          <div className="value">⭐ {formatStars(me.portfolioValue)}</div>
        </div>
        <div className="ticker-card">
          <div className="label">Pairs</div>
          <div className="value">{fish.length || '—'}</div>
        </div>
      </div>

      <div className="market-head">
        <span>Name</span>
        <span>Last price</span>
        <span>24h %</span>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!error && fish.length === 0 && (
        <div className="state-box">
          Loading markets…
          <div className="loading-bar" />
        </div>
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
              <div className="name">{f.symbol}</div>
              <div className="meta">
                {f.name}
                {f.isFrozen ? ' · FROZEN' : ''}
              </div>
            </div>
            <div className="row-side">
              <div className="price">{formatStars(f.currentPrice, 2)}</div>
              <div className={`chg ${pnlClass(f.dailyChangePercent)}`}>
                {formatPct(f.dailyChangePercent)}
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="meme">⚡ {meme}</p>
    </div>
  );
}
