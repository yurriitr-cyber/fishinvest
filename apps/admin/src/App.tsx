import { useEffect, useRef, useState } from 'react';
import {
  adminApi,
  clearAdminSession,
  getAdminSession,
  getDevTelegramId,
  logoutAdmin,
  setAdminSession,
  setDevTelegramId,
  type AdminUser,
  type AdminUserDetail,
  type AuditItem,
  type CasinoStats,
  type Deposit,
  type Fish,
  type MarketEvent,
  type Payment,
  type PromoCode,
  type SecurityOverview,
} from './api';
import { caseName, fishName, ledgerLabel, rarityLabel } from './labels';

type Tab =
  | 'dashboard'
  | 'targets'
  | 'fish'
  | 'users'
  | 'broadcast'
  | 'payments'
  | 'promo'
  | 'deposits'
  | 'events'
  | 'casino'
  | 'audit'
  | 'security';

const NAV: Array<{ id: Tab; label: string; group?: string }> = [
  { id: 'dashboard', label: 'Обзор', group: 'Главное' },
  { id: 'targets', label: 'Рампа 24ч' },
  { id: 'fish', label: 'Цены / фриз' },
  { id: 'users', label: 'Пользователи', group: 'Люди' },
  { id: 'broadcast', label: 'Рассылка' },
  { id: 'deposits', label: 'Депозиты' },
  { id: 'payments', label: 'Платежи', group: 'Экономика' },
  { id: 'promo', label: 'Промокоды' },
  { id: 'events', label: 'События рынка' },
  { id: 'casino', label: 'Кейсы' },
  { id: 'audit', label: 'Аудит', group: 'Система' },
  { id: 'security', label: 'Безопасность' },
];

function n(v: string | number | null | undefined, d = 2) {
  const x = Number(v ?? 0);
  return Number.isFinite(x)
    ? x.toLocaleString('ru-RU', { maximumFractionDigits: d })
    : '—';
}

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch {
    return iso;
  }
}

