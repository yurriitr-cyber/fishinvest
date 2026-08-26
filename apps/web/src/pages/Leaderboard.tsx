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
          <h1>Fish Whales</h1>
          <p>Ranked by virtual portfolio value.</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="state-box">Counting whales…</div>}

      {data && (
        <>
          <div className="list">
            {data.leaders.map((row) => (
              <div key={row.userId} className="row" style={{ cursor: 'default' }}>
                <div className="glyph">{row.rank}</div>
                <div className="row-main">
                  <div className="name">
                    {row.displayName}
                    {row.isYou ? ' · you' : ''}
                  </div>
                  <div className="meta">
                    P/L {formatPct(row.profitPercent)}
                  </div>
                </div>
                <div className="row-side">
                  <div className="price">
                    ⭐ {formatStars(row.portfolioValue)}
                  </div>
                  <div className={`chg ${pnlClass(row.totalProfit)}`}>
                    {formatStars(row.totalProfit)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.you && !data.leaders.some((l) => l.isYou) && (
            <>
              <div className="section-title">You</div>
              <div className="row" style={{ cursor: 'default' }}>
                <div className="glyph">{data.you.rank}</div>
                <div className="row-main">
                  <div className="name">{data.you.displayName}</div>
                  <div className="meta">
                    P/L {formatPct(data.you.profitPercent)}
                  </div>
                </div>
                <div className="row-side">
                  <div className="price">
                    ⭐ {formatStars(data.you.portfolioValue)}
                  </div>
                </div>
              </div>
            </>
          )}

          {data.leaders.length === 0 && (
            <div className="state-box">
              No portfolios yet. Buy fish. Become legend.
            </div>
          )}
        </>
      )}
    </div>
  );
}
