import { useEffect, useRef, useState } from 'react';
import {
  api,
  type DepositMethod,
  type DepositRecord,
  type Me,
  type StarsQuote,
  type TonQuote,
} from '../lib/api';
import { formatStars } from '../lib/format';
import { depositStatus, translateError } from '../lib/labels';

async function openTelegramInvoice(
  invoiceLink: string,
): Promise<'paid' | 'cancelled' | 'failed' | 'unavailable'> {
  try {
    const sdk = await import('@telegram-apps/sdk');
    if (sdk.invoice.open.isAvailable()) {
      const status = await sdk.invoice.open(invoiceLink, 'url');
      if (status === 'paid') return 'paid';
      if (status === 'cancelled') return 'cancelled';
      return 'failed';
    }
  } catch {
    /* fall through */
  }

  if (invoiceLink.startsWith('http')) {
    window.open(invoiceLink, '_blank');
    return 'unavailable';
  }
  return 'unavailable';
}

type TonPhase = 'idle' | 'awaiting' | 'checking' | 'credited' | 'pending' | 'failed';

function parseStars(raw: string): number | null {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, '')));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 50_000);
}

function parseTon(raw: string): number | null {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0.05) return null;
  return Math.min(n, 500);
}

export function Deposit({
  me,
  onCredited,
}: {
  me: Me;
  onCredited?: () => Promise<void> | void;
}) {
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [channel, setChannel] = useState<'stars' | 'ton'>('stars');
  const [starsInput, setStarsInput] = useState('100');
  const [tonInput, setTonInput] = useState('1');
  const [quote, setQuote] = useState<StarsQuote | null>(null);
  const [tonQuote, setTonQuote] = useState<TonQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDeposit, setLastDeposit] = useState<DepositRecord | null>(null);
  const [tonPhase, setTonPhase] = useState<TonPhase>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const watchRef = useRef(0);

  const starsMethod = methods.find((m) => m.code === 'TELEGRAM_STARS');
  const tonMethod = methods.find((m) => m.code === 'TON');
  const packs = starsMethod?.packs || [50, 100, 250, 500, 1000];
  const tonPacks = tonMethod?.tonPacks || [0.5, 1, 2, 5, 10];

  const selected = parseStars(starsInput);
  const tonSelected = parseTon(tonInput);

  useEffect(() => {
    api
      .depositMethods()
      .then(setMethods)
      .catch((e) =>
        setError(translateError(e instanceof Error ? e.message : 'Ошибка')),
      );
  }, []);

  useEffect(() => {
    if (channel !== 'stars' || !selected || !starsMethod?.enabled) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .quoteStars(selected)
        .then((q) => {
          if (!cancelled) {
            setQuote(q);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError(
              translateError(
                e instanceof Error ? e.message : 'Quote failed',
              ),
            );
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [selected, starsMethod?.enabled, channel]);

  useEffect(() => {
    if (channel !== 'ton' || !tonSelected || !tonMethod?.enabled) {
      setTonQuote(null);
      return;
    }
    let cancelled = false;

    async function pull() {
      if (!tonSelected) return;
      try {
        const q = await api.quoteTon(tonSelected);
        if (!cancelled) {
          setTonQuote(q);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            translateError(
              e instanceof Error ? e.message : 'Quote failed',
            ),
          );
        }
      }
    }

    const debounce = setTimeout(pull, 220);
    // Keep the displayed TON rate live while this tab is open
    const interval = setInterval(pull, 15_000);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [tonSelected, tonMethod?.enabled, channel]);

  async function watchTonDeposit(depositId: string, token: number) {
    setTonPhase('awaiting');
    setStatusMsg('Откройте кошелёк и отправьте точную сумму с мемо…');

    const delays = [1000, 2000, 2000, 2500, 2500, 4000, 8000];
    let elapsed = 0;
    for (const wait of delays) {
      await new Promise((r) => setTimeout(r, wait));
      elapsed += wait;
      if (watchRef.current !== token) return;
      setTonPhase('checking');
      setStatusMsg(
        elapsed <= 10_000
          ? `Проверяем оплату… (${Math.round(elapsed / 1000)} с)`
          : 'Всё ещё проверяем блокчейн…',
      );
      try {
        const fresh = await api.checkTonDeposit(depositId);
        if (watchRef.current !== token) return;
        setLastDeposit(fresh);
        if (fresh.status === 'CONFIRMED') {
          setTonPhase('credited');
          setStatusMsg(
            `Кредиты зачислены: +${formatStars(fresh.gameCreditAmount || '0')} CR.`,
          );
          await onCredited?.();
          return;
        }
        if (fresh.status === 'CANCELLED' || fresh.status === 'FAILED') {
          setTonPhase('failed');
          setStatusMsg('Депозит истёк или не удался. Создайте новый.');
          return;
        }
        if (elapsed >= 10_000) {
          setTonPhase('pending');
          setStatusMsg(
            'Не зачислено за 10 секунд. Если вы уже отправили TON, подождите или нажмите «Проверить».',
          );
        } else {
          setTonPhase('awaiting');
          setStatusMsg('Оплата ещё не видна — мемо должно совпадать точно.');
        }
      } catch {
        setStatusMsg('Сбой сети при проверке. Повторяем…');
      }
    }

    if (watchRef.current !== token) return;
    setTonPhase('pending');
    setStatusMsg(
      'Всё ещё не зачислено. Проверьте сумму и мемо в кошельке, затем «Проверить».',
    );
  }

  async function payStars() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const deposit = await api.createStarsDeposit(
        selected,
        `stars-ui:${me.id}:${selected}:${Date.now()}`,
      );
      setLastDeposit(deposit);
      if (!deposit.invoiceLink) throw new Error('Invoice link missing');
      const status = await openTelegramInvoice(deposit.invoiceLink);
      if (status === 'paid') {
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 700));
          const fresh = await api.getDeposit(deposit.id);
          setLastDeposit(fresh);
          if (fresh.status === 'CONFIRMED') {
            await onCredited?.();
            break;
          }
        }
      } else if (status === 'cancelled') {
        setError('Оплата отменена.');
      } else if (status === 'unavailable') {
        setError('Откройте Mini App внутри Telegram, чтобы оплатить Stars.');
      }
    } catch (e) {
      setError(
        translateError(e instanceof Error ? e.message : 'Депозит не удался'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function payTon() {
    if (!tonSelected) return;
    setBusy(true);
    setError(null);
    try {
      const deposit = await api.createTonDeposit(
        tonSelected,
        `ton-ui:${me.id}:${tonSelected}:${Date.now()}`,
      );
      setLastDeposit(deposit);
      const token = ++watchRef.current;
      void watchTonDeposit(deposit.id, token);
      if (deposit.transferLink) {
        try {
          window.open(deposit.transferLink, '_blank');
        } catch {
          window.location.href = deposit.transferLink;
        }
      }
    } catch (e) {
      setError(
        translateError(e instanceof Error ? e.message : 'Депозит не удался'),
      );
      setTonPhase('failed');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  async function checkNow() {
    if (!lastDeposit || lastDeposit.provider !== 'TON') return;
    setTonPhase('checking');
    setStatusMsg('Проверяем блокчейн…');
    try {
      const fresh = await api.checkTonDeposit(lastDeposit.id);
      setLastDeposit(fresh);
      if (fresh.status === 'CONFIRMED') {
        setTonPhase('credited');
        setStatusMsg(
          `Зачислено +${formatStars(fresh.gameCreditAmount || '0')} CR на баланс.`,
        );
        await onCredited?.();
      } else {
        setTonPhase('pending');
        setStatusMsg(
          'Оплата ещё не найдена. Проверьте сумму и мемо, затем повторите.',
        );
      }
    } catch (e) {
      setTonPhase('failed');
      setStatusMsg(
        translateError(e instanceof Error ? e.message : 'Ошибка проверки'),
      );
    }
  }

  const tonUsd = tonQuote ? Number(tonQuote.tonUsdPrice) : null;
  const creditsPerTon = tonQuote ? Number(tonQuote.exchangeRate) : null;

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Пополнение</div>
          <h1>Депозит</h1>
          <p>Stars или TON → игровые кредиты</p>
        </div>
        <div className="balance-pill">
          <div className="label">Баланс</div>
          <div className="value">{formatStars(me.balance)} CR</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="side-toggle channel">
        <button
          type="button"
          className={channel === 'stars' ? 'active' : undefined}
          onClick={() => setChannel('stars')}
        >
          Telegram Stars
        </button>
        <button
          type="button"
          className={channel === 'ton' ? 'active' : undefined}
          onClick={() => setChannel('ton')}
          disabled={!tonMethod?.enabled}
        >
          TON{!tonMethod?.enabled ? ' · скоро' : ''}
        </button>
      </div>

      {channel === 'stars' && starsMethod?.enabled && (
        <div className="trade-panel">
          <div className="section-title" style={{ marginTop: 0 }}>
            Сумма
          </div>
          <div className="qty-presets">
            {packs.map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${selected === n ? 'active' : ''}`}
                onClick={() => setStarsInput(String(n))}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="qty-row">
            <input
              inputMode="numeric"
              placeholder="Своя сумма Stars"
              value={starsInput}
              onChange={(e) => setStarsInput(e.target.value.replace(/[^\d]/g, ''))}
              aria-label="Сумма Stars"
            />
          </div>
          <p className="amount-hint">1–50 000 Stars · 1 Star = 1 CR</p>

          {quote && selected && (
            <div className="summary">
              <div className="summary-item">
                <div className="label">К оплате</div>
                <div className="value">{selected} Stars</div>
              </div>
              <div className="summary-item">
                <div className="label">Вы получите</div>
                <div className="value">{formatStars(quote.gameCreditAmount)} CR</div>
              </div>
            </div>
          )}

          <button
            className="btn btn-solid"
            type="button"
            disabled={busy || !selected}
            onClick={payStars}
          >
            {busy
              ? 'Открываем счёт…'
              : selected
                ? `Оплатить ${selected} Stars`
                : 'Введите сумму'}
          </button>
        </div>
      )}

      {channel === 'ton' && tonMethod?.enabled && (
        <div className="trade-panel">
          <div className="section-title" style={{ marginTop: 0 }}>
            Сумма (TON)
          </div>
          <div className="qty-presets">
            {tonPacks.map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${tonSelected === n ? 'active' : ''}`}
                onClick={() => setTonInput(String(n))}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="qty-row">
            <input
              inputMode="decimal"
              placeholder="Своя сумма TON"
              value={tonInput}
              onChange={(e) => {
                const next = e.target.value.replace(',', '.');
                if (/^\d*\.?\d{0,9}$/.test(next) || next === '') {
                  setTonInput(next);
                }
              }}
              aria-label="Сумма TON"
            />
          </div>
          <p className="amount-hint">0.05–500 TON · живой рыночный курс</p>

          {tonQuote && tonSelected && (
            <div className="summary">
              <div className="summary-item">
                <div className="label">TON / USD</div>
                <div className="value">
                  ${tonUsd != null && Number.isFinite(tonUsd) ? tonUsd.toFixed(4) : '—'}
                </div>
              </div>
              <div className="summary-item">
                <div className="label">1 TON ≈</div>
                <div className="value">
                  {creditsPerTon != null && Number.isFinite(creditsPerTon)
                    ? `${formatStars(creditsPerTon, 1)} CR`
                    : '—'}
                </div>
              </div>
              <div className="summary-item">
                <div className="label">Вы получите</div>
                <div className="value">
                  {formatStars(tonQuote.gameCreditAmount)} CR
                </div>
              </div>
              <div className="summary-item">
                <div className="label">Бонус</div>
                <div className="value">
                  +{Number(tonQuote.bonusPercent ?? 15).toFixed(0)}%
                </div>
              </div>
            </div>
          )}
          {tonQuote?.rateSource && (
            <p className="amount-hint">
              Курс · {tonQuote.rateSource}
              {tonQuote.rateFetchedAt
                ? ` · ${new Date(tonQuote.rateFetchedAt).toLocaleTimeString()}`
                : ''}
            </p>
          )}

          <button
            className="btn btn-solid"
            type="button"
            disabled={busy || !tonSelected}
            onClick={payTon}
          >
            {busy
              ? 'Создаём…'
              : tonSelected
                ? `Оплатить ${tonSelected} TON`
                : 'Введите сумму'}
          </button>

          {lastDeposit?.provider === 'TON' && (
            <div
              className={`status-card ${
                tonPhase === 'credited'
                  ? 'ok'
                  : tonPhase === 'failed'
                    ? 'fail'
                    : 'wait'
              }`}
            >
              <div className="label">Статус депозита</div>
              <div className="title">
                {tonPhase === 'credited'
                  ? 'Зачислено'
                  : tonPhase === 'checking'
                    ? 'Проверяем…'
                    : tonPhase === 'failed'
                      ? 'Не зачислено'
                      : tonPhase === 'pending'
                        ? 'Всё ещё ждём'
                        : 'Ожидание оплаты'}
              </div>
              <p className="detail">{statusMsg}</p>
              {lastDeposit.status !== 'CONFIRMED' && (
                <>
                  <p className="detail" style={{ marginTop: 8 }}>
                    Отправьте <strong>{lastDeposit.assetAmount} TON</strong> с мемо{' '}
                    <strong>{lastDeposit.memo}</strong>
                  </p>
                  <div className="actions">
                    {lastDeposit.depositAddress && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => copy(lastDeposit.depositAddress || '')}
                      >
                        Копировать адрес
                      </button>
                    )}
                    {lastDeposit.memo && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => copy(lastDeposit.memo || '')}
                      >
                        Копировать мемо
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-solid"
                      onClick={checkNow}
                    >
                      Проверить
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {lastDeposit?.provider === 'TELEGRAM_STARS' && (
        <div
          className={`status-card ${lastDeposit.status === 'CONFIRMED' ? 'ok' : 'wait'}`}
        >
          <div className="label">Депозит Stars</div>
          <div className="title">{depositStatus(lastDeposit.status)}</div>
          <p className="detail">
            {lastDeposit.status === 'CONFIRMED'
              ? `Зачислено +${formatStars(lastDeposit.gameCreditAmount || '0')} CR`
              : `Заказ ${lastDeposit.id.slice(0, 8)}…`}
          </p>
        </div>
      )}
    </div>
  );
}
