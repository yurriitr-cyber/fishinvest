import { useEffect, useState } from 'react';
import { api, type Fish, type Me } from '../lib/api';
import {
  fishGlyph,
  formatPct,
  formatStars,
  formatSupply,
  pnlClass,
} from '../lib/format';

export function Market({
  me,
  onSelectFish,
}: {
  me: Me;
  onSelectFish: (id: string) => void;
}) {
  const [fish, setFish] = useState<Fish[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.fish();
        if (!cancelled) setFish(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const list = [...fish].sort((a, b) => {
    const ao = a.sortOrder ?? Number(a.currentPrice);
    const bo = b.sortOrder ?? Number(b.currentPrice);
    return ao - bo;
  });

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> Live market
          </div>
          <h1>Rare Fish</h1>
          <p>Limited supply · game credits</p>
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
          <div className="label">Listed</div>
          <div className="value">{fish.length || '—'}</div>
        </div>
      </div>

      <div className="market-head">
        <span>Asset</span>
        <span>Price</span>
        <span>Change</span>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!error && fish.length === 0 && (
        <div className="state-box">
          Loading markets…
          <div className="loading-bar" />
        </div>
      )}

      <div className="list">
        {list.map((f) => {
          const left = f.availableSupply ?? 0;
          const total = f.totalSupply || 1;
          const pct = Math.max(0, Math.min(100, (left / total) * 100));
          return (
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
                  {f.isFrozen ? ' · frozen' : ''}
                  {' · '}
                  {formatSupply(left)} left
                </div>
                <div className="supply-bar" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="row-side">
                <div className="price">{formatStars(f.currentPrice, 2)}</div>
                <div className={`chg ${pnlClass(f.dailyChangePercent)}`}>
                  {formatPct(f.dailyChangePercent)}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="meme">
        Cheap fish move fast. Expensive fish stay calm. Supply is finite.
      </p>
    </div>
  );
}
