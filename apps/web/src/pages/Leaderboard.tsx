import { useEffect, useState } from 'react';
import { api, type Leaderboard } from '../lib/api';
import { formatPct, formatStars, pnlClass } from '../lib/format';

export function LeaderboardPage() {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Leaderboard</div>
          <h1>Whales</h1>
          <p>Ranked by portfolio equity</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && (
        <div className="state-box">
          Loading rankings…
          <div className="loading-bar" />
        </div>
      )}

      {data && (
        <>
          <div className="market-head">
            <span>Trader</span>
            <span>Equity</span>
            <span>P/L</span>
          </div>
          <div className="list">
            {data.leaders.map((row) => (
              <div key={row.userId} className="row" style={{ cursor: 'default' }}>
                <div className="glyph rank">{row.rank}</div>
                <div className="row-main">
                  <div className="name">
                    {row.displayName}
                    {row.isYou ? ' · you' : ''}
                  </div>
                  <div className="meta">P/L {formatPct(row.profitPercent)}</div>
                </div>
                <div className="row-side">
                  <div className="price">
                    {formatStars(row.portfolioValue, 0)}
                  </div>
                  <div className={`chg ${pnlClass(row.totalProfit)}`}>
                    {formatStars(row.totalProfit, 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.you && !data.leaders.some((l) => l.isYou) && (
            <>
              <div className="section-title">Your rank</div>
              <div className="row" style={{ cursor: 'default' }}>
                <div className="glyph rank">{data.you.rank}</div>
                <div className="row-main">
                  <div className="name">{data.you.displayName}</div>
                  <div className="meta">
                    P/L {formatPct(data.you.profitPercent)}
                  </div>
                </div>
                <div className="row-side">
                  <div className="price">
                    {formatStars(data.you.portfolioValue, 0)}
                  </div>
                </div>
              </div>
            </>
          )}

          {data.leaders.length === 0 && (
            <div className="state-box">No portfolios yet. Trade to climb.</div>
          )}
        </>
      )}
    </div>
  );
}
