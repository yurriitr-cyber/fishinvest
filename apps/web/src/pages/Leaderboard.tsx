import { useEffect, useState } from 'react';
import { api, type Leaderboard } from '../lib/api';
import { formatPct, formatStars, pnlClass } from '../lib/format';
import { translateError } from '../lib/labels';

export function LeaderboardPage() {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboard()
      .then(setData)
      .catch((e) =>
        setError(translateError(e instanceof Error ? e.message : 'Ошибка')),
      );
  }, []);

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Рейтинг</div>
          <h1>Киты</h1>
          <p>Ранг по стоимости портфеля</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && (
        <div className="state-box">
          Загрузка рейтинга…
          <div className="loading-bar" />
        </div>
      )}

      {data && (
        <>
          <div className="market-head">
            <span>Трейдер</span>
            <span>Капитал</span>
            <span>P/L</span>
          </div>
          <div className="list">
            {data.leaders.map((row) => (
              <div key={row.userId} className="row" style={{ cursor: 'default' }}>
                <div className="glyph rank">{row.rank}</div>
                <div className="row-main">
                  <div className="name">
                    {row.displayName}
                    {row.isYou ? ' · вы' : ''}
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
              <div className="section-title">Ваш ранг</div>
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
            <div className="state-box">
              Портфелей пока нет. Торгуйте, чтобы подняться.
            </div>
          )}
        </>
      )}
    </div>
  );
}
