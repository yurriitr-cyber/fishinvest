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
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
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
          if (!cancelled) setError(e instanceof Error ? e.message : 'Quote failed');
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
          setError(e instanceof Error ? e.message : 'TON quote failed');
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
    setStatusMsg('Open your wallet, send the exact amount with the memo…');

    const delays = [1000, 2000, 2000, 2500, 2500, 4000, 8000];
    let elapsed = 0;
    for (const wait of delays) {
      await new Promise((r) => setTimeout(r, wait));
      elapsed += wait;
      if (watchRef.current !== token) return;
      setTonPhase('checking');
      setStatusMsg(
        elapsed <= 10_000
          ? `Checking payment… (${Math.round(elapsed / 1000)}s)`
          : 'Still checking the blockchain…',
      );
      try {
        const fresh = await api.checkTonDeposit(depositId);
        if (watchRef.current !== token) return;
        setLastDeposit(fresh);
        if (fresh.status === 'CONFIRMED') {
          setTonPhase('credited');
          setStatusMsg(
            `Credits received: +${formatStars(fresh.gameCreditAmount || '0')} CR.`,
          );
          await onCredited?.();
          return;
        }
        if (fresh.status === 'CANCELLED' || fresh.status === 'FAILED') {
          setTonPhase('failed');
          setStatusMsg('Deposit expired or failed. Create a new one.');
          return;
        }
        if (elapsed >= 10_000) {
          setTonPhase('pending');
          setStatusMsg(
            'Not credited within 10 seconds. If you already sent TON, wait a bit or tap Check now.',
          );
        } else {
          setTonPhase('awaiting');
          setStatusMsg('Payment not seen yet — keep the memo exact.');
        }
      } catch {
        setStatusMsg('Network hiccup while checking. Retrying…');
      }
    }

    if (watchRef.current !== token) return;
    setTonPhase('pending');
    setStatusMsg(
      'Still not credited. Confirm amount + memo in your wallet, then Check now.',
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
        setError('Payment cancelled.');
      } else if (status === 'unavailable') {
        setError('Open this Mini App inside Telegram to pay with Stars.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deposit failed');
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
      setError(e instanceof Error ? e.message : 'TON deposit failed');
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
    setStatusMsg('Checking the blockchain…');
    try {
      const fresh = await api.checkTonDeposit(lastDeposit.id);
      setLastDeposit(fresh);
      if (fresh.status === 'CONFIRMED') {
        setTonPhase('credited');
        setStatusMsg(
          `Credited +${formatStars(fresh.gameCreditAmount || '0')} CR to your balance.`,
        );
        await onCredited?.();
      } else {
        setTonPhase('pending');
        setStatusMsg('Payment not found yet. Confirm amount + memo, then retry.');
      }
    } catch (e) {
      setTonPhase('failed');
      setStatusMsg(e instanceof Error ? e.message : 'Check failed');
    }
  }

  const tonUsd = tonQuote ? Number(tonQuote.tonUsdPrice) : null;
  const creditsPerTon = tonQuote ? Number(tonQuote.exchangeRate) : null;

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Top up</div>
          <h1>Deposit</h1>
          <p>Stars or TON → game credits</p>
        </div>
        <div className="balance-pill">
          <div className="label">Balance</div>
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
          TON{!tonMethod?.enabled ? ' · soon' : ''}
        </button>
      </div>

      {channel === 'stars' && starsMethod?.enabled && (
        <div className="trade-panel">
          <div className="section-title" style={{ marginTop: 0 }}>
            Amount
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
              placeholder="Custom Stars amount"
              value={starsInput}
              onChange={(e) => setStarsInput(e.target.value.replace(/[^\d]/g, ''))}
              aria-label="Stars amount"
            />
          </div>
          <p className="amount-hint">1–50 000 Stars · 1 Star = 1 CR</p>

          {quote && selected && (
            <div className="summary">
              <div className="summary-item">
                <div className="label">You pay</div>
                <div className="value">{selected} Stars</div>
              </div>
              <div className="summary-item">
                <div className="label">You receive</div>
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
              ? 'Opening invoice…'
              : selected
                ? `Pay ${selected} Stars`
                : 'Enter amount'}
          </button>
        </div>
      )}

      {channel === 'ton' && tonMethod?.enabled && (
        <div className="trade-panel">
          <div className="section-title" style={{ marginTop: 0 }}>
            Amount (TON)
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
              placeholder="Custom TON amount"
              value={tonInput}
              onChange={(e) => {
                const next = e.target.value.replace(',', '.');
                if (/^\d*\.?\d{0,9}$/.test(next) || next === '') {
                  setTonInput(next);
                }
              }}
              aria-label="TON amount"
            />
          </div>
          <p className="amount-hint">0.05–500 TON · live market rate</p>

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
                <div className="label">You receive</div>
                <div className="value">
                  {formatStars(tonQuote.gameCreditAmount)} CR
                </div>
              </div>
              <div className="summary-item">
                <div className="label">Bonus</div>
                <div className="value">
                  +{Number(tonQuote.bonusPercent ?? 15).toFixed(0)}%
                </div>
              </div>
            </div>
          )}
          {tonQuote?.rateSource && (
            <p className="amount-hint">
              Rate · {tonQuote.rateSource}
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
              ? 'Creating…'
              : tonSelected
                ? `Pay ${tonSelected} TON`
                : 'Enter amount'}
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
              <div className="label">Deposit status</div>
              <div className="title">
                {tonPhase === 'credited'
                  ? 'Credited'
                  : tonPhase === 'checking'
                    ? 'Checking…'
                    : tonPhase === 'failed'
                      ? 'Not credited'
                      : tonPhase === 'pending'
                        ? 'Still waiting'
                        : 'Awaiting payment'}
              </div>
              <p className="detail">{statusMsg}</p>
              {lastDeposit.status !== 'CONFIRMED' && (
                <>
                  <p className="detail" style={{ marginTop: 8 }}>
                    Send <strong>{lastDeposit.assetAmount} TON</strong> with memo{' '}
                    <strong>{lastDeposit.memo}</strong>
                  </p>
                  <div className="actions">
                    {lastDeposit.depositAddress && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => copy(lastDeposit.depositAddress || '')}
                      >
                        Copy address
                      </button>
                    )}
                    {lastDeposit.memo && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => copy(lastDeposit.memo || '')}
                      >
                        Copy memo
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-solid"
                      onClick={checkNow}
                    >
                      Check now
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
          <div className="label">Stars deposit</div>
          <div className="title">{lastDeposit.status}</div>
          <p className="detail">
            {lastDeposit.status === 'CONFIRMED'
              ? `Credited +${formatStars(lastDeposit.gameCreditAmount || '0')} CR`
              : `Order ${lastDeposit.id.slice(0, 8)}…`}
          </p>
        </div>
      )}
    </div>
  );
}
