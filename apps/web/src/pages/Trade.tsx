import { useEffect, useMemo, useState } from 'react';
import { PriceChart } from '../components/PriceChart';
import { api, type Fish } from '../lib/api';
import {
  fishImage,
  formatPct,
  formatStars,
  formatSupply,
  pnlClass,
} from '../lib/format';
import { fishLore } from '../lib/fishLore';
import { fishName, rarityLabel, translateError } from '../lib/labels';
import { hapticImpact, hapticNotify } from '../lib/telegram';
import { useVisibleInterval } from '../lib/perf';

function formatQty(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

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
  const [ownedQty, setOwnedQty] = useState(0);
  const [qty, setQty] = useState('1');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSellAll, setConfirmSellAll] = useState(false);
  const [friends, setFriends] = useState<
    Array<{ id: string; username: string | null; firstName: string | null }>
  >([]);
  const [partnerId, setPartnerId] = useState('');
  const [partnerUsername, setPartnerUsername] = useState('');
  const [jointMode, setJointMode] = useState(false);

  useEffect(() => {
    api
      .jointFriends()
      .then((list) => {
        setFriends(list);
        if (list.length === 1) setPartnerId(list[0].id);
      })
      .catch(() => setFriends([]));
  }, []);

  async function refreshOwned() {
    try {
      const portfolio = await api.portfolio();
      const position = portfolio.positions.find(
        (p) => p.fishId === fishId && !p.joint,
      );
      setOwnedQty(Math.floor(Number(position?.quantity ?? 0)) || 0);
    } catch {
      /* keep previous */
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [data, portfolio] = await Promise.all([
          api.fishOne(fishId),
          api.portfolio(),
        ]);
        if (cancelled) return;
        setFish(data);
        const position = portfolio.positions.find(
          (p) => p.fishId === fishId && !p.joint,
        );
        setOwnedQty(Math.floor(Number(position?.quantity ?? 0)) || 0);
      } catch (e) {
        if (!cancelled) {
          setError(
            translateError(e instanceof Error ? e.message : 'Ошибка'),
          );
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fishId]);

  useVisibleInterval(() => {
    Promise.all([api.fishOne(fishId), api.portfolio()])
      .then(([data, portfolio]) => {
        setFish(data);
        const position = portfolio.positions.find(
          (p) => p.fishId === fishId && !p.joint,
        );
        setOwnedQty(Math.floor(Number(position?.quantity ?? 0)) || 0);
      })
      .catch(() => undefined);
  }, 5000);

  const quantity = Math.floor(Number(qty)) || 0;
  const total = useMemo(() => {
    if (!fish) return 0;
    return Number(fish.currentPrice) * quantity;
  }, [fish, quantity]);

  const cash = Number(balance);
  const unitPrice = fish ? Number(fish.currentPrice) : 0;
  const maxBuy = useMemo(() => {
    if (!fish || !(unitPrice > 0)) return 0;
    const budget = jointMode ? cash * 2 : cash;
    let n = Math.floor(budget / unitPrice);
    if (!Number.isFinite(n) || n < 0) n = 0;
    n = Math.min(n, Math.max(0, fish.availableSupply));
    const costOf = (count: number) =>
      jointMode ? (count * unitPrice) / 2 : count * unitPrice;
    while (n > 0 && costOf(n) > cash + 1e-8) n -= 1;
    return n;
  }, [fish, unitPrice, cash, jointMode]);
  const allQty = side === 'buy' ? maxBuy : ownedQty;

  async function submit() {
    if (!fish || quantity <= 0) return;
    if (jointMode && side === 'buy') {
      if (!partnerId && !partnerUsername.trim()) {
        setError('Выберите друга или введите @username');
        return;
      }
      if (quantity < 1) {
        setError('Укажите количество');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await api.jointBuy(
          partnerId || undefined,
          fish.id,
          quantity,
          partnerId ? undefined : partnerUsername.trim(),
        );
        await hapticNotify('success');
        notify(
          'Запрос отправлен. Друг получит его в Telegram и во вкладке Активы.',
        );
        setJointMode(false);
      } catch (e) {
        await hapticNotify('error');
        setError(
          translateError(
            e instanceof Error ? e.message : 'Не удалось пригласить',
          ),
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const key = `${side}:${fish.id}:${Date.now()}`;
      if (side === 'buy') await api.buy(fish.id, quantity, key);
      else await api.sell(fish.id, quantity, key);
      const refreshed = await api.fishOne(fish.id);
      setFish(refreshed);
      await refreshOwned();
      await onTraded();
      const label = fishName(fish.symbol, fish.name);
      notify(
        side === 'buy'
          ? `Куплено ${quantity} ${label}`
          : `Продано ${quantity} ${label}`,
      );
    } catch (e) {
      setError(
        translateError(e instanceof Error ? e.message : 'Сделка не удалась'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function sellAll() {
    if (!fish || ownedQty <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await hapticImpact('medium');
      await api.sell(
        fish.id,
        ownedQty,
        `sell-all-one:${fish.id}:${Date.now()}`,
      );
      const refreshed = await api.fishOne(fish.id);
      setFish(refreshed);
      setOwnedQty(0);
      setConfirmSellAll(false);
      await hapticNotify('success');
      await onTraded();
      notify(`Продано всё: ${ownedQty} ${fishName(fish.symbol, fish.name)}`);
    } catch (e) {
      await hapticNotify('error');
      setConfirmSellAll(false);
      setError(
        translateError(e instanceof Error ? e.message : 'Не удалось продать'),
      );
      await refreshOwned();
    } finally {
      setBusy(false);
    }
  }

  if (!fish && !error) {
    return (
      <div className="state-box">
        Загрузка пары…
        <div className="loading-bar" />
      </div>
    );
  }

  const soldOut = fish ? fish.availableSupply <= 0 : false;
  const hasOwned = ownedQty > 0;

  return (
    <div className="screen">
      <button className="chip ghost-back" type="button" onClick={onBack}>
        ← Рынок
      </button>

      {error && <div className="error-box">{error}</div>}

      {fish && (
        <>
          <div className="topbar">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="glyph">
                <img
                  src={fishImage(fish.symbol, fish.imageUrl)}
                  alt=""
                  width={96}
                  height={96}
                  decoding="async"
                />
              </span>
              <div>
                <div className="eyebrow">{rarityLabel(fish.rarity)}</div>
                <h1>{fishName(fish.symbol, fish.name)}</h1>
                <p>
                  {hasOwned
                    ? `У вас ${formatQty(ownedQty)} шт`
                    : rarityLabel(fish.rarity)}
                </p>
              </div>
            </div>
            <div className="balance-pill">
              <div className="label">Баланс</div>
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
            в наличии
            {soldOut ? ' · распродано' : ''}
          </p>

          <PriceChart
            fishId={fish.id}
            livePrice={fish.currentPrice}
            volatility={fish.volatility}
          />

          <div className="ticker">
            <div className="ticker-card">
              <div className="label">Макс.</div>
              <div className="value">{formatStars(fish.allTimeHigh, 2)}</div>
            </div>
            <div className="ticker-card">
              <div className="label">Мин.</div>
              <div className="value">{formatStars(fish.allTimeLow, 2)}</div>
            </div>
          </div>

          <div className="trade-panel">
            <div
              className={`side-toggle${hasOwned ? ' with-sell-all' : ''}`}
            >
              <button
                className={`buy ${side === 'buy' ? 'active' : ''}`}
                type="button"
                onClick={() => setSide('buy')}
              >
                Купить
              </button>
              <button
                className={`sell ${side === 'sell' ? 'active' : ''}`}
                type="button"
                onClick={() => setSide('sell')}
              >
                Продать
              </button>
              {hasOwned && (
                <button
                  className="sell-all"
                  type="button"
                  disabled={busy || fish.isFrozen}
                  onClick={() => setConfirmSellAll(true)}
                >
                  Продать всё
                </button>
              )}
            </div>

            <div className="section-title" style={{ marginTop: 0 }}>
              Количество
            </div>
            {side === 'buy' && (
              <div className="joint-box">
                <button
                  type="button"
                  className={`chip ${jointMode ? 'active' : ''}`}
                  onClick={() => {
                    setJointMode((v) => !v);
                    if (!jointMode && quantity < 1) setQty('1');
                  }}
                >
                  Купить вместе с другом
                </button>
                {jointMode && (
                  <>
                    <p className="joint-hint">
                      Платите пополам. Можно купить даже 1 дорогую рыбу —
                      каждому достанется доля 0.5. Другу придёт запрос в
                      Telegram.
                    </p>
                    {friends.length > 0 && (
                      <div className="joint-friends">
                        {friends.map((f) => {
                          const label = f.username
                            ? `@${f.username}`
                            : f.firstName || 'Друг';
                          return (
                            <button
                              key={f.id}
                              type="button"
                              className={`chip ${partnerId === f.id ? 'active' : ''}`}
                              onClick={() => {
                                setPartnerId(f.id);
                                setPartnerUsername('');
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <input
                      className="joint-select"
                      placeholder="@username друга в Telegram"
                      value={partnerUsername}
                      onChange={(e) => {
                        setPartnerUsername(e.target.value);
                        setPartnerId('');
                      }}
                    />
                  </>
                )}
              </div>
            )}
            <div className="qty-row">
              <input
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
              />
            </div>
            <div className="qty-presets">
              {(jointMode && side === 'buy'
                ? ['1', '2', '5', '10', '20']
                : ['1', '5', '10', '25', '100']
              )
                .concat(allQty > 0 ? [String(allQty)] : [])
                .filter((n, i, arr) => arr.indexOf(n) === i)
                .map((n) => (
                  <button
                    key={n}
                    className={`chip ${qty === n ? 'active' : ''}`}
                    type="button"
                    onClick={() => setQty(n)}
                  >
                    {n === String(allQty) && allQty > 0 ? 'Всё' : n}
                  </button>
                ))}
            </div>

            <div className="summary">
              <div className="summary-item">
                <div className="label">Итого</div>
                <div className="value">{formatStars(total, 2)} CR</div>
              </div>
              <div className="summary-item">
                <div className="label">Исполнение</div>
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
                ? 'Отправка…'
                : side === 'buy' && soldOut
                  ? 'Распродано'
                  : jointMode && side === 'buy'
                    ? `Пригласить · ${formatStars(total / 2, 2)} CR ваша доля`
                    : `${side === 'buy' ? 'Купить' : 'Продать'} ${fishName(fish.symbol, fish.name)}`}
            </button>
          </div>
        </>
      )}

      {confirmSellAll && fish && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sell-one-all-title"
        >
          <div className="confirm-sheet">
            <div className="eyebrow">Подтверждение</div>
            <h2 id="sell-one-all-title">Продать всё?</h2>
            <p>
              Продадите все {formatQty(ownedQty)} шт{' '}
              {fishName(fish.symbol, fish.name)} по текущей цене рынка. Это
              нельзя отменить.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setConfirmSellAll(false)}
              >
                Нет
              </button>
              <button
                type="button"
                className="btn btn-sell"
                disabled={busy}
                onClick={() => void sellAll()}
              >
                {busy ? 'Продаём…' : 'Да, продать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
