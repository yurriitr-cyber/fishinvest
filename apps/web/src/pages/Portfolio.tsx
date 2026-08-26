import { useEffect, useState } from 'react';
import { api, type Me, type Portfolio } from '../lib/api';
import { MediaSlot } from '../components/MediaSlot';
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
          <div className="eyebrow">Overview</div>
          <h1>Assets</h1>
          <p>Positions · unrealized P/L</p>
        </div>
        <div className="balance-pill">
          <div className="label">Cash</div>
          <div className="value">{formatStars(me.balance)} CR</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && (
        <>
          <div className="ticker">
            <div className="ticker-card">
              <div className="label">Equity</div>
              <div className="value">{formatStars(data.currentValue)} CR</div>
            </div>
            <div className="ticker-card">
              <div className="label">Invested</div>
              <div className="value">{formatStars(data.totalInvested)} CR</div>
            </div>
          </div>

          <div className="summary">
            <div className="summary-item">
              <div className="label">Unrealized</div>
              <div className={`value ${pnlClass(data.unrealizedPnl)}`}>
                {formatStars(data.unrealizedPnl)} ·{' '}
                {formatPct(data.unrealizedPnlPercent)}
              </div>
            </div>
            <div className="summary-item">
              <div className="label">Realized</div>
              <div className={`value ${pnlClass(data.realizedPnl)}`}>
                {formatStars(data.realizedPnl)} CR
              </div>
            </div>
          </div>

          <div className="section-title">Positions</div>
          <div className="market-head">
            <span>Asset</span>
            <span>Value</span>
            <span>P/L</span>
          </div>

          {data.positions.length === 0 && (
            <div className="state-box">No open positions. Buy on Markets.</div>
          )}
          <div className="list">
            {data.positions.map((p) => (
              <button
                key={p.fishId}
                className="row"
                type="button"
                onClick={() => onSelectFish(p.fishId)}
              >
                <MediaSlot className="thumb" label={fishGlyph(p.symbol)} />
                <div className="row-main">
                  <div className="name">{p.symbol}</div>
                  <div className="meta">
                    qty {p.quantity} · avg {formatStars(p.avgBuyPrice, 2)}
                  </div>
                </div>
                <div className="row-side">
                  <div className="price">{formatStars(p.currentValue, 2)}</div>
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
