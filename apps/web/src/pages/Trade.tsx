import { useEffect, useMemo, useState } from 'react';
import { MediaSlot } from '../components/MediaSlot';
import { PriceChart } from '../components/PriceChart';
import { api, type Fish } from '../lib/api';
import {
  fishGlyph,
  formatPct,
  formatStars,
  formatSupply,
  pnlClass,
} from '../lib/format';
import { fishLore } from '../lib/fishLore';

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
    let cancelled = false;
    async function load() {
      try {
        const data = await api.fishOne(fishId);
        if (!cancelled) setFish(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fishId]);

  const quantity = Math.floor(Number(qty)) || 0;
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
      const refreshed = await api.fishOne(fish.id);
      setFish(refreshed);
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

  const soldOut = fish ? fish.availableSupply <= 0 : false;

  return (
    <div className="screen">
      <button className="chip ghost-back" type="button" onClick={onBack}>
        ← Markets
      </button>

      {error && <div className="error-box">{error}</div>}

      {fish && (
        <>
          <div className="topbar">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {fish.imageUrl ? (
                <img
                  className="glyph"
                  src={fish.imageUrl}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: 12 }}
                />
              ) : (
                <MediaSlot className="thumb" label={fishGlyph(fish.symbol)} />
              )}
              <div>
                <div className="eyebrow">{fish.rarity}</div>
                <h1>{fish.symbol}</h1>
                <p>{fish.name}</p>
              </div>
            </div>
            <div className="balance-pill">
              <div className="label">Balance</div>
              <div className="value">{formatStars(balance)} CR</div>
            </div>
          </div>

          <div className="fish-lore">
            <div className="eyebrow">О рыбе</div>
            <p>{fishLore(fish.symbol)}</p>
          </div>

          <div className="price-hero mono">
            {formatStars(fish.currentPrice, 2)}
            <span className={`chg ${pnlClass(fish.dailyChangePercent)}`}>
              {formatPct(fish.dailyChangePercent)}
            </span>
          </div>
          <p className="supply-meta">
            {formatSupply(fish.availableSupply)} / {formatSupply(fish.totalSupply)}{' '}
            available
            {soldOut ? ' · sold out' : ''}
          </p>

          <PriceChart
            fishId={fish.id}
            livePrice={fish.currentPrice}
            volatility={fish.volatility}
          />

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
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
              />
            </div>
            <div className="qty-presets">
              {['1', '5', '10', '25', '100'].map((n) => (
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
                <div className="value">{formatStars(total, 2)} CR</div>
              </div>
              <div className="summary-item">
                <div className="label">Fill</div>
                <div className="value">
                  {formatStars(fish.currentPrice, 2)} × {quantity || 0}
                </div>
              </div>
            </div>

            <button
              className={`btn ${side === 'buy' ? 'btn-buy' : 'btn-sell'}`}
              type="button"
              disabled={
                busy ||
                fish.isFrozen ||
                quantity <= 0 ||
                (side === 'buy' && soldOut)
              }
              onClick={submit}
            >
              {busy
                ? 'Submitting…'
                : side === 'buy' && soldOut
                  ? 'Sold out'
                  : `${side === 'buy' ? 'Buy' : 'Sell'} ${fish.symbol}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
