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
          ? `Bought ${quantity} ${fish.symbol}. You're in the tank now.`
          : `Sold ${quantity} ${fish.symbol}. Cash is a feeling.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trade failed');
    } finally {
      setBusy(false);
    }
  }

  if (!fish && !error) {
    return <div className="state-box">Loading fish…</div>;
  }

  return (
    <div className="screen">
      <button className="chip" type="button" onClick={onBack}>
        ← Market
      </button>

      {error && <div className="error-box">{error}</div>}

      {fish && (
        <>
          <div className="topbar" style={{ marginTop: 14 }}>
            <div>
              <h1>
                {fishGlyph(fish.symbol)} {fish.name}
              </h1>
              <p>
                {fish.symbol} · {fish.rarity}
              </p>
            </div>
            <div className="stat-stack">
              <div className="label">Price</div>
              <div className="value">⭐ {formatStars(fish.currentPrice)}</div>
              <div className={`chg ${pnlClass(fish.dailyChangePercent)}`}>
                {formatPct(fish.dailyChangePercent)}
              </div>
            </div>
          </div>

          <div className="summary">
            <div className="summary-item">
              <div className="label">ATH</div>
              <div className="value">⭐ {formatStars(fish.allTimeHigh)}</div>
            </div>
            <div className="summary-item">
              <div className="label">ATL</div>
              <div className="value">⭐ {formatStars(fish.allTimeLow)}</div>
            </div>
          </div>

          <div className="trade-panel">
            <div className="qty-presets">
              <button
                className={`chip ${side === 'buy' ? 'active' : ''}`}
                type="button"
                onClick={() => setSide('buy')}
              >
                Buy
              </button>
              <button
                className={`chip ${side === 'sell' ? 'active' : ''}`}
                type="button"
                onClick={() => setSide('sell')}
              >
                Sell
              </button>
            </div>

            <div className="section-title">Quantity</div>
            <div className="qty-row">
              <input
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="qty-presets">
              {['1', '5', '10'].map((n) => (
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
                <div className="value">⭐ {formatStars(total)}</div>
              </div>
              <div className="summary-item">
                <div className="label">Your balance</div>
                <div className="value">⭐ {formatStars(balance)}</div>
              </div>
            </div>

            <button
              className="btn btn-solid"
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