function ago(iso?: string | null) {
  if (!iso) return 'никогда';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return when(iso);
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

const ONLINE_MS = 5 * 60_000;

function presence(iso?: string | null) {
  if (!iso) return { label: 'Никогда не заходил', tone: 'off' as const };
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return { label: 'Неизвестно', tone: 'off' as const };
  if (ms < ONLINE_MS) return { label: 'Онлайн', tone: 'on' as const };
  if (ms < 86_400_000) return { label: `Был ${ago(iso)}`, tone: 'recent' as const };
  return { label: `Офлайн · ${ago(iso)}`, tone: 'off' as const };
}

function tenure(iso?: string) {
  if (!iso) return '—';
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
  if (days < 1) return 'сегодня';
  if (days < 30) return `${days} дн.`;
  return `${days} дн. · ${Math.floor(days / 30)} мес.`;
}

function eventWhen(iso?: string | null) {
  if (!iso) return 'нет';
  return `${ago(iso)} · ${when(iso)}`;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function Ocean() {
  return (
    <div className="ocean" aria-hidden>
      <span className="ocean-rays" />
      <span className="ocean-caustics" />
      <span className="ocean-floor" />
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [tgId, setTgId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [meOk, setMeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionExp, setSessionExp] = useState(
    () => getAdminSession()?.expiresAt || '',
  );

  const [dash, setDash] = useState<Record<string, unknown> | null>(null);
  const [fish, setFish] = useState<Fish[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const userDetailRef = useRef<HTMLDivElement>(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [balanceReason, setBalanceReason] = useState('пополнение админом');
  const [adjustDelta, setAdjustDelta] = useState('50');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [oracle, setOracle] = useState<Awaited<
    ReturnType<typeof adminApi.oracles>
  > | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [casino, setCasino] = useState<CasinoStats | null>(null);
  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [q, setQ] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'banned' | 'active' | 'funded'>(
    'all',
  );
  const [giftFishId, setGiftFishId] = useState('');
  const [giftQty, setGiftQty] = useState('1');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastFile, setBroadcastFile] = useState<File | null>(null);
  const [broadcastPreview, setBroadcastPreview] = useState<string | null>(null);
  const [broadcastAudience, setBroadcastAudience] = useState<{
    recipients: number;
    botConfigured: boolean;
  } | null>(null);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [promoForm, setPromoForm] = useState({
    code: '',
    kind: 'BALANCE' as 'BALANCE' | 'FISH' | 'CASE',
    amount: '100',
    fishId: '',
    caseId: '',
    quantity: '1',
    maxUses: '',
    expiresAt: '',
    note: '',
  });

  const [eventForm, setEventForm] = useState({
    name: '',
    description: '',
    fishId: '',
    priceMultiplier: '1.1',
    startTime: '',
    endTime: '',
  });

  async function boot() {
    setError(null);
    try {
      const me = await adminApi.me();
      if (!me.isAdmin) {
        throw new Error('Нет доступа');
      }
      setMeOk(true);
    } catch (e) {
      setMeOk(false);
      setError(e instanceof Error ? e.message : 'Ошибка авторизации');
    }
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const id = Number(tgId.trim());
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Неверный логин или пароль');
      }
      if (secret.trim().length < 8) {
        throw new Error('Неверный логин или пароль');
      }
      setDevTelegramId(String(id));
      const session = await adminApi.login(id, secret.trim());
      setAdminSession(session.token, session.expiresAt);
      setSessionExp(session.expiresAt);
      setSecret('');
      setTgId('');
      setOkMsg('Вход выполнен');
      await boot();
    } catch (e) {
      setMeOk(false);
      setError(e instanceof Error ? e.message : 'Вход не удался');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    logoutAdmin();
    clearAdminSession();
    setMeOk(false);
    setSessionExp('');
    setTgId('');
    setSecret('');
    setDash(null);
    setSelectedUser(null);
    setOkMsg('Вы вышли');
  }

  async function loadUsers(query = q) {
    const res = await adminApi.users(query || undefined);
    setUsers(res.users);
    setUsersTotal(res.total);
    return res;
  }

  async function openUser(id: string) {
    const detail = await adminApi.user(id);
    setSelectedUser(detail);
    setBalanceInput(String(Number(detail.gameBalance?.available ?? 0)));
    setBalanceReason('пополнение админом');
    setGiftFishId(fish[0]?.id ?? '');
    setGiftQty('1');
    setOkMsg(null);
    setError(null);
  }

  useEffect(() => {
    if (!selectedUser) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedUser?.id]);

  useEffect(() => {
    if (getDevTelegramId() && getAdminSession()) boot();
  }, []);

  useEffect(() => {
    if (!meOk) return;
    setError(null);
    (async () => {
      try {
        if (tab === 'dashboard') setDash(await adminApi.dashboard());
        if (tab === 'fish' || tab === 'targets' || tab === 'events') {
          const list = await adminApi.fish();
          setFish(list);
          if (tab === 'targets') {
            const next: Record<string, string> = {};
            for (const f of list) {
              next[f.id] = String(Number(f.dailyTargetPercent ?? 0));
            }
            setTargets(next);
          }
        }
        if (tab === 'users') {
          await loadUsers();
          setFish(await adminApi.fish());
        }
        if (tab === 'payments') {
          setPayments(await adminApi.paymentSettings());
          setOracle(await adminApi.oracles());
        }
        if (tab === 'deposits') setDeposits(await adminApi.deposits());
        if (tab === 'audit') setAudit(await adminApi.audit());
        if (tab === 'events') setEvents(await adminApi.events());
        if (tab === 'casino') setCasino(await adminApi.casino());
        if (tab === 'security') setSecurity(await adminApi.security());
        if (tab === 'broadcast') {
          setBroadcastAudience(await adminApi.broadcastAudience());
        }
        if (tab === 'promo') {
          const [codes, fishList, casinoStats] = await Promise.all([
            adminApi.promoCodes(),
            adminApi.fish(),
            adminApi.casino(),
          ]);
          setPromos(codes);
          setFish(fishList);
          setCasino(casinoStats);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      }
    })();
  }, [tab, meOk]);

  useEffect(() => {
    if (!meOk || tab !== 'users') return;
    const id = setInterval(() => {
      void loadUsers().catch(() => undefined);
    }, 15000);
    return () => clearInterval(id);
  }, [meOk, tab]);

  useEffect(() => {
    if (!meOk || tab !== 'targets') return;
    const id = setInterval(async () => {
      try {
        setFish(await adminApi.fish());
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [meOk, tab]);

  function readFileBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
  }

  async function sendBroadcast(test: boolean) {
    const text = broadcastText.trim();
    if (!text && !broadcastFile) {
      setError('Введите текст или прикрепите фото');
      return;
    }
    if (!test) {
      const nRecipients = broadcastAudience?.recipients ?? 0;
      if (
        !window.confirm(
          `Отправить ${nRecipients} пользователям? Это уйдёт всем в бот.`,
        )
      ) {
        return;
      }
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const photoBase64 = broadcastFile
        ? await readFileBase64(broadcastFile)
        : undefined;
      const res = await adminApi.broadcast({
        message: text || undefined,
        photoBase64,
        photoFilename: broadcastFile?.name,
        test,
      });
      const bits = [
        test ? 'Тест себе' : 'Рассылка',
        `доставлено ${res.sent} из ${res.recipients}`,
      ];
      if (res.blocked) bits.push(`заблокировали бота: ${res.blocked}`);
      if (res.failed) bits.push(`ошибок: ${res.failed}`);
      setOkMsg(bits.join(' · '));
      setBroadcastAudience(await adminApi.broadcastAudience());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setBusy(false);
    }
  }

  async function saveAllTargets() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const payload = fish.map((f) => ({
        fishId: f.id,
        percent: Number(targets[f.id] ?? 0),
      }));
      const res = await adminApi.setDailyTargets(payload, 24);
      setOkMsg(
        `Рампа запущена: ${res.updated} рыб достигнут цели за ${res.durationHours} ч (не мгновенно)`,
      );
      const list = await adminApi.fish();
      setFish(list);
      const next: Record<string, string> = {};
      for (const f of list) {
        next[f.id] = String(Number(f.dailyTargetPercent ?? 0));
      }
      setTargets(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  function bumpTarget(id: string, delta: number) {
    setTargets((prev) => {
      const cur = Number(prev[id] ?? 0);
      const next = Math.round((cur + delta) * 10) / 10;
      return { ...prev, [id]: String(Math.max(-90, Math.min(500, next))) };
    });
  }

  if (!meOk) {
    return (
      <>
        <Ocean />
        <div className="login-wrap">
          <div className="login-card">
            <h1>Rare Fish</h1>
            <p className="lead">Админ-панель</p>
            {error && <div className="toast-error">{error}</div>}
            {okMsg && <div className="toast-ok">{okMsg}</div>}
            <div className="stack">
              <label className="field">
                <span>Логин</span>
                <input
                  value={tgId}
                  onChange={(e) => setTgId(e.target.value)}
                  placeholder=""
                  autoComplete="username"
                />
              </label>
              <label className="field">
                <span>Пароль</span>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder=""
                  autoComplete="current-password"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={signIn}
              >
                {busy ? 'Вход…' : 'Войти'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Ocean />
      <div className="layout">
        <aside className="side">
          <div className="brand">
            Rare Fish
            <span>Админ-панель</span>
          </div>
          <nav>
            {NAV.map((item, i) => (
              <div key={item.id}>
                {item.group && (i === 0 || NAV[i - 1]?.group !== item.group) ? (
                  <div className="nav-group">{item.group}</div>
                ) : null}
                <button
                  type="button"
                  className={`nav-btn${tab === item.id ? ' active' : ''}`}
                  onClick={() => {
                    setTab(item.id);
                    setOkMsg(null);
                    setError(null);
                  }}
                >
                  {item.label}
                </button>
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <div className="session-chip">
              <div>
                <div className="dim">Сессия</div>
                <div className="mono" style={{ fontSize: 12 }}>
                  tg {tgId || '—'}
                </div>
                {sessionExp ? (
                  <div className="dim" style={{ fontSize: 11 }}>
                    до {when(sessionExp)}
                  </div>
                ) : null}
              </div>
              <button type="button" className="btn btn-sm" onClick={signOut}>
                Выйти
              </button>
            </div>
          </div>
        </aside>

        <main className="main">
          {error && <div className="toast-error">{error}</div>}
          {okMsg && <div className="toast-ok">{okMsg}</div>}

          {tab === 'dashboard' && dash && (
            <>
              <div className="grid-stats">
                <div className="stat">
                  <div className="label">Пользователи</div>
                  <div className="value">{n(dash.users as number, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Активны 24ч</div>
                  <div className="value">{n(dash.activeUsers24h as number, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Кредиты в игре</div>
                  <div className="value">{n(dash.totalGameCredits as string)}</div>
                </div>
                <div className="stat">
                  <div className="label">Объём торгов</div>
                  <div className="value">{n(dash.tradingVolume as string)}</div>
                </div>
                <div className="stat">
                  <div className="label">Сделок</div>
                  <div className="value">{n(dash.tradesCount as number, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Кейсы 24ч</div>
                  <div className="value">{n(dash.openings24h as number, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Депозиты 24ч</div>
                  <div className="value">
                    {n(dash.depositsConfirmed24h as number, 0)}
                  </div>
                </div>
              </div>
              <div className="detail-grid">
                <div className="panel">
                  <h2>Топ рыб</h2>
                  {((dash.topFish as Fish[]) || []).map((f) => (
                    <div key={f.id} className="row" style={{ gridTemplateColumns: '1fr 0.6fr 0.7fr 0.5fr' }}>
                      <div>{fishName(f.symbol, f.name)}</div>
                      <div className="mono muted">{f.symbol}</div>
                      <div className="mono">{n(f.currentPrice ?? f.price)}</div>
                      <div className={`mono ${Number(f.change ?? f.dailyChangePercent) >= 0 ? 'ok' : 'down'}`}>
                        {n(f.change ?? f.dailyChangePercent, 1)}%
                      </div>
                    </div>
                  ))}
                </div>
                <div className="panel">
                  <h2>Топ портфелей</h2>
                  {((dash.topUsers as Array<{
                    id: string;
                    displayName: string;
                    portfolioValue: string;
                    telegramId: string;
                  }>) || []).map((u) => (
                    <div key={u.id} className="row" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
                      <div>
                        {u.displayName}{' '}
                        <span className="muted mono">{u.telegramId}</span>
                      </div>
                      <div className="mono ok">{n(u.portfolioValue)} CR</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'targets' && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Рампа цены на 24 часа</h2>
                  <p className="muted">
                    Задайте целевой ±%. После «Запустить» цена плавно идёт к
                    цели за сутки — без мгновенного скачка.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={saveAllTargets}
                >
                  {busy ? 'Запуск…' : 'Запустить рампу 24ч'}
                </button>
              </div>
              <div className="row header targets-grid">
                <div>Рыба</div>
                <div>Сейчас → цель</div>
                <div>Прогресс</div>
                <div>% / 24ч</div>
              </div>
              {fish.map((f) => {
                const pct = Number(targets[f.id] ?? 0);
                const price = Number(f.currentPrice);
                const preview =
                  Number.isFinite(price) && Number.isFinite(pct)
                    ? price * (1 + pct / 100)
                    : null;
                const active =
                  f.rampEndAt && new Date(f.rampEndAt).getTime() > Date.now();
                return (
                  <div key={f.id} className="row targets-grid">
                    <div>
                      <strong>{fishName(f.symbol, f.name)}</strong>
                      <div className="muted mono">{f.symbol}</div>
                    </div>
                    <div className="mono">
                      {n(f.currentPrice, 2)}
                      {preview != null && pct !== 0 ? (
                        <>
                          {' → '}
                          <span className="ok">{n(preview, 2)}</span>
                        </>
                      ) : null}
                    </div>
                    <div>
                      {active && f.rampToPrice != null ? (
                        <>
                          <div className="muted" style={{ fontSize: 12 }}>
                            → {n(f.rampToPrice, 2)}
                            {f.rampProgress != null
                              ? ` · ${Math.round(f.rampProgress * 100)}%`
                              : ''}
                          </div>
                          <div className="progress">
                            <i
                              style={{
                                width: `${Math.round((f.rampProgress ?? 0) * 100)}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <span className="dim">ожидание</span>
                      )}
                    </div>
                    <div className="stepper">
                      <button type="button" className="btn btn-sm" onClick={() => bumpTarget(f.id, -5)}>−5</button>
                      <button type="button" className="btn btn-sm" onClick={() => bumpTarget(f.id, -1)}>−</button>
                      <input
                        className="target-input"
                        inputMode="decimal"
                        value={targets[f.id] ?? '0'}
                        onChange={(e) =>
                          setTargets((prev) => ({
                            ...prev,
                            [f.id]: e.target.value,
                          }))
                        }
                      />
                      <button type="button" className="btn btn-sm" onClick={() => bumpTarget(f.id, 1)}>+</button>
                      <button type="button" className="btn btn-sm" onClick={() => bumpTarget(f.id, 5)}>+5</button>
                      <button type="button" className="btn btn-sm" onClick={() => bumpTarget(f.id, 10)}>+10</button>
                    </div>
                  </div>
                );
              })}
              <div className="toolbar" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const next: Record<string, string> = {};
                    for (const f of fish) next[f.id] = '0';
                    setTargets(next);
                  }}
                >
                  Все в 0 (сброс рамп при сохранении)
                </button>
              </div>
            </div>
          )}

          {tab === 'fish' && (
            <div className="panel">
              <h2>Ручная цена и заморозка</h2>
              <p className="muted" style={{ marginBottom: 12 }}>
                Для плавного +10% за день используйте «Рампа 24ч», не этот раздел.
              </p>
              <div className="row header">
                <div>Название</div>
                <div>Цена</div>
                <div>Изм.</div>
                <div>Действия</div>
              </div>
              {fish.map((f) => (
                <div key={f.id} className="row">
                  <div>
                    {fishName(f.symbol, f.name)}{' '}
                    <span className="muted mono">{f.symbol}</span>
                    {f.isFrozen ? (
                      <span className="badge badge-warn" style={{ marginLeft: 8 }}>
                        фриз
                      </span>
                    ) : null}
                  </div>
                  <div className="mono">{n(f.currentPrice)}</div>
                  <div className={`mono ${Number(f.dailyChangePercent) >= 0 ? 'ok' : 'down'}`}>
                    {n(f.dailyChangePercent, 1)}%
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const raw = window.prompt(
                          'Новая цена',
                          String(Number(f.currentPrice)),
                        );
                        if (!raw) return;
                        const reason =
                          window.prompt('Причина', 'ручная цена') || 'ручная цена';
                        await adminApi.setPrice(f.id, Number(raw), reason);
                        setFish(await adminApi.fish());
                        setOkMsg(`Цена ${fishName(f.symbol, f.name)} → ${raw}`);
                      }}
                    >
                      Цена
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        if (f.isFrozen) await adminApi.unfreeze(f.id);
                        else await adminApi.freeze(f.id);
                        setFish(await adminApi.fish());
                      }}
                    >
                      {f.isFrozen ? 'Разморозить' : 'Заморозить'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'users' && (
            <>
              <div className="toolbar">
                <label className="field" style={{ flex: 2 }}>
                  <span>Поиск (необязательно)</span>
                  <input
                    placeholder="username или telegram id — пусто = все"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void loadUsers(e.currentTarget.value).catch((err) =>
                          setError(
                            err instanceof Error ? err.message : 'Ошибка поиска',
                          ),
                        );
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      await loadUsers();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Ошибка поиска');
                    }
                  }}
                >
                  Обновить
                </button>
                {q ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      setQ('');
                      try {
                        await loadUsers('');
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : 'Ошибка загрузки',
                        );
                      }
                    }}
                  >
                    Показать всех
                  </button>
                ) : null}
                {(
                  [
                    ['all', 'Все'],
                    ['active', 'Активны 24ч'],
                    ['funded', 'С балансом'],
                    ['banned', 'Бан'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn btn-sm ${userFilter === id ? 'btn-primary' : ''}`}
                    onClick={() => setUserFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="users-stack">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Все пользователи</h2>
                    <p className="muted">
                      Показано{' '}
                      {
                        users.filter((u) => {
                          if (userFilter === 'banned') return u.status === 'BANNED';
                          if (userFilter === 'funded')
                            return Number(u.gameBalance?.available ?? 0) > 0;
                          if (userFilter === 'active')
                            return (
                              !!u.lastSeenAt &&
                              Date.now() - new Date(u.lastSeenAt).getTime() <
                                86_400_000
                            );
                          return true;
                        }).length
                      }{' '}
                      из {users.length}
                      {usersTotal > users.length ? ` (всего ${usersTotal})` : ''}
                    </p>
                  </div>
                </div>
                <div className="row header">
                  <div>Имя</div>
                  <div>Telegram</div>
                  <div>Баланс</div>
                  <div>Действия</div>
                </div>
                {users
                  .filter((u) => {
                    if (userFilter === 'banned') return u.status === 'BANNED';
                    if (userFilter === 'funded')
                      return Number(u.gameBalance?.available ?? 0) > 0;
                    if (userFilter === 'active')
                      return (
                        !!u.lastSeenAt &&
                        Date.now() - new Date(u.lastSeenAt).getTime() < 86_400_000
                      );
                    return true;
                  })
                  .map((u) => (
                  <div key={u.id} className={`row${selectedUser?.id === u.id ? ' selected' : ''}`}>
                    <div>
                      {u.username || u.firstName || 'User'}{' '}
                      {u.status === 'BANNED' ? (
                        <span className="badge badge-danger">бан</span>
                      ) : (
                        <span className="badge">{u.status}</span>
                      )}
                      {u.isAdmin ? (
                        <span className="badge" style={{ marginLeft: 4 }}>
                          admin
                        </span>
                      ) : null}
                      <div className="dim" style={{ fontSize: 11 }}>
                        был {ago(u.lastSeenAt)}
                        {u.createdAt ? ` · с ${when(u.createdAt)}` : ''}
                      </div>
                    </div>
                    <div className="mono">
                      {String(u.telegramId)}
                      <div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => copyText(String(u.telegramId))}
                        >
                          копировать
                        </button>
                      </div>
                    </div>
                    <div className="mono">{n(u.gameBalance?.available)} CR</div>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          void openUser(u.id).catch((err) =>
                            setError(
                              err instanceof Error ? err.message : 'Ошибка',
                            ),
                          );
                        }}
                      >
                        Открыть
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          if (u.status === 'BANNED') await adminApi.unban(u.id);
                          else {
                            const reason =
                              window.prompt('Причина бана', 'нарушение') ||
                              'бан';
                            await adminApi.ban(u.id, reason);
                          }
                          await loadUsers();
                          if (selectedUser?.id === u.id) {
                            setSelectedUser(await adminApi.user(u.id));
                          }
                        }}
                      >
                        {u.status === 'BANNED' ? 'Разбан' : 'Бан'}
                      </button>
                    </div>
                  </div>
                ))}
                {!users.length && (
                  <p className="muted" style={{ marginTop: 12 }}>
                    Пользователей пока нет — как только кто-то откроет Mini App,
                    он появится в этом списке.
                  </p>
                )}
              </div>

              {selectedUser && (
                <div className="panel user-detail" ref={userDetailRef}>
                  <div className="panel-head">
                    <div>
                      <h2>
                        {selectedUser.username || selectedUser.firstName || '—'}
                        {selectedUser.lastName ? ` ${selectedUser.lastName}` : ''}
                      </h2>
                      <p className="muted">
                        <span className="presence">
                          <span
                            className={`presence-dot ${presence(selectedUser.lastSeenAt).tone}`}
                          />
                          {presence(selectedUser.lastSeenAt).label}
                        </span>
                        {' · '}
                        tg {String(selectedUser.telegramId)} · {selectedUser.status}
                        {selectedUser.isAdmin ? ' · admin' : ''}
                        {selectedUser.languageCode
                          ? ` · ${selectedUser.languageCode}`
                          : ''}
                        {selectedUser.referralCode
                          ? ` · реф. ${selectedUser.referralCode}`
                          : ''}
                      </p>
                    </div>
                    <div className="user-detail-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => copyText(String(selectedUser.telegramId))}
                      >
                        Копировать Telegram ID
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setSelectedUser(null)}
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>

                  {selectedUser.referredBy ? (
                    <p className="muted" style={{ marginTop: -6 }}>
                      Пришёл от{' '}
                      {selectedUser.referredBy.username ||
                        selectedUser.referredBy.firstName ||
                        selectedUser.referredBy.telegramId}
                      {selectedUser.referredAt
                        ? ` · ${when(selectedUser.referredAt)}`
                        : ''}
                    </p>
                  ) : null}

                  <div className="grid-stats">
                    <div className="stat">
                      <div className="label">В приложении</div>
                      <div className="value" style={{ fontSize: '1rem' }}>
                        {tenure(selectedUser.createdAt)}
                        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                          с {selectedUser.createdAt ? when(selectedUser.createdAt) : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Последний заход</div>
                      <div className="value" style={{ fontSize: '1rem' }}>
                        {ago(selectedUser.lastSeenAt)}
                        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                          {selectedUser.lastSeenAt
                            ? when(selectedUser.lastSeenAt)
                            : 'Mini App не открывал'}
                        </div>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Последнее действие</div>
                      <div className="value" style={{ fontSize: '1rem' }}>
                        {ago(selectedUser.stats?.lastActionAt)}
                        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                          {selectedUser.stats?.lastActionAt
                            ? when(selectedUser.stats.lastActionAt)
                            : 'сделок, кейсов и депозитов нет'}
                        </div>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Активных дней / 30д</div>
                      <div className="value">
                        {n(selectedUser.stats?.activeDays30 ?? 0, 0)}
                      </div>
                    </div>
                  </div>

                  <table className="activity-table">
                    <thead>
                      <tr>
                        <th>Активность</th>
                        <th>1ч</th>
                        <th>24ч</th>
                        <th>7д</th>
                        <th>30д</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['Сделки', 'trades'],
                          ['Кейсы', 'cases'],
                          ['Депозиты', 'deposits'],
                          ['Движения баланса', 'ledger'],
                        ] as const
                      ).map(([label, key]) => (
                        <tr key={key}>
                          <td>{label}</td>
                          <td className="mono">
                            {selectedUser.stats?.windows?.h1[key] ?? 0}
                          </td>
                          <td className="mono">
                            {selectedUser.stats?.windows?.h24[key] ??
                              (key === 'trades'
                                ? selectedUser.stats?.trades24h ?? 0
                                : key === 'cases'
                                  ? selectedUser.stats?.caseOpenings24h ?? 0
                                  : 0)}
                          </td>
                          <td className="mono">
                            {selectedUser.stats?.windows?.d7[key] ?? 0}
                          </td>
                          <td className="mono">
                            {selectedUser.stats?.windows?.d30[key] ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="grid-stats">
                    <div className="stat">
                      <div className="label">Последняя сделка</div>
                      <div className="value" style={{ fontSize: '0.95rem' }}>
                        {eventWhen(selectedUser.stats?.lastTradeAt)}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Последний кейс</div>
                      <div className="value" style={{ fontSize: '0.95rem' }}>
                        {eventWhen(selectedUser.stats?.lastCaseAt)}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Последний депозит</div>
                      <div className="value" style={{ fontSize: '0.95rem' }}>
                        {eventWhen(selectedUser.stats?.lastDepositAt)}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Последнее движение</div>
                      <div className="value" style={{ fontSize: '0.95rem' }}>
                        {eventWhen(selectedUser.stats?.lastLedgerAt)}
                      </div>
                    </div>
                  </div>

                  <div className="grid-stats">
                    <div className="stat">
                      <div className="label">Кэш</div>
                      <div className="value">
                        {n(selectedUser.stats?.cash ?? selectedUser.gameBalance?.available)} CR
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Портфель</div>
                      <div className="value">
                        {n(selectedUser.stats?.portfolioValue)} CR
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Нетто</div>
                      <div className="value">
                        {n(selectedUser.stats?.netWorth)} CR
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Нереал. P&L</div>
                      <div
                        className={`value ${Number(selectedUser.stats?.unrealizedPnl ?? 0) >= 0 ? 'ok' : 'down'}`}
                      >
                        {n(selectedUser.stats?.unrealizedPnl)}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Реал. P&L</div>
                      <div
                        className={`value ${Number(selectedUser.stats?.realizedPnl ?? 0) >= 0 ? 'ok' : 'down'}`}
                      >
                        {n(selectedUser.stats?.realizedPnl)}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Депозиты</div>
                      <div className="value">
                        {n(selectedUser.stats?.depositsTotal)}{' '}
                        <span className="muted" style={{ fontSize: 12 }}>
                          ×{selectedUser.stats?.depositsCount ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Покупки / продажи</div>
                      <div className="value" style={{ fontSize: '1rem' }}>
                        {n(selectedUser.stats?.buyVolume)} / {n(selectedUser.stats?.sellVolume)}
                        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                          {n(selectedUser.stats?.buyCount, 0)} пок. / {n(selectedUser.stats?.sellCount, 0)} прод.
                        </div>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Кейсы</div>
                      <div className="value" style={{ fontSize: '1rem' }}>
                        {selectedUser.stats?.caseOpenings ?? 0} откр.
                        <div className={`muted ${Number(selectedUser.stats?.casePnl ?? 0) >= 0 ? 'ok' : 'down'}`} style={{ fontSize: 12, marginTop: 4 }}>
                          P&L {n(selectedUser.stats?.casePnl)}
                        </div>
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Рефералы</div>
                      <div className="value">
                        {n(selectedUser.stats?.referralsCount, 0)}
                      </div>
                    </div>
                  </div>

                  <div className="toolbar">
                    <label className="field">
                      <span>Установить баланс</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={balanceInput}
                        onChange={(e) => setBalanceInput(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Причина</span>
                      <input
                        value={balanceReason}
                        onChange={(e) => setBalanceReason(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        const balance = Number(balanceInput);
                        if (!Number.isFinite(balance) || balance < 0) {
                          setError('Введите баланс ≥ 0');
                          return;
                        }
                        const reason =
                          balanceReason.trim() || 'установка баланса';
                        setBusy(true);
                        setError(null);
                        try {
                          const updated = await adminApi.setBalance(
                            selectedUser.id,
                            balance,
                            reason,
                          );
                          setSelectedUser(updated);
                          await loadUsers();
                          setOkMsg(
                            `Баланс → ${n(updated.gameBalance?.available)} CR`,
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Ошибка баланса',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Установить
                    </button>
                  </div>

                  <div className="actions" style={{ marginBottom: 14 }}>
                    {[100, 500, 1000, 3000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setBalanceInput(String(amt))}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>

                  <div className="toolbar">
                    <label className="field">
                      <span>Корректировка (+/−)</span>
                      <input
                        value={adjustDelta}
                        onChange={(e) => setAdjustDelta(e.target.value)}
                        placeholder="50 или -20"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={async () => {
                        const amount = Number(adjustDelta);
                        if (!Number.isFinite(amount) || amount === 0) {
                          setError('Укажите ненулевую сумму');
                          return;
                        }
                        setBusy(true);
                        try {
                          const updated = await adminApi.adjustBalance(
                            selectedUser.id,
                            amount,
                            balanceReason.trim() || 'корректировка',
                          );
                          setSelectedUser(updated);
                          setBalanceInput(
                            String(Number(updated.gameBalance?.available ?? 0)),
                          );
                          await loadUsers();
                          setOkMsg(
                            `Изменение ${amount > 0 ? '+' : ''}${amount} → ${n(updated.gameBalance?.available)} CR`,
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Ошибка корректировки',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Применить +/−
                    </button>
                  </div>

                  <div className="toolbar">
                    <label className="field">
                      <span>Выдать рыбу</span>
                      <select
                        value={giftFishId}
                        onChange={(e) => setGiftFishId(e.target.value)}
                      >
                        <option value="">Выберите рыбу</option>
                        {fish.map((f) => (
                          <option key={f.id} value={f.id}>
                            {fishName(f.symbol, f.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Кол-во</span>
                      <input
                        type="number"
                        min={0.0001}
                        step="any"
                        value={giftQty}
                        onChange={(e) => setGiftQty(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        const qty = Number(giftQty);
                        if (!giftFishId) {
                          setError('Выберите рыбу');
                          return;
                        }
                        if (!Number.isFinite(qty) || qty <= 0) {
                          setError('Количество должно быть > 0');
                          return;
                        }
                        setBusy(true);
                        setError(null);
                        try {
                          const updated = await adminApi.giftFish(
                            selectedUser.id,
                            giftFishId,
                            qty,
                            balanceReason.trim() || 'выдача рыбы',
                          );
                          setSelectedUser(updated);
                          await loadUsers();
                          const gifted = fish.find((f) => f.id === giftFishId);
                          setOkMsg(
                            `Выдано ${qty} × ${fishName(gifted?.symbol, gifted?.name)}`,
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Не удалось выдать',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Выдать
                    </button>
                  </div>

                  <div className="detail-grid" style={{ marginTop: 8 }}>
                    <div>
                      <h2 style={{ fontSize: '1rem' }}>Портфель</h2>
                      <div className="list-compact tall">
                        {(selectedUser.portfolioPositions || []).map((p, i) => (
                          <div key={i} className="item">
                            <span>
                              {fishName(p.fish.symbol, p.fish.name)}
                              {p.fish.rarity ? (
                                <span className="muted">
                                  {' '}
                                  · {rarityLabel(p.fish.rarity)}
                                </span>
                              ) : null}
                              <div className="dim" style={{ fontSize: 11 }}>
                                ср. {n(p.avgBuyPrice)} → рынок {n(p.fish.currentPrice)}
                              </div>
                            </span>
                            <span className="mono">
                              ×{n(p.quantity, 4)}
                              <div className={Number(p.unrealizedPnl ?? 0) >= 0 ? 'ok' : 'down'} style={{ fontSize: 11 }}>
                                {n(p.marketValue)} · {Number(p.unrealizedPnl ?? 0) >= 0 ? '+' : ''}
                                {n(p.unrealizedPnl)}
                              </div>
                            </span>
                          </div>
                        ))}
                        {!selectedUser.portfolioPositions?.length && (
                          <div className="muted">Пусто</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <h2 style={{ fontSize: '1rem' }}>Движение баланса</h2>
                      <div className="list-compact tall">
                        {(selectedUser.ledgerEntries || []).slice(0, 20).map((e, i) => (
                          <div key={i} className="item">
                            <span>{ledgerLabel(e.type)}</span>
                            <span className="mono">
                              {Number(e.amount) >= 0 ? '+' : ''}
                              {n(e.amount)}
                              <div className="dim" style={{ fontSize: 11 }}>
                                {when(e.createdAt)}
                                {e.balanceAfter != null
                                  ? ` · после ${n(e.balanceAfter)}`
                                  : ''}
                              </div>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h2 style={{ fontSize: '1rem' }}>Сделки</h2>
                      <div className="list-compact tall">
                        {(selectedUser.trades || []).map((t, i) => (
                          <div key={i} className="item">
                            <span>
                              {t.side === 'SELL' ? 'Продажа' : 'Покупка'}{' '}
                              {fishName(t.fish?.symbol, t.fish?.name)}
                            </span>
                            <span className="mono">
                              ×{n(t.quantity, 4)} · {n(t.totalAmount)}
                              <div className="dim" style={{ fontSize: 11 }}>
                                {when(t.createdAt)}
                              </div>
                            </span>
                          </div>
                        ))}
                        {!selectedUser.trades?.length && (
                          <div className="muted">Нет сделок</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <h2 style={{ fontSize: '1rem' }}>Кейсы</h2>
                      <div className="list-compact tall">
                        {(selectedUser.openings || []).map((o) => (
                          <div key={o.id} className="item">
                            <span>
                              {caseName(o.case.code, o.case.name)} →{' '}
                              {fishName(o.fish.symbol, o.fish.name)}
                            </span>
                            <span className="mono">
                              {n(o.fishMarketValue)}
                              <div className="dim" style={{ fontSize: 11 }}>
                                {when(o.createdAt)} · цена {n(o.pricePaid)}
                              </div>
                            </span>
                          </div>
                        ))}
                        {!selectedUser.openings?.length && (
                          <div className="muted">Не открывал</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </>
          )}

          {tab === 'broadcast' && (
            <div className="panel">
              <h2>Рассылка в бот</h2>
              <p className="muted" style={{ marginBottom: 14 }}>
                Сообщение уйдёт всем, кто открывал приложение и не блокировал
                бота. Сначала лучше нажать «Отправить себе». Забаненные не
                получают.
              </p>
              <div className="grid-stats" style={{ marginBottom: 16 }}>
                <div className="stat">
                  <div className="label">Получателей</div>
                  <div className="value">
                    {n(broadcastAudience?.recipients ?? 0, 0)}
                  </div>
                </div>
                <div className="stat">
                  <div className="label">Бот</div>
                  <div className="value" style={{ fontSize: 18 }}>
                    {broadcastAudience?.botConfigured ? 'готов' : 'нет токена'}
                  </div>
                </div>
              </div>
              <label className="field" style={{ marginBottom: 14 }}>
                <span>Текст</span>
                <textarea
                  rows={7}
                  value={broadcastText}
                  maxLength={4096}
                  placeholder="Что написать в боте…"
                  onChange={(e) => setBroadcastText(e.target.value)}
                />
                <span className="dim">
                  {broadcastText.trim().length}/4096
                  {broadcastFile ? ' · с фото подпись до 1024 символов' : ''}
                </span>
              </label>
              <div className="file-row">
                <label className="field" style={{ flex: '1 1 220px' }}>
                  <span>Фото (необязательно)</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (broadcastPreview) URL.revokeObjectURL(broadcastPreview);
                      if (!file) {
                        setBroadcastFile(null);
                        setBroadcastPreview(null);
                        return;
                      }
                      if (file.size > 4 * 1024 * 1024) {
                        setError('Фото должно быть до 4 МБ');
                        e.target.value = '';
                        return;
                      }
                      setError(null);
                      setBroadcastFile(file);
                      setBroadcastPreview(URL.createObjectURL(file));
                    }}
                  />
                </label>
                {broadcastPreview ? (
                  <div className="photo-preview-wrap">
                    <img
                      className="photo-preview"
                      src={broadcastPreview}
                      alt="Превью"
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        if (broadcastPreview) URL.revokeObjectURL(broadcastPreview);
                        setBroadcastFile(null);
                        setBroadcastPreview(null);
                      }}
                    >
                      Убрать фото
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="toolbar" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void sendBroadcast(true)}
                >
                  Отправить себе
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void sendBroadcast(false)}
                >
                  {busy ? 'Отправка…' : 'Отправить всем'}
                </button>
              </div>
            </div>
          )}

          {tab === 'payments' && (
            <>
              <div className="panel">
                <h2>Курс TON</h2>
                <p className="muted" style={{ marginBottom: 14 }}>
                  Живой оракул для депозитов в TON. Цена обновляется с
                  CoinGecko / Binance.
                </p>
                {oracle?.ton?.ok ? (
                  <div className="grid-stats">
                    <div className="stat">
                      <div className="label">1 TON</div>
                      <div className="value">${n(oracle.ton.usdPrice, 4)}</div>
                    </div>
                    <div className="stat">
                      <div className="label">Источник</div>
                      <div className="value" style={{ fontSize: '1rem' }}>
                        {oracle.ton.source || '—'}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Обновлено</div>
                      <div className="value" style={{ fontSize: '0.95rem' }}>
                        {oracle.ton.fetchedAt
                          ? when(oracle.ton.fetchedAt)
                          : '—'}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label">Действует до</div>
                      <div className="value" style={{ fontSize: '0.95rem' }}>
                        {oracle.ton.expiresAt
                          ? when(oracle.ton.expiresAt)
                          : '—'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="toast-error">
                    Оракул недоступен
                    {oracle?.ton?.error ? `: ${oracle.ton.error}` : ''}
                  </div>
                )}
                {(oracle?.recent?.length ?? 0) > 0 && (
                  <>
                    <h2 style={{ fontSize: '1rem', marginTop: 8 }}>
                      Последние снимки
                    </h2>
                    <div className="row header" style={{ gridTemplateColumns: '0.6fr 1fr 1fr 1.4fr' }}>
                      <div>Актив</div>
                      <div>Цена USD</div>
                      <div>Источник</div>
                      <div>Когда</div>
                    </div>
                    {oracle!.recent.map((s) => (
                      <div
                        key={s.id}
                        className="row"
                        style={{ gridTemplateColumns: '0.6fr 1fr 1fr 1.4fr' }}
                      >
                        <div>{s.asset}</div>
                        <div className="mono">${n(s.usdPrice, 4)}</div>
                        <div className="muted">{s.source}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {when(s.fetchedAt)}
                          {!s.isValid ? ' · невалид' : ''}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div className="panel">
                <h2>Провайдеры оплаты</h2>
                {payments.map((p) => (
                  <div key={p.code} className="row">
                    <div>{p.code}</div>
                    <div className={p.isEnabled ? 'ok' : 'muted'}>
                      {p.isEnabled ? 'ВКЛ' : 'ВЫКЛ'}
                    </div>
                    <div className="mono">комиссия {n(p.feePercent, 2)}%</div>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          await adminApi.patchPayment(p.code, {
                            isEnabled: !p.isEnabled,
                          });
                          setPayments(await adminApi.paymentSettings());
                        }}
                      >
                        Переключить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'deposits' && (
            <div className="panel">
              <h2>Последние депозиты</h2>
              {deposits.map((d) => (
                <div key={d.id} className="row">
                  <div>
                    {d.provider} · {d.status}
                  </div>
                  <div className="mono">{n(d.assetAmount)}</div>
                  <div className="mono">{n(d.gameCreditAmount)}</div>
                  <div className="muted">
                    {d.user?.username || d.user?.telegramId} · {when(d.createdAt)}
                  </div>
                </div>
              ))}
              {!deposits.length && <p className="muted">Пока пусто</p>}
            </div>
          )}

          {tab === 'promo' && (
            <>
              <div className="panel">
                <h2>Новый промокод</h2>
                <p className="muted" style={{ marginBottom: 12 }}>
                  Один код — одна награда: баланс, рыба в портфель или
                  бесплатные открытия кейса. Каждый игрок может активировать
                  код один раз.
                </p>
                <div className="toolbar">
                  <label className="field">
                    <span>Код</span>
                    <input
                      value={promoForm.code}
                      onChange={(e) =>
                        setPromoForm((f) => ({
                          ...f,
                          code: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="SUMMER100"
                    />
                  </label>
                  <label className="field">
                    <span>Награда</span>
                    <select
                      value={promoForm.kind}
                      onChange={(e) =>
                        setPromoForm((f) => ({
                          ...f,
                          kind: e.target.value as typeof f.kind,
                        }))
                      }
                    >
                      <option value="BALANCE">Баланс</option>
                      <option value="FISH">Рыба</option>
                      <option value="CASE">Кейс</option>
                    </select>
                  </label>
                  {promoForm.kind === 'BALANCE' ? (
                    <label className="field">
                      <span>Сумма CR</span>
                      <input
                        value={promoForm.amount}
                        onChange={(e) =>
                          setPromoForm((f) => ({ ...f, amount: e.target.value }))
                        }
                      />
                    </label>
                  ) : null}
                  {promoForm.kind === 'FISH' ? (
                    <label className="field">
                      <span>Рыба</span>
                      <select
                        value={promoForm.fishId}
                        onChange={(e) =>
                          setPromoForm((f) => ({ ...f, fishId: e.target.value }))
                        }
                      >
                        <option value="">Выберите</option>
                        {fish.map((f) => (
                          <option key={f.id} value={f.id}>
                            {fishName(f.symbol, f.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {promoForm.kind === 'CASE' ? (
                    <label className="field">
                      <span>Кейс</span>
                      <select
                        value={promoForm.caseId}
                        onChange={(e) =>
                          setPromoForm((f) => ({ ...f, caseId: e.target.value }))
                        }
                      >
                        <option value="">Выберите</option>
                        {(casino?.cases || [])
                          .filter((c) => c.code !== 'DAILY')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {caseName(c.code, c.displayName || c.name)}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  {promoForm.kind !== 'BALANCE' ? (
                    <label className="field">
                      <span>Количество</span>
                      <input
                        value={promoForm.quantity}
                        onChange={(e) =>
                          setPromoForm((f) => ({
                            ...f,
                            quantity: e.target.value,
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </div>
                <div className="toolbar">
                  <label className="field">
                    <span>Лимит активаций (пусто = без лимита)</span>
                    <input
                      value={promoForm.maxUses}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, maxUses: e.target.value }))
                      }
                      placeholder="∞"
                    />
                  </label>
                  <label className="field">
                    <span>Действует до (опц.)</span>
                    <input
                      type="datetime-local"
                      value={promoForm.expiresAt}
                      onChange={(e) =>
                        setPromoForm((f) => ({
                          ...f,
                          expiresAt: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Заметка</span>
                    <input
                      value={promoForm.note}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, note: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      if (!promoForm.code.trim()) {
                        setError('Введите код');
                        return;
                      }
                      setBusy(true);
                      setError(null);
                      setOkMsg(null);
                      try {
                        const payload: Record<string, unknown> = {
                          code: promoForm.code.trim(),
                          kind: promoForm.kind,
                          quantity: Number(promoForm.quantity) || 1,
                          note: promoForm.note.trim() || undefined,
                          maxUses: promoForm.maxUses
                            ? Number(promoForm.maxUses)
                            : undefined,
                          expiresAt: promoForm.expiresAt
                            ? new Date(promoForm.expiresAt).toISOString()
                            : undefined,
                        };
                        if (promoForm.kind === 'BALANCE') {
                          payload.amount = Number(promoForm.amount);
                        }
                        if (promoForm.kind === 'FISH') payload.fishId = promoForm.fishId;
                        if (promoForm.kind === 'CASE') payload.caseId = promoForm.caseId;
                        await adminApi.createPromo(payload);
                        setOkMsg('Промокод создан');
                        setPromoForm((f) => ({ ...f, code: '', note: '' }));
                        setPromos(await adminApi.promoCodes());
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : 'Не удалось создать',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Создать
                  </button>
                </div>
              </div>
              <div className="panel">
                <h2>Коды</h2>
                {promos.map((p) => (
                  <div key={p.id} className="row">
                    <div>
                      <div className="mono">{p.code}</div>
                      <div className="muted">
                        {p.kind === 'BALANCE'
                          ? `+${n(p.amount, 2)} CR`
                          : p.kind === 'FISH'
                            ? `${p.fish?.name || 'рыба'} × ${p.quantity}`
                            : `${p.lootCase?.name || 'кейс'} × ${p.quantity}`}
                        {p.note ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <div className="mono">
                      {p.usesCount}
                      {p.maxUses != null ? ` / ${p.maxUses}` : ''}
                    </div>
                    <div className="muted">
                      {p.isActive ? 'активен' : 'выключен'}
                      {p.expiresAt ? ` · до ${when(p.expiresAt)}` : ''}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await adminApi.setPromoActive(p.id, !p.isActive);
                          setPromos(await adminApi.promoCodes());
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Ошибка',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {p.isActive ? 'Выключить' : 'Включить'}
                    </button>
                  </div>
                ))}
                {!promos.length && <p className="muted">Пока нет кодов</p>}
              </div>
            </>
          )}

          {tab === 'events' && (
            <>
              <div className="panel">
                <h2>Новое рыночное событие</h2>
                <p className="muted" style={{ marginBottom: 12 }}>
                  Множитель цены на период (например 1.15 = +15% к движению).
                </p>
                <div className="toolbar">
                  <label className="field">
                    <span>Название</span>
                    <input
                      value={eventForm.name}
                      onChange={(e) =>
                        setEventForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Множитель</span>
                    <input
                      value={eventForm.priceMultiplier}
                      onChange={(e) =>
                        setEventForm((f) => ({
                          ...f,
                          priceMultiplier: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Рыба (опц.)</span>
                    <select
                      value={eventForm.fishId}
                      onChange={(e) =>
                        setEventForm((f) => ({ ...f, fishId: e.target.value }))
                      }
                    >
                      <option value="">Все</option>
                      {fish.map((f) => (
                        <option key={f.id} value={f.id}>
                          {fishName(f.symbol, f.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="toolbar">
                  <label className="field">
                    <span>Начало</span>
                    <input
                      type="datetime-local"
                      value={eventForm.startTime}
                      onChange={(e) =>
                        setEventForm((f) => ({
                          ...f,
                          startTime: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Конец</span>
                    <input
                      type="datetime-local"
                      value={eventForm.endTime}
                      onChange={(e) =>
                        setEventForm((f) => ({ ...f, endTime: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      if (!eventForm.name || !eventForm.startTime || !eventForm.endTime) {
                        setError('Заполните название и даты');
                        return;
                      }
                      setBusy(true);
                      try {
                        await adminApi.createEvent({
                          name: eventForm.name,
                          description: eventForm.description || undefined,
                          fishId: eventForm.fishId || undefined,
                          priceMultiplier: Number(eventForm.priceMultiplier),
                          startTime: new Date(eventForm.startTime).toISOString(),
                          endTime: new Date(eventForm.endTime).toISOString(),
                        });
                        setEvents(await adminApi.events());
                        setOkMsg('Событие создано');
                        setEventForm((f) => ({ ...f, name: '', description: '' }));
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : 'Не удалось создать',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Создать
                  </button>
                </div>
              </div>
              <div className="panel">
                <h2>События</h2>
                {events.map((ev) => (
                  <div key={ev.id} className="row">
                    <div>
                      {ev.name}{' '}
                      {ev.isActive ? (
                        <span className="badge">активно</span>
                      ) : (
                        <span className="badge badge-warn">выкл</span>
                      )}
                      <div className="muted">
                        {ev.fish
                          ? fishName(ev.fish.symbol, ev.fish.name)
                          : 'все'}{' '}
                        · ×{n(ev.priceMultiplier, 2)}
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {when(ev.startTime)}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {when(ev.endTime)}
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          if (ev.isActive) await adminApi.deactivateEvent(ev.id);
                          else await adminApi.activateEvent(ev.id);
                          setEvents(await adminApi.events());
                        }}
                      >
                        {ev.isActive ? 'Выключить' : 'Включить'}
                      </button>
                    </div>
                  </div>
                ))}
                {!events.length && <p className="muted">Событий нет</p>}
              </div>
            </>
          )}

          {tab === 'casino' && casino && (
            <>
              <div className="grid-stats">
                <div className="stat">
                  <div className="label">Открытий всего</div>
                  <div className="value">{n(casino.openingsTotal, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Открытий 24ч</div>
                  <div className="value">{n(casino.openings24h, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Потрачено 24ч</div>
                  <div className="value">{n(casino.spent24h)}</div>
                </div>
                <div className="stat">
                  <div className="label">Выдано value 24ч</div>
                  <div className="value">{n(casino.value24h)}</div>
                </div>
              </div>
              <div className="panel">
                <h2>Кейсы</h2>
                {casino.cases.map((c) => (
                  <div key={c.id} className="row">
                    <div>
                      {c.displayName || caseName(c.code, c.name)}{' '}
                      <span className="muted mono">{c.code}</span>
                      {!c.isActive && (
                        <span className="badge badge-warn" style={{ marginLeft: 6 }}>
                          выкл
                        </span>
                      )}
                    </div>
                    <div className="mono">{n(c.priceCredits)} CR</div>
                    <div className="mono">edge {n(c.edgePercent, 1)}%</div>
                    <div className="muted">{c.openings} откр.</div>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h2>Недавние открытия</h2>
                {casino.recent.map((o) => (
                  <div key={o.id} className="row">
                    <div>
                      {o.case} → <strong>{fishName(undefined, o.fish)}</strong>
                    </div>
                    <div className="mono">{n(o.paid)}</div>
                    <div className="mono ok">{n(o.value)}</div>
                    <div className="muted">
                      {o.user} · {when(o.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'audit' && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Журнал действий админов</h2>
                  <p className="muted">Все чувствительные операции с датой и автором.</p>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => setAudit(await adminApi.audit())}
                >
                  Обновить
                </button>
              </div>
              <div className="row header audit-grid">
                <div>Действие</div>
                <div>Сущность</div>
                <div>Админ</div>
                <div>Когда</div>
              </div>
              {audit.map((a) => (
                <div key={a.id} className="row audit-grid">
                  <div>
                    <strong>{a.actionType}</strong>
                  </div>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    {a.entityType}
                  </div>
                  <div className="muted">
                    {a.adminUser?.username ||
                      a.adminUser?.firstName ||
                      String(a.adminUser?.telegramId ?? '—')}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {when(a.createdAt)}
                  </div>
                </div>
              ))}
              {!audit.length && <p className="muted">Пока записей нет</p>}
            </div>
          )}

          {tab === 'security' && security && (
            <>
              <div className="grid-stats">
                <div className="stat">
                  <div className="label">Забанено</div>
                  <div className="value">{n(security.bannedUsers, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Админов</div>
                  <div className="value">{n(security.adminUsers, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Действий 24ч</div>
                  <div className="value">{n(security.adminActions24h, 0)}</div>
                </div>
                <div className="stat">
                  <div className="label">Новых юзеров 24ч</div>
                  <div className="value">{n(security.newUsers24h, 0)}</div>
                </div>
              </div>
              <div className="panel">
                <h2>Статус защиты</h2>
                {(
                  [
                    ['Секрет админки настроен', security.adminSecretConfigured],
                    ['Сессионный вход включён', security.sessionAuthEnabled],
                    ['Telegram bot token', security.telegramBotConfigured],
                    ['CORS allowlist (CORS_ORIGINS)', security.corsConfigured],
                  ] as const
                ).map(([label, on]) => (
                  <div key={label} className="check">
                    <span className={`dot${on ? '' : ' off'}`} />
                    <span>
                      {label}
                      {!on && label.includes('CORS') ? (
                        <span className="muted">
                          {' '}
                          — задайте CORS_ORIGINS=https://… на API
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
                <p className="muted" style={{ marginTop: 14 }}>
                  Лимит запросов: {security.rateLimitMax}/мин на IP. Мутации
                  админки дополнительно ограничены. Забаненные пользователи не
                  могут пользоваться приложением. Сессия админа живёт ~8 часов и
                  хранится в sessionStorage.
                </p>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
