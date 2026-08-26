import { useEffect, useState } from 'react';
import { MediaSlot } from '../components/MediaSlot';
import {
  api,
  type CaseOpening,
  type LootCase,
  type Me,
} from '../lib/api';
import { fishGlyph, formatStars, pnlClass } from '../lib/format';

export function Casino({
  me,
  onOpened,
  notify,
}: {
  me: Me;
  onOpened: () => Promise<void> | void;
  notify: (msg: string) => void;
}) {
  const [cases, setCases] = useState<LootCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<CaseOpening[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<CaseOpening | null>(null);
  const [spinning, setSpinning] = useState(false);

  const selected = cases.find((c) => c.id === selectedId) || null;

  async function refresh() {
    const [list, opens] = await Promise.all([
      api.casinoCases(),
      api.casinoOpenings(12),
    ]);
    setCases(list);
    setHistory(opens);
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }

  useEffect(() => {
    refresh().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load casino'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openSelected() {
    if (!selected || busy) return;
    const cost = Number(selected.priceCredits);
    if (Number(me.balance) < cost) {
      setError(`Need ${formatStars(cost)} CR — deposit or sell fish first`);
      return;
    }
    setBusy(true);
    setError(null);
    setSpinning(true);
    setReveal(null);
    try {
      // Brief spin for feel, then resolve
      const [result] = await Promise.all([
        api.openCase(selected.id, `case-ui:${me.id}:${selected.id}:${Date.now()}`),
        new Promise((r) => setTimeout(r, 1100)),
      ]);
      setReveal(result);
      setHistory((prev) => [result, ...prev].slice(0, 12));
      await onOpened();
      const profit = Number(result.profit);
      notify(
        profit >= 0
          ? `Hit ${result.symbol} · +${formatStars(result.fishMarketValue)} CR value`
          : `Hit ${result.symbol} · ${formatStars(result.fishMarketValue)} CR value`,
      );
      // Refresh odds/EV after supply change
      const list = await api.casinoCases();
      setCases(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Open failed');
    } finally {
      setSpinning(false);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Casino</div>
          <h1>Cases</h1>
          <p>Spend CR · pull fish into your portfolio</p>
        </div>
        <div className="balance-pill">
          <div className="label">Balance</div>
          <div className="value">{formatStars(me.balance)} CR</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="case-grid">
        {cases.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`case-card ${selectedId === c.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedId(c.id);
              setReveal(null);
            }}
          >
            <div className="case-card-top">
              <span className="case-code">{c.code}</span>
              <span className="case-price">{formatStars(c.priceCredits)} CR</span>
            </div>
            <div className="case-name">{c.name}</div>
            <div className="case-meta">
              EV ~{formatStars(c.expectedValue, 1)} · edge {c.houseEdgePercent}%
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="trade-panel case-panel">
          <div className="section-title" style={{ marginTop: 0 }}>
            {selected.name}
          </div>
          <p className="case-desc">{selected.description}</p>

          <div className={`case-stage ${spinning ? 'spinning' : ''} ${reveal ? 'revealed' : ''}`}>
            {spinning && <div className="case-spin">Opening…</div>}
            {!spinning && reveal && (
              <div className="case-reveal">
                {reveal.imageUrl ? (
                  <img className="glyph" src={reveal.imageUrl} alt="" />
                ) : (
                  <MediaSlot className="thumb" label={fishGlyph(reveal.symbol)} />
                )}
                <div>
                  <div className="eyebrow">{reveal.rarity}</div>
                  <div className="name">{reveal.symbol}</div>
                  <div className="meta">{reveal.name}</div>
                  <div className={`chg ${pnlClass(reveal.profit ?? 0)}`}>
                    Value {formatStars(reveal.fishMarketValue, 2)} CR · paid{' '}
                    {formatStars(reveal.pricePaid)} ·{' '}
                    {Number(reveal.profit ?? 0) >= 0 ? '+' : ''}
                    {formatStars(reveal.profit ?? 0, 2)}
                  </div>
                </div>
              </div>
            )}
            {!spinning && !reveal && (
              <div className="case-idle">Tap Open to pull a fish</div>
            )}
          </div>

          <button
            className="btn btn-solid"
            type="button"
            disabled={busy}
            onClick={openSelected}
          >
            {busy
              ? 'Opening…'
              : `Open · ${formatStars(selected.priceCredits)} CR`}
          </button>

          <div className="section-title">Drop table</div>
          <div className="loot-list">
            {selected.loot.map((item) => (
              <div
                key={item.fishId}
                className={`loot-row ${item.available ? '' : 'soldout'}`}
              >
                {item.imageUrl ? (
                  <img className="glyph" src={item.imageUrl} alt="" />
                ) : (
                  <MediaSlot className="thumb" label={fishGlyph(item.symbol)} />
                )}
                <div className="row-main">
                  <div className="name">
                    {item.symbol}
                    <span className="loot-rarity"> {item.rarity}</span>
                  </div>
                  <div className="meta">
                    {formatStars(item.marketPrice, 2)} CR
                    {!item.available ? ' · sold out' : ''}
                  </div>
                </div>
                <div className="row-side">
                  <div className="price">{item.chancePercent.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">Recent opens</div>
      {history.length === 0 && (
        <div className="state-box" style={{ padding: '28px 12px' }}>
          No opens yet. Pick a case.
        </div>
      )}
      <div className="list">
        {history.map((o) => (
          <div key={o.id} className="row" style={{ cursor: 'default' }}>
            {o.imageUrl ? (
              <img className="glyph" src={o.imageUrl} alt="" />
            ) : (
              <MediaSlot className="thumb" label={fishGlyph(o.symbol)} />
            )}
            <div className="row-main">
              <div className="name">{o.symbol}</div>
              <div className="meta">
                {o.caseName} · {new Date(o.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <div className="row-side">
              <div className="price">{formatStars(o.fishMarketValue, 1)}</div>
              <div className={`chg ${pnlClass(o.profit ?? 0)}`}>
                {Number(o.profit ?? 0) >= 0 ? '+' : ''}
                {formatStars(o.profit ?? 0, 1)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
