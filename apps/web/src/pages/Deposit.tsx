import { useEffect, useState } from 'react';
import {
  api,
  type DepositMethod,
  type DepositRecord,
  type Me,
  type StarsQuote,
} from '../lib/api';
import { formatStars } from '../lib/format';

async function openTelegramInvoice(invoiceLink: string): Promise<'paid' | 'cancelled' | 'failed' | 'unavailable'> {
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

  // Browser / unsupported: open link if possible
  if (invoiceLink.startsWith('http')) {
    window.open(invoiceLink, '_blank');
    return 'unavailable';
  }
  return 'unavailable';
}

export function Deposit({
  me,
  onCredited,
}: {
  me: Me;
  onCredited?: () => Promise<void> | void;
}) {
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [selected, setSelected] = useState<number | null>(100);
  const [quote, setQuote] = useState<StarsQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDeposit, setLastDeposit] = useState<DepositRecord | null>(null);

  const starsMethod = methods.find((m) => m.code === 'TELEGRAM_STARS');
  const packs = starsMethod?.packs || [50, 100, 250, 500, 1000];

  useEffect(() => {
    api
      .depositMethods()
      .then(setMethods)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (!selected || !starsMethod?.enabled) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    api
      .quoteStars(selected)
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Quote failed');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, starsMethod?.enabled]);

  async function pay() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const deposit = await api.createStarsDeposit(
        selected,
        `stars-ui:${me.id}:${selected}:${Date.now()}`,
      );
      setLastDeposit(deposit);
      if (!deposit.invoiceLink) {
        throw new Error('Invoice link missing');
      }
      const status = await openTelegramInvoice(deposit.invoiceLink);
      if (status === 'paid') {
        // Bot confirms asynchronously; poll a few times
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
        setError(
          'Open this Mini App inside Telegram to pay with Stars. Invoice created.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deposit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>Deposit</h1>
          <p>Real assets → game credits. Separate ledgers.</p>
        </div>
        <div className="stat-stack">
          <div className="label">Game balance</div>
          <div className="value">⭐ {formatStars(me.balance)}</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-title">Methods</div>
      <div className="list">
        {methods.map((m) => (
          <div key={m.code} className="deposit-method">
            <div>
              <div className="title">{m.label}</div>
              <div className="note">
                {m.note}
                {m.enabled ? ` · fee ${m.feePercent}%` : ''}
              </div>
            </div>
            <span className={`badge ${m.enabled ? '' : 'off'}`}>
              {m.enabled ? 'LIVE' : 'OFF'}
            </span>
          </div>
        ))}
      </div>

      {starsMethod?.enabled && (
        <div className="trade-panel">
          <div className="section-title">Buy with Telegram Stars</div>
          <div className="qty-presets">
            {packs.map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${selected === n ? 'active' : ''}`}
                onClick={() => setSelected(n)}
              >
                ⭐ {n}
              </button>
            ))}
          </div>

          {quote && (
            <div className="summary">
              <div className="summary-item">
                <div className="label">Rate</div>
                <div className="value">
                  1 Star → {formatStars(quote.exchangeRate, 0)} credits
                </div>
              </div>
              <div className="summary-item">
                <div className="label">Gross</div>
                <div className="value">
                  ⭐ {formatStars(quote.grossGameCredits)}
                </div>
              </div>
              <div className="summary-item">
                <div className="label">Fee ({quote.feePercent}%)</div>
                <div className="value">⭐ {formatStars(quote.feeAmount)}</div>
              </div>
              <div className="summary-item">
                <div className="label">You receive</div>
                <div className="value">
                  ⭐ {formatStars(quote.gameCreditAmount)}
                </div>
              </div>
            </div>
          )}

          <button
            className="btn btn-solid"
            type="button"
            disabled={busy || !selected}
            onClick={pay}
          >
            {busy ? 'Opening invoice…' : `Pay ⭐ ${selected}`}
          </button>

          {lastDeposit && (
            <p className="meme">
              Deposit {lastDeposit.id.slice(0, 8)}… · {lastDeposit.status}
              {lastDeposit.status === 'CONFIRMED'
                ? ` · +${formatStars(lastDeposit.gameCreditAmount || '0')} credits`
                : ''}
            </p>
          )}

          <p className="meme">
            Conversion is configurable (not 1 Star = 1 game credit). Paying
            with Stars requires the Mini App inside Telegram + bot token.
          </p>
        </div>
      )}
    </div>
  );
}
