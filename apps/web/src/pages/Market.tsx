import { useEffect, useState } from 'react';
import { api, type Fish, type Me } from '../lib/api';
import {
  fishGlyph,
  formatPct,
  formatStars,
  formatSupply,
  pnlClass,
} from '../lib/format';
import { fishName, translateError } from '../lib/labels';
import { MediaSlot } from '../components/MediaSlot';

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
        if (!cancelled) {
          setError(
            translateError(e instanceof Error ? e.message : 'Ошибка'),
          );
        }
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
            <span className="live-dot" /> Живой рынок
          </div>
          <h1>Rare Fish</h1>
          <p>Ограниченный тираж · игровые кредиты</p>
        </div>
        <div className="balance-pill">
          <div className="label">Баланс</div>
          <div className="value">{formatStars(me.balance)} CR</div>
        </div>
      </div>

      <MediaSlot label="Баннер" ratio="21 / 9" />

      <div className="ticker" style={{ marginTop: 14 }}>
        <div className="ticker-card">
          <div className="label">Портфель</div>
          <div className="value">{formatStars(me.portfolioValue)} CR</div>
        </div>
        <div className="ticker-card">
          <div className="label">В листинге</div>
          <div className="value">{fish.length || '—'}</div>
        </div>
      </div>

      <div className="market-head">
        <span>Актив</span>
        <span>Цена</span>
        <span>Изм.</span>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!error && fish.length === 0 && (
        <div className="state-box">
          Загрузка рынка…
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
              {f.imageUrl ? (
                <img className="glyph" src={f.imageUrl} alt="" />
              ) : (
                <MediaSlot className="thumb" label={fishGlyph(f.symbol)} />
              )}
              <div className="row-main">
                <div className="name">{f.symbol}</div>
                <div className="meta">
                  {fishName(f.symbol, f.name)}
                  {f.isFrozen ? ' · фриз' : ''}
                  {' · '}
                  {formatSupply(left)} ост.
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
    </div>
  );
}
