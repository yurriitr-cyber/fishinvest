import { useEffect, useState } from 'react';
import { api, type Fish, type Me } from '../lib/api';
import { fishImage, formatPct, formatStars, pnlClass } from '../lib/format';
import { fishName } from '../lib/labels';

const TEASERS = [
  { symbol: 'GLDFSH', name: 'GOLDI' },
  { symbol: 'ASHARK', name: 'ELECTRIC EEL' },
  { symbol: 'MWHALE', name: 'DEEP FEAR' },
] as const;

export function Welcome({ me, onEnter }: { me: Me; onEnter: () => void }) {
  const join = me.referralJoinBonus ? Number(me.referralJoinBonus) : 0;
  const welcome = Number(me.welcomeBonus);
  const total = welcome + join;
  const [live, setLive] = useState<Fish[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.fish();
        if (!cancelled) setLive(data);
      } catch {
        /* keep static teasers */
      }
    }
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const cards = TEASERS.map((teaser) => {
    const row = live.find((f) => f.symbol.toUpperCase() === teaser.symbol);
    return {
      symbol: teaser.symbol,
      name: fishName(teaser.symbol, row?.name || teaser.name),
      price: row?.currentPrice,
      change: row?.dailyChangePercent,
    };
  });

  return (
    <section className="hero">
      <div className="hero-visual">
        <button
          type="button"
          className="welcome-preview"
          onClick={onEnter}
        >
          <span className="welcome-preview-label">Сейчас в листинге</span>
          <div className="welcome-preview-row">
            {cards.map((card, i) => (
              <div className="welcome-card" key={card.symbol} style={{ animationDelay: `${-i * 1.4}s` }}>
                <img src={fishImage(card.symbol)} alt="" />
                <div className="welcome-card-meta">
                  <div className="name">{card.name}</div>
                  <div className="price">
                    {card.price != null ? `${formatStars(card.price, 2)} CR` : '…'}
                  </div>
                  {card.change != null ? (
                    <div className={`chg ${pnlClass(card.change)}`}>
                      {formatPct(card.change)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </button>
      </div>
      <div className="hero-copy">
        <div className="eyebrow">
          <span className="live-dot" /> Рыбный рынок
        </div>
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <p className="lede">
          Инвестируйте в редких рыб и получайте реальную прибыль.
        </p>
        <div className="cta-row welcome-cta">
          <button className="btn btn-ghost" type="button" onClick={onEnter}>
            Старт · {formatStars(total)} CR
            {join > 0 ? ' · реферал' : ''}
          </button>
          <button className="btn btn-primary" type="button" onClick={onEnter}>
            Открыть рынок
          </button>
        </div>
      </div>
    </section>
  );
}
