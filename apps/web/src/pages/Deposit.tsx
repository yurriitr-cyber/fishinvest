import { useEffect, useState } from 'react';
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

export function Deposit({
  me,
  onCredited,
}: {
  me: Me;
  onCredited?: () => Promise<void> | void;
}) {
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [channel, setChannel] = useState<'stars' | 'ton'>('stars');
  const [selected, setSelected] = useState<number | null>(100);
  const [tonSelected, setTonSelected] = useState<number | null>(1);
  const [quote, setQuote] = useState<StarsQuote | null>(null);
  const [tonQuote, setTonQuote] = useState<TonQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDeposit, setLastDeposit] = useState<DepositRecord | null>(null);

  const starsMethod = methods.find((m) => m.code === 'TELEGRAM_STARS');
  const tonMethod = methods.find((m) => m.code === 'TON');
  const packs = starsMethod?.packs || [50, 100, 250, 500, 1000];
  const tonPacks = tonMethod?.tonPacks || [0.5, 1, 2, 5, 10];

  useEffect(() => {
    api
      .depositMethods()
      .then((m) => {
        setMethods(m);
        if (m.find((x) => x.code === 'TON')?.enabled) {
          /* keep default stars */
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  useEffect(() => {
    if (channel !== 'stars' || !selected || !starsMethod?.enabled) {
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
  }, [selected, starsMethod?.enabled, channel]);

  useEffect(() => {
    if (channel !== 'ton' || !tonSelected || !tonMethod?.enabled) {
      setTonQuote(null);
      return;
    }
    let cancelled = false;
    api
      .quoteTon(tonSelected)
      .then((q) => {
        if (!cancelled) setTonQuote(q);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'TON quote failed');
      });
    return () => {
      cancelled = true;
    };
  }, [tonSelected, tonMethod?.enabled, channel]);

  useEffect(() => {
    if (!lastDeposit || lastDeposit.provider !== 'TON') return;
    if (lastDeposit.status === 'CONFIRMED') return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const fresh = await api.checkTonDeposit(lastDeposit.id);
        if (cancelled) return;
        setLastDeposit(fresh);
        if (fresh.status === 'CONFIRMED') {
          await onCredited?.();
        }
      } catch {
        /* ignore transient */
      }
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [lastDeposit?.id, lastDeposit?.status, lastDeposit?.provider, onCredited]);

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
      if (deposit.transferLink) {
        window.location.href = deposit.transferLink;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'TON deposit failed');
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
          <div className="value">⭐ {formatStars(me.balance)}</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="side-toggle" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`buy ${channel === 'stars' ? 'active' : ''}`}
          onClick={() => setChannel('stars')}
        >
          Stars
        </button>
        <button
          type="button"
          className={`sell ${channel === 'ton' ? 'active' : ''}`}
          onClick={() => setChannel('ton')}
          disabled={!tonMethod?.enabled}
        >
          TON{!tonMethod?.enabled ? ' · soon' : ''}
        </button>
      </div>

      <div className="section-title">Methods</div>
      <div className="list">
        {methods.map((m) => (
          <div key={m.code} className="deposit-method">
            <div>
              <div className="title">{m.label}</div>
              <div className="note">
                {m.note}
                {m.enabled && Number(m.feePercent) > 0
                  ? ` · fee ${m.feePercent}%`
                  : ''}
              </div>
            </div>
            <span className={`badge ${m.enabled ? '' : 'off'}`}>
              {m.enabled ? 'LIVE' : 'SOON'}
            </span>
          </div>
        ))}
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
                <div className="value">1★ = 1 game ⭐</div>
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
            onClick={payStars}
          >
            {busy ? 'Opening invoice…' : `Pay ⭐ ${selected}`}
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
                onClick={() => setTonSelected(n)}
              >
                {n} TON
              </button>
            ))}
          </div>

          {tonQuote && (
            <div className="summary">
              <div className="summary-item">
                <div className="label">TON / USD</div>
                <div className="value">${Number(tonQuote.tonUsdPrice).toFixed(2)}</div>
              </div>
              <div className="summary-item">
                <div className="label">You receive</div>
                <div className="value">
                  ⭐ {formatStars(tonQuote.gameCreditAmount)}
                </div>
              </div>
              <div className="summary-item">
                <div className="label">TON bonus</div>
                <div className="value">
                  +{Number(tonQuote.bonusPercent ?? 15).toFixed(0)}%
                  {tonQuote.bonusAmount
                    ? ` (⭐ ${formatStars(tonQuote.bonusAmount)})`
                    : ''}
                </div>
              </div>
              <div className="summary-item">
                <div className="label">Rate</div>
                <div className="value" style={{ fontSize: 12 }}>
                  live oracle
                </div>
              </div>
            </div>
          )}

          <button
            className="btn btn-solid"
            type="button"
            disabled={busy || !tonSelected}
            onClick={payTon}
          >
            {busy ? 'Creating…' : `Pay ${tonSelected} TON`}
          </button>

          {lastDeposit?.provider === 'TON' && lastDeposit.status !== 'CONFIRMED' && (
            <div style={{ marginTop: 14 }}>
              <p className="meme" style={{ marginTop: 0 }}>
                Send exactly <strong>{lastDeposit.assetAmount} TON</strong> with
                comment/memo <strong>{lastDeposit.memo}</strong>. Credits appear
                after the chain confirms (auto-check every ~8s).
              </p>
              {lastDeposit.depositAddress && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ marginBottom: 8 }}
                  onClick={() => copy(lastDeposit.depositAddress || '')}
                >
                  Copy address
                </button>
              )}
              {lastDeposit.memo && (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ marginBottom: 8 }}
                  onClick={() => copy(lastDeposit.memo || '')}
                >
                  Copy memo
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  const fresh = await api.checkTonDeposit(lastDeposit.id);
                  setLastDeposit(fresh);
                  if (fresh.status === 'CONFIRMED') await onCredited?.();
                }}
              >
                I paid — check now
              </button>
            </div>
          )}
        </div>
      )}

      {lastDeposit && (
        <p className="meme">
          Order {lastDeposit.id.slice(0, 8)}… · {lastDeposit.provider} ·{' '}
          {lastDeposit.status}
          {lastDeposit.status === 'CONFIRMED'
            ? ` · +${formatStars(lastDeposit.gameCreditAmount || '0')}`
            : ''}
        </p>
      )}
    </div>
  );
}
