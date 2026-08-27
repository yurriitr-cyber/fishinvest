import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  api,
  type CaseLootItem,
  type CaseOpening,
  type LootCase,
  type Me,
} from '../lib/api';
import { fishImage, formatCredits, pnlClass } from '../lib/format';
import {
  caseDesc,
  caseName,
  fishName,
  rarityLabel,
  translateError,
} from '../lib/labels';
import { hapticImpact, hapticNotify } from '../lib/telegram';

const CASE_ART: Record<string, string> = {
  DAILY: '/cases/DAILY.jpg?v=1',
  TIDE: '/cases/TIDE.jpg',
  REEF: '/cases/REEF.jpg',
  ABYSS: '/cases/ABYSS.jpg',
  LEVIATHAN: '/cases/LEVIATHAN.jpg',
};

function caseArt(code: string) {
  return CASE_ART[code.toUpperCase()] || `/cases/${code.toUpperCase()}.jpg`;
}

/** Reel geometry — cell + gap must match CSS. */
const CELL = 88;
const GAP = 10;
const STRIDE = CELL + GAP;
const REEL_LEN = 60;
const WIN_INDEX = 51;
const SPIN_MS = 4600;

/** Haptic ticks roughly following the deceleration curve. */
const TICK_MS = [0, 240, 520, 850, 1250, 1720, 2250, 2820, 3380, 3880, 4270, 4520];

function rarityClass(rarity: string) {
  return `r-${rarity.toLowerCase()}`;
}

function buildReel(loot: CaseLootItem[], winner: CaseLootItem): CaseLootItem[] {
  const pool = loot.filter((i) => i.available);
  const source = pool.length ? pool : loot;
  const total = source.reduce((s, i) => s + i.weight, 0) || 1;

  const pick = () => {
    let roll = Math.random() * total;
    for (const item of source) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return source[source.length - 1];
  };

  const cells = Array.from({ length: REEL_LEN }, pick);
  cells[WIN_INDEX] = winner;
  return cells;
}

