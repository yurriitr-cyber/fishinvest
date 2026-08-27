import { useEffect, useState } from 'react';
import { api, type Me, type Portfolio } from '../lib/api';
import { MediaSlot } from '../components/MediaSlot';
import { fishGlyph, formatPct, formatStars, pnlClass } from '../lib/format';
import { hapticImpact, hapticNotify } from '../lib/telegram';
import { translateError } from '../lib/labels';

function formatQty(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

export function PortfolioPage({
  me,
  onSelectFish,
  onSold,
  notify,
}: {
  me: Me;
  onSelectFish: (id: string) => void;
  onSold?: () => Promise<void> | void;
  notify?: (message: string) => void;
}) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSellAll, setConfirmSellAll] = useState(false);
  const [selling, setSelling] = useState(false);

  async function loadPortfolio() {
    const next = await api.portfolio();
    setData(next);
    return next;
  }

  useEffect(() => {
    loadPortfolio().catch((e) =>
      setError(
        translateError(e instanceof Error ? e.message : 'Ошибка'),
      ),
    );
  }, [me.balance, me.portfolioValue]);

  const positions = data?.positions ?? [];
  const hasPositions = positions.length > 0;
  const totalFish = positions.reduce(
    (sum, p) => sum + (Math.floor(Number(p.quantity)) || 0),
    0,
  );

  async function sellAll() {
    if (!data || selling) return;
    setSelling(true);
    setError(null);
    try {
      await hapticImpact('medium');
      for (const p of data.positions) {
        const qty = Math.floor(Number(p.quantity));
        if (qty <= 0) continue;
        await api.sell(
          p.fishId,
          qty,
          `sell-all:${p.fishId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        );
      }
      await hapticNotify('success');
      setConfirmSellAll(false);
      notify?.('Все позиции проданы');
      await onSold?.();
      await loadPortfolio();
    } catch (e) {
      await hapticNotify('error');
      setError(
        translateError(e instanceof Error ? e.message : 'Не удалось продать'),
      );
      setConfirmSellAll(false);
      try {
        await onSold?.();
        await loadPortfolio();
      } catch {
        /* ignore */
      }
    } finally {
      setSelling(false);
    }
  }

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

          <div className="section-title row-between">
            <span>Позиции</span>
            {hasPositions && (
              <button
                type="button"
                className="btn btn-sell btn-compact"
                onClick={() => setConfirmSellAll(true)}
                disabled={selling}
              >
                Продать всё
              </button>
            )}
          </div>

          <div className="market-head">
            <span>Актив</span>
            <span>Кол-во</span>
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
                  <div className="name">
                    {p.symbol}
                    <span className="qty-badge">×{formatQty(p.quantity)}</span>
                  </div>
                  <div className="meta">
                    ср. {formatStars(p.avgBuyPrice, 2)} ·{' '}
                    {formatStars(p.currentValue, 2)} CR
                  </div>
                </div>
                <div className="row-side">
                  <div className="price qty-display">
                    {formatQty(p.quantity)} шт
                  </div>
                  <div className={`chg ${pnlClass(p.unrealizedPnl)}`}>
                    {formatPct(p.unrealizedPnlPercent)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {confirmSellAll && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sell-all-title"
        >
          <div className="confirm-sheet">
            <div className="eyebrow">Подтверждение</div>
            <h2 id="sell-all-title">Продать всё?</h2>
            <p>
              Продадите {totalFish} рыб
              {positions.length > 1 ? ` (${positions.length} позиций)` : ''} по
              текущей цене рынка. Это нельзя отменить.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={selling}
                onClick={() => setConfirmSellAll(false)}
              >
                Нет
              </button>
              <button
                type="button"
                className="btn btn-sell"
                disabled={selling}
                onClick={() => void sellAll()}
              >
                {selling ? 'Продаём…' : 'Да, продать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
