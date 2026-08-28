import { useEffect, useState } from 'react';
import { api, type JointProposal, type Me, type Portfolio } from '../lib/api';
import {
  fishImage,
  formatPct,
  formatStars,
  pnlClass,
} from '../lib/format';
import { hapticImpact, hapticNotify } from '../lib/telegram';
import { fishName, translateError } from '../lib/labels';

function formatQty(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

function friendLabel(u: {
  username: string | null;
  firstName: string | null;
} | null) {
  if (!u) return 'Друг';
  if (u.username) return `@${u.username}`;
  return u.firstName || 'Друг';
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
  const [incoming, setIncoming] = useState<JointProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmSellAll, setConfirmSellAll] = useState(false);
  const [selling, setSelling] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  async function loadPortfolio() {
    const next = await api.portfolio();
    setData(next);
    return next;
  }

  async function loadJoint() {
    try {
      const mine = await api.jointMine();
      setIncoming(mine.incoming ?? []);
    } catch {
      setIncoming([]);
    }
  }

  useEffect(() => {
    loadPortfolio().catch((e) =>
      setError(
        translateError(e instanceof Error ? e.message : 'Ошибка'),
      ),
    );
    void loadJoint();
  }, [me.balance, me.portfolioValue]);

  const positions = data?.positions ?? [];
  const soloPositions = positions.filter((p) => !p.joint);
  const hasPositions = positions.length > 0;
  const totalFish = soloPositions.reduce(
    (sum, p) => sum + (Math.floor(Number(p.quantity)) || 0),
    0,
  );

  async function sellAll() {
    if (!data || selling) return;
    setSelling(true);
    setError(null);
    try {
      await hapticImpact('medium');
      const solo = data.positions.filter((p) => !p.joint);
      for (const p of solo) {
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
      notify?.('Соло-позиции проданы (совместные — отдельно)');
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

  async function proposeJointSell(holdingId: string) {
    setSelling(true);
    setError(null);
    try {
      await api.jointSell(holdingId);
      await hapticNotify('success');
      notify?.('Запрос на продажу отправлен другу в Telegram');
    } catch (e) {
      await hapticNotify('error');
      setError(
        translateError(
          e instanceof Error ? e.message : 'Не удалось отправить запрос',
        ),
      );
    } finally {
      setSelling(false);
    }
  }

  async function respondJoint(id: string, accept: boolean) {
    setRespondingId(id);
    setError(null);
    try {
      await api.jointRespond(id, accept);
      await hapticNotify(accept ? 'success' : 'warning');
      notify?.(accept ? 'Принято' : 'Отклонено');
      await onSold?.();
      await Promise.all([loadPortfolio(), loadJoint()]);
    } catch (e) {
      await hapticNotify('error');
      setError(
        translateError(
          e instanceof Error ? e.message : 'Не удалось ответить',
        ),
      );
    } finally {
      setRespondingId(null);
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

      {incoming.length > 0 && (
        <div className="joint-inbox">
          <div className="section-title">Запросы от друзей</div>
          {incoming.map((p) => (
            <div key={p.id} className="joint-invite">
              <div className="joint-invite-text">
                <strong>
                  {p.kind === 'SELL' ? 'Продажа' : 'Покупка'} ·{' '}
                  {fishName(p.fish.symbol, p.fish.name)}
                </strong>
                <span>
                  от {friendLabel(p.initiator)} · {formatQty(p.quantity)} шт ·
                  ваша доля ~{formatStars(p.halfAmount, 2)} CR
                </span>
              </div>
              <div className="joint-invite-actions">
                <button
                  type="button"
                  className="btn btn-buy btn-compact"
                  disabled={respondingId === p.id}
                  onClick={() => void respondJoint(p.id, true)}
                >
                  Принять
                </button>
                <button
                  type="button"
                  className="btn btn-sell btn-compact"
                  disabled={respondingId === p.id}
                  onClick={() => void respondJoint(p.id, false)}
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
              <div
                key={p.jointHoldingId || p.fishId}
                className="position-block"
              >
                <button
                  className="row"
                  type="button"
                  onClick={() => onSelectFish(p.fishId)}
                >
                  <span className="glyph">
                    <img src={fishImage(p.symbol, p.imageUrl)} alt="" />
                  </span>
                  <div className="row-main">
                    <div className="name">
                      {fishName(p.symbol, p.name)}
                      {p.joint ? (
                        <span className="qty-badge">вместе</span>
                      ) : null}
                    </div>
                    <div className="meta">
                      {p.joint && p.partner
                        ? `с ${
                            p.partner.username
                              ? `@${p.partner.username}`
                              : p.partner.firstName || 'другом'
                          } · `
                        : ''}
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
                {p.joint && p.jointHoldingId ? (
                  <button
                    type="button"
                    className="btn btn-sell btn-compact joint-sell-btn"
                    disabled={selling}
                    onClick={() => void proposeJointSell(p.jointHoldingId!)}
                  >
                    Продать вместе
                  </button>
                ) : null}
              </div>
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
              Продадите соло-позиции ({totalFish} рыб
              {soloPositions.length > 1
                ? `, ${soloPositions.length} позиций`
                : ''}
              ) по текущей цене. Совместные активы не затронуты.
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