function ReelCell({ item, won = false }: { item: CaseLootItem; won?: boolean }) {
  return (
    <div className={`reel-cell ${rarityClass(item.rarity)} ${won ? 'won' : ''}`}>
      <div className="reel-cell-art">
        <img src={fishImage(item.symbol, item.imageUrl)} alt="" />
      </div>
      <div className="reel-cell-sym">{fishName(item.symbol, item.name)}</div>
      <div className="reel-cell-price">{formatCredits(item.marketPrice)}</div>
    </div>
  );
}

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
  const [showTable, setShowTable] = useState(false);
  const [fastMode, setFastMode] = useState(false);

  const [reel, setReel] = useState<CaseLootItem[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [reveal, setReveal] = useState<CaseOpening | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  const selected = cases.find((c) => c.id === selectedId) || null;
  const balance = Number(me.balance);
  const freeReady =
    !selected?.isFreeDaily || selected.canOpenFree !== false;
  const canAfford =
    !!selected &&
    freeReady &&
    (selected.isFreeDaily || balance >= Number(selected.priceCredits));

  function freeCountdown(iso: string | null | undefined) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return null;
    const mins = Math.ceil(ms / 60_000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  }

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const load = useCallback(async () => {
    const [list, opens] = await Promise.all([
      api.casinoCases(),
      api.casinoOpenings(12),
    ]);
    setCases(list);
    setHistory(opens);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    load().catch((e) =>
      setError(
        translateError(
          e instanceof Error ? e.message : 'Не удалось загрузить',
        ),
      ),
    );
  }, [load]);

  // Ticket prices track live fish prices, so keep them fresh while idle.
  useEffect(() => {
    if (busy) return;
    const t = setInterval(() => {
      api.casinoCases().then(setCases).catch(() => undefined);
    }, 15000);
    return () => clearInterval(t);
  }, [busy]);

  const bestDrop = useMemo(() => {
    if (!selected) return null;
    return [...selected.loot].sort(
      (a, b) => Number(b.marketPrice) - Number(a.marketPrice),
    )[0];
  }, [selected]);

  // Odds bars read better scaled against the likeliest drop than against 100%.
  const maxChance = useMemo(
    () => Math.max(1, ...(selected?.loot.map((l) => l.chancePercent) ?? [])),
    [selected],
  );

  function selectCase(id: string, tile?: HTMLElement) {
    if (busy) return;
    tile?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    clearTimers();
    setSelectedId(id);
    setReveal(null);
    setReel(null);
    setSliding(false);
    setOffset(0);
    setShowTable(false);
    void hapticImpact('light');
  }

  function finishReveal(result: CaseOpening) {
    setReveal(result);
    setBusy(false);
    const profit = Number(result.profit ?? 0);
    void hapticNotify(profit >= 0 ? 'success' : 'warning');
    notify(
      `${fishName(result.symbol, result.name)} · ${formatCredits(result.fishMarketValue)} CR`,
    );
  }

  async function openSelected() {
    if (!selected || busy) return;
    if (selected.isFreeDaily && selected.canOpenFree === false) {
      const left = freeCountdown(selected.nextFreeAt);
      setError(left ? `Бесплатный кейс через ${left}` : 'Бесплатный кейс ещё недоступен');
      void hapticNotify('error');
      return;
    }
    const cost = Number(selected.priceCredits);
    if (!selected.isFreeDaily && balance < cost) {
      setError(
        `Нужно ${formatCredits(cost)} CR — пополните баланс или продайте рыбу`,
      );
      void hapticNotify('error');
      return;
    }

    clearTimers();
    setBusy(true);
    setError(null);
    setReveal(null);
    void hapticImpact('medium');

    let result: CaseOpening;
    try {
      result = await api.openCase(
        selected.id,
        `case-ui:${me.id}:${selected.id}:${Date.now()}`,
        cost,
      );
    } catch (e) {
      setError(
        translateError(e instanceof Error ? e.message : 'Не удалось открыть'),
      );
      void hapticNotify('error');
      setBusy(false);
      return;
    }

    void onOpened();
    setHistory((prev) => [result, ...prev].slice(0, 12));
    api.casinoCases().then(setCases).catch(() => undefined);

    if (fastMode) {
      setReel(null);
      finishReveal(result);
      return;
    }

    const winner: CaseLootItem =
      selected.loot.find((l) => l.fishId === result.fishId) || {
        fishId: result.fishId,
        symbol: result.symbol,
        name: result.name,
        rarity: result.rarity,
        imageUrl: result.imageUrl,
        quantity: result.quantity,
        weight: 1,
        chancePercent: 0,
        marketPrice: result.fishUnitPrice,
        available: true,
      };

    const cells = buildReel(selected.loot, winner);
    setReel(cells);
    setSliding(false);
    setOffset(0);

    requestAnimationFrame(() => {
      const width = viewportRef.current?.clientWidth ?? 320;
      // Land the winning cell under the centre marker, with slight jitter
      const jitter = (Math.random() - 0.5) * (CELL * 0.5);
      const target = WIN_INDEX * STRIDE + CELL / 2 - width / 2 + jitter;
      setSliding(true);
      setOffset(target);

      TICK_MS.forEach((at) => {
        timers.current.push(
          window.setTimeout(() => void hapticImpact('light'), at),
        );
      });
      timers.current.push(
        window.setTimeout(() => finishReveal(result), SPIN_MS + 120),
      );
    });
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> Казино
          </div>
          <h1>Кейсы</h1>
          <p>Тратьте кредиты · ловите рыбу в портфель</p>
        </div>
        <div className="balance-pill">
          <div className="label">Баланс</div>
          <div className="value">{formatCredits(me.balance)} CR</div>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="case-rail">
        {cases.map((c, i) => {
          const freeLocked = c.isFreeDaily && c.canOpenFree === false;
          const affordable =
            c.isFreeDaily
              ? !freeLocked
              : balance >= Number(c.priceCredits);
          const wait = freeLocked ? freeCountdown(c.nextFreeAt) : null;
          return (
            <button
              key={c.id}
              type="button"
              className={`case-tile ${
                c.isFreeDaily ? 'tier-free' : `tier-${Math.min(i, 3)}`
              } ${selectedId === c.id ? 'active' : ''} ${
                affordable ? '' : 'locked'
              }`}
              onClick={(e) => selectCase(c.id, e.currentTarget)}
            >
              <span className="case-shine" aria-hidden />
              <div className="case-tile-art">
                <img
                  src={caseArt(c.code)}
                  alt=""
                  className="case-art-img"
                  draggable={false}
                />
              </div>
              <div className="case-tile-name">{caseName(c.code, c.name)}</div>
              <div className="case-tile-price">
                {c.isFreeDaily
                  ? wait
                    ? `через ${wait}`
                    : 'Бесплатно'
                  : `${formatCredits(c.priceCredits)} CR`}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="trade-panel case-panel">
          <div className="case-head">
            <div>
              <div className="eyebrow">Кейс</div>
              <div className="case-title">
                {caseName(selected.code, selected.name)}
              </div>
              <p className="case-desc">
                {caseDesc(selected.code, selected.description)}
              </p>
            </div>
            {bestDrop && (
              <div className="case-top-drop">
                <div className="label">Топ-дроп</div>
                <div className={`value ${rarityClass(bestDrop.rarity)}`}>
                  {fishName(bestDrop.symbol, bestDrop.name)}
                </div>
                <div className="sub">
                  {formatCredits(bestDrop.marketPrice)} CR
                </div>
              </div>
            )}
          </div>

          <div className={`reel ${sliding ? 'live' : ''} ${reveal ? 'done' : ''}`}>
            <div className="reel-viewport" ref={viewportRef}>
              {reel ? (
                <div
                  className={`reel-track ${sliding ? 'sliding' : ''}`}
                  style={{
                    transform: `translate3d(${-offset}px, 0, 0)`,
                    transitionDuration: sliding ? `${SPIN_MS}ms` : '0ms',
                  }}
                >
                  {reel.map((item, i) => (
                    <ReelCell
                      key={`${item.fishId}-${i}`}
                      item={item}
                      won={!!reveal && i === WIN_INDEX}
                    />
                  ))}
                </div>
              ) : (
                <div
                  className="reel-track idle"
                  style={{ '--drift': `${selected.loot.length * STRIDE}px` } as CSSProperties}
                >
                  {[0, 1, 2].map((copy) =>
                    selected.loot.map((item) => (
                      <ReelCell key={`${copy}-${item.fishId}`} item={item} />
                    )),
                  )}
                </div>
              )}
            </div>
            <span className="reel-marker" aria-hidden />
          </div>

          {reveal && (
            <div className={`win-card ${rarityClass(reveal.rarity)}`}>
              <span className="win-glow" aria-hidden />
              <div className="win-art">
                <img src={fishImage(reveal.symbol, reveal.imageUrl)} alt="" />
              </div>
              <div className="win-body">
                <div className="win-rarity">Выпало</div>
                <div className="win-symbol">
                  {fishName(reveal.symbol, reveal.name)}
                </div>
                <div className="win-name">{rarityLabel(reveal.rarity)}</div>
                <div className="win-stats">
                  <span>Стоимость {formatCredits(reveal.fishMarketValue)} CR</span>
                  <span className={pnlClass(reveal.profit ?? 0)}>
                    {Number(reveal.profit ?? 0) >= 0 ? '+' : ''}
                    {formatCredits(reveal.profit ?? 0)} к цене
                  </span>
                </div>
              </div>
            </div>
          )}

          <button
            className="btn btn-solid case-open"
            type="button"
            disabled={busy || !canAfford}
            onClick={openSelected}
          >
            {busy
              ? 'Крутим…'
              : selected.isFreeDaily && selected.canOpenFree === false
                ? `Через ${freeCountdown(selected.nextFreeAt) || '…'}`
                : !canAfford
                  ? `Нужно ещё ${formatCredits(Number(selected.priceCredits) - balance)} CR`
                  : reveal
                    ? selected.isFreeDaily
                      ? 'Открыто · следующий через 24 ч'
                      : `Открыть ещё · ${formatCredits(selected.priceCredits)} CR`
                    : selected.isFreeDaily
                      ? 'Открыть бесплатно'
                      : `Открыть кейс · ${formatCredits(selected.priceCredits)} CR`}
          </button>

          <div className="case-footer">
            <button
              type="button"
              className={`chip ${fastMode ? 'active' : ''}`}
              onClick={() => setFastMode((v) => !v)}
              disabled={busy}
            >
              Быстрое открытие
            </button>
            <button
              type="button"
              className={`chip ${showTable ? 'active' : ''}`}
              onClick={() => setShowTable((v) => !v)}
            >
              Шансы
            </button>
            <span className="case-edge">
              {selected.isFreeDaily
                ? 'Бесплатно · 1 раз / 24 ч'
                : `EV ${formatCredits(selected.expectedValue)} · маржа ${selected.houseEdgePercent}%`}
            </span>
          </div>

          {showTable && (
            <div className="loot-list">
              {selected.loot.map((item) => (
                <div
                  key={item.fishId}
                  className={`loot-row ${rarityClass(item.rarity)} ${
                    item.available ? '' : 'soldout'
                  }`}
                >
                  <div className="loot-art">
                    <img src={fishImage(item.symbol, item.imageUrl)} alt="" />
                  </div>
                  <div className="row-main">
                    <div className="name">{fishName(item.symbol, item.name)}</div>
                    <div className="meta">
                      {rarityLabel(item.rarity)} ·{' '}
                      {formatCredits(item.marketPrice)} CR
                      {item.available ? '' : ' · распродано'}
                    </div>
                    <div className="odds-bar" aria-hidden>
                      <span
                        style={{
                          width: `${Math.max(2, (item.chancePercent / maxChance) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="row-side">
                    <div className="price">{item.chancePercent.toFixed(1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="section-title">Недавние открытия</div>
      {history.length === 0 && (
        <div className="state-box" style={{ padding: '28px 12px' }}>
          Пока пусто. Выберите кейс выше.
        </div>
      )}
      <div className="list">
        {history.map((o) => (
          <div
            key={o.id}
            className={`row loot-history ${rarityClass(o.rarity)}`}
            style={{ cursor: 'default' }}
          >
            <img
              className="glyph"
              src={fishImage(o.symbol, o.imageUrl)}
              alt=""
            />
            <div className="row-main">
              <div className="name">{fishName(o.symbol, o.name)}</div>
              <div className="meta">
                {caseName(o.caseCode, o.caseName)} ·{' '}
                {new Date(o.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <div className="row-side">
              <div className="price">{formatCredits(o.fishMarketValue)}</div>
              <div className={`chg ${pnlClass(o.profit ?? 0)}`}>
                {Number(o.profit ?? 0) >= 0 ? '+' : ''}
                {formatCredits(o.profit ?? 0)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
