import { useEffect, useMemo, useState } from 'react';
import { api, type Fish } from '../lib/api';
import { fishGlyph, formatPct, formatStars, pnlClass } from '../lib/format';

export function Trade({
  fishId,
  balance,
  onBack,
  onTraded,
  notify,
}: {
  fishId: string;
  balance: string;
  onBack: () => void;
  onTraded: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const [fish, setFish] = useState<Fish | null>(null);
  const [qty, setQty] = useState('1');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fishOne(fishId).then(setFish).catch((e) => setError(e.message));
  }, [fishId]);

  const quantity = Number(qty) || 0;
  const total = useMemo(() => {
    if (!fish) return 0;
    return Number(fish.currentPrice) * quantity;
  }, [fish, quantity]);

  async function submit() {
    if (!fish || quantity <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const key = `${side}:${fish.id}:${Date.now()}`;
      if (side === 'buy') await api.buy(fish.id, quantity, key);
      else await api.sell(fish.id, quantity, key);
      await onTraded();
      notify(
        side === 'buy'
          ? `Bought ${quantity} ${fish.symbol}`
          : `Sold ${quantity} ${fish.symbol}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trade failed');
    } finally {
      setBusy(false);
    }
  }

  if (!fish && !error) {
    return (
      <div className="state-box">
        Loading pair…
        <div className="loading-bar" />
      </div>
    );
  }

  return (
    <div className="screen">
      <button className="chip ghost-back" type="button" onClick={onBack}>
        ← Markets
      </button>

      {error && <div className="error-box">{error}</div>}

      {fish && (
        <>
          <div className="topbar">
            <div>
              <div className="eyebrow">{fish.rarity}</div>
              <h1>
                {fishGlyph(fish.symbol)} {fish.symbol}
              </h1>
              <p>{fish.name}</p>
            </div>
            <div className="balance-pill">
              <div className="label">Available</div>
              <div className="value">⭐ {formatStars(balance)}</div>
            </div>
          </div>

          <div className="price-hero mono">
            {formatStars(fish.currentPrice, 2)}
            <span className={`chg ${pnlClass(fish.dailyChangePercent)}`}>
              {formatPct(fish.dailyChangePercent)}
            </span>
          </div>

          <div className="ticker">
            <div className="ticker-card">
              <div className="label">ATH</div>
              <div className="value">{formatStars(fish.allTimeHigh, 2)}</div>
            </div>
            <div className="ticker-card">
              <div className="label">ATL</div>
              <div className="value">{formatStars(fish.allTimeLow, 2)}</div>
            </div>
          </div>

          <div className="trade-panel">
            <div className="side-toggle">
              <button
                className={`buy ${side === 'buy' ? 'active' : ''}`}
                type="button"
                onClick={() => setSide('buy')}
              >
                Buy
              </button>
              <button
                className={`sell ${side === 'sell' ? 'active' : ''}`}
                type="button"
                onClick={() => setSide('sell')}
              >
                Sell
              </button>
            </div>

            <div className="section-title" style={{ marginTop: 0 }}>
              Quantity
            </div>
            <div className="qty-row">
              <input
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="qty-presets">
              {['1', '5', '10', '25'].map((n) => (
                <button
                  key={n}
                  className={`chip ${qty === n ? 'active' : ''}`}
                  type="button"
                  onClick={() => setQty(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="summary">
              <div className="summary-item">
                <div className="label">Total</div>
                <div className="value">⭐ {formatStars(total, 2)}</div>
              </div>
              <div className="summary-item">
                <div className="label">Est. fill</div>
                <div className="value">
                  {formatStars(fish.currentPrice, 2)} × {quantity || 0}
                </div>
              </div>
            </div>

            <button
              className={`btn ${side === 'buy' ? 'btn-buy' : 'btn-sell'}`}
              type="button"
              disabled={busy || fish.isFrozen || quantity <= 0}
              onClick={submit}
            >
              {busy
                ? 'Submitting…'
                : `${side === 'buy' ? 'Buy' : 'Sell'} ${fish.symbol}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
