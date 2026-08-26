import { useEffect, useState } from 'react';
import { api, type Me, type Portfolio } from '../lib/api';
import { MediaSlot } from '../components/MediaSlot';
import { fishGlyph, formatPct, formatStars, pnlClass } from '../lib/format';
import { translateError } from '../lib/labels';

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
      .catch((e) =>
        setError(
          translateError(e instanceof Error ? e.message : 'Ошибка'),
        ),
      );
  }, [me.balance, me.portfolioValue]);

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Обзор</div>
          <h1>Активы</h1>
          <p>Позиции · нереализ. P/L</p>
        </div>
        <div className="balance-pill">
          <div className="label">Кэш</div>
          <div className="value">{formatStars(me.balance)} CR</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {data && (
        <>
          <div className="ticker">
            <div className="ticker-card">
              <div className="label">Капитал</div>
              <div className="value">{formatStars(data.currentValue)} CR</div>
            </div>
            <div className="ticker-card">
              <div className="label">Вложено</div>
              <div className="value">{formatStars(data.totalInvested)} CR</div>
            </div>
          </div>

          <div className="summary">
            <div className="summary-item">
              <div className="label">Нереализ.</div>
              <div className={`value ${pnlClass(data.unrealizedPnl)}`}>
                {formatStars(data.unrealizedPnl)} ·{' '}
                {formatPct(data.unrealizedPnlPercent)}
              </div>
            </div>
            <div className="summary-item">
              <div className="label">Реализ.</div>
              <div className={`value ${pnlClass(data.realizedPnl)}`}>
                {formatStars(data.realizedPnl)} CR
              </div>
            </div>
          </div>

          <div className="section-title">Позиции</div>
          <div className="market-head">
            <span>Актив</span>
            <span>Стоим.</span>
            <span>P/L</span>
          </div>

          {data.positions.length === 0 && (
            <div className="state-box">
              Нет открытых позиций. Купите на рынке.
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
                {p.imageUrl ? (
                  <img className="glyph" src={p.imageUrl} alt="" />
                ) : (
                  <MediaSlot className="thumb" label={fishGlyph(p.symbol)} />
                )}
                <div className="row-main">
                  <div className="name">{p.symbol}</div>
                  <div className="meta">
                    кол-во {p.quantity} · ср. {formatStars(p.avgBuyPrice, 2)}
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
