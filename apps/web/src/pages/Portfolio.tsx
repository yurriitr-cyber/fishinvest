import { useEffect, useState } from 'react';
import { api, type Me, type Portfolio } from '../lib/api';
import { fishGlyph, formatPct, formatStars, pnlClass } from '../lib/format';

export function PortfolioPage({
  me,
  onSelectFish,
}: {
  me: Me;
  onSelectFish: (id: string) => void;
}) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .portfolio()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [me.balance, me.portfolioValue]);

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>My Portfolio</h1>
          <p>Virtual P/L on simulated fish.</p>
        </div>
        <div className="stat-stack">
          <div className="label">Cash</div>
          <div className="value">⭐ {formatStars(me.balance)}</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && (
        <>
          <div className="summary">
            <div className="summary-item">
              <div className="label">Value</div>
              <div className="value">⭐ {formatStars(data.currentValue)}</div>
            </div>
            <div className="summary-item">
              <div className="label">Invested</div>
              <div className="value">⭐ {formatStars(data.totalInvested)}</div>
            </div>
            <div className="summary-item">
              <div className="label">Unrealized</div>
              <div className={`value ${pnlClass(data.unrealizedPnl)}`}>
                {formatStars(data.unrealizedPnl)} (
                {formatPct(data.unrealizedPnlPercent)})
              </div>
            </div>
            <div className="summary-item">
              <div className="label">Realized</div>
              <div className={`value ${pnlClass(data.realizedPnl)}`}>
                ⭐ {formatStars(data.realizedPnl)}
              </div>
            </div>
          </div>

          <div className="section-title">Positions</div>
          {data.positions.length === 0 && (
            <div className="state-box">
              Empty tank. Buy something weird on the market.
            </div>
          )}
          <div className="list">
            {data.positions.map((p) => (
              <button
                key={p.fishId}
                className="row"
                type="button"
                onClick={() => onSelectFish(p.fishId)}
              >
                <div className="glyph">{fishGlyph(p.symbol)}</div>
                <div className="row-main">
                  <div className="name">{p.name}</div>
                  <div className="meta">
                    {p.quantity} · avg ⭐ {formatStars(p.avgBuyPrice)}
                  </div>
                </div>
                <div className="row-side">
                  <div className="price">⭐ {formatStars(p.currentValue)}</div>
                  <div className={`chg ${pnlClass(p.unrealizedPnl)}`}>
                    {formatPct(p.unrealizedPnlPercent)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
