import { useEffect, useState } from 'react';
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
  type SecurityOverview,
} from './api';

type Tab =
  | 'dashboard'
  | 'targets'
  | 'fish'
  | 'users'
  | 'payments'
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
  { id: 'deposits', label: 'Депозиты' },
  { id: 'payments', label: 'Платежи', group: 'Экономика' },
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
  const [tgId, setTgId] = useState(getDevTelegramId());
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
        throw new Error(
          'Нет прав админа. Добавьте Telegram ID в ADMIN_TELEGRAM_IDS на API.',
        );
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
        throw new Error('Укажите корректный Telegram ID');
      }
      if (secret.trim().length < 8) {
        throw new Error('Секрет слишком короткий');
      }
      setDevTelegramId(String(id));
      const session = await adminApi.login(id, secret.trim());
      setAdminSession(session.token, session.expiresAt);
      setSessionExp(session.expiresAt);
      setSecret('');
      setOkMsg('Сессия создана. Секрет больше не хранится в браузере.');
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
    setDash(null);
    setSelectedUser(null);
    setOkMsg('Вы вышли из админки');
  }

  async function loadUsers(query = q) {
    const res = await adminApi.users(query || undefined);
    setUsers(res.users);
    setUsersTotal(res.total);
    return res;
  }

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
        if (tab === 'users') await loadUsers();
        if (tab === 'payments') {
          setPayments(await adminApi.paymentSettings());
          setOracle(await adminApi.oracles());
        }
        if (tab === 'deposits') setDeposits(await adminApi.deposits());
        if (tab === 'audit') setAudit(await adminApi.audit());
        if (tab === 'events') setEvents(await adminApi.events());
        if (tab === 'casino') setCasino(await adminApi.casino());
        if (tab === 'security') setSecurity(await adminApi.security());
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
            <p className="lead">
              Админ-панель. Вход по Telegram ID из allowlist и секрету API.
              После входа выдаётся короткая сессия — сырой секрет в браузере не
              хранится.
            </p>
            {error && <div className="toast-error">{error}</div>}
            {okMsg && <div className="toast-ok">{okMsg}</div>}
            <div className="stack">
              <label className="field">
                <span>Telegram ID</span>
                <input
                  value={tgId}
                  onChange={(e) => setTgId(e.target.value)}
                  placeholder="819826046"
                  autoComplete="username"
                />
              </label>
              <label className="field">
                <span>Секрет API (INTERNAL_API_SECRET)</span>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="из Railway → @rare-fish/api"
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
            <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
              ID должен быть в <code>ADMIN_TELEGRAM_IDS</code>. Секрет — переменная{' '}
              <code>INTERNAL_API_SECRET</code> или <code>ADMIN_API_SECRET</code>.
            </p>
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
              </div>
              <div className="detail-grid">
                <div className="panel">
                  <h2>Топ рыб</h2>
                  {((dash.topFish as Fish[]) || []).map((f) => (
                    <div key={f.id} className="row" style={{ gridTemplateColumns: '1fr 0.6fr 0.7fr 0.5fr' }}>
                      <div>{f.name}</div>
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
                      <strong>{f.symbol}</strong>
                      <div className="muted">{f.name}</div>
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
                    {f.name}{' '}
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
                        setOkMsg(`Цена ${f.symbol} → ${raw}`);
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
              </div>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Все пользователи</h2>
                    <p className="muted">
                      Показано {users.length}
                      {usersTotal > users.length ? ` из ${usersTotal}` : ''} ·
                      новые появляются автоматически
                    </p>
                  </div>
                </div>
                <div className="row header">
                  <div>Имя</div>
                  <div>Telegram</div>
                  <div>Баланс</div>
                  <div>Действия</div>
                </div>
                {users.map((u) => (
                  <div key={u.id} className="row">
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
                      {u.createdAt ? (
                        <div className="dim" style={{ fontSize: 11 }}>
                          с {when(u.createdAt)}
                        </div>
                      ) : null}
                    </div>
                    <div className="mono">{String(u.telegramId)}</div>
                    <div className="mono">{n(u.gameBalance?.available)} CR</div>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={async () => {
                          const detail = await adminApi.user(u.id);
                          setSelectedUser(detail);
                          setBalanceInput(
                            String(Number(detail.gameBalance?.available ?? 0)),
                          );
                          setBalanceReason('пополнение админом');
                          setOkMsg(null);
                          setError(null);
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
                <div className="panel">
                  <h2>
                    {selectedUser.username || selectedUser.firstName || '—'}
                  </h2>
                  <p className="muted" style={{ marginBottom: 12 }}>
                    tg {String(selectedUser.telegramId)} · {selectedUser.status}
                    {selectedUser.isAdmin ? ' · admin' : ''}
                  </p>
                  <div className="stat" style={{ marginBottom: 14, maxWidth: 240 }}>
                    <div className="label">Баланс</div>
                    <div className="value">
                      {n(selectedUser.gameBalance?.available)} CR
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

                  <div className="detail-grid" style={{ marginTop: 8 }}>
                    <div>
                      <h2 style={{ fontSize: '1rem' }}>Портфель</h2>
                      <div className="list-compact">
                        {(selectedUser.portfolioPositions || []).map((p, i) => (
                          <div key={i} className="item">
                            <span>{p.fish.symbol}</span>
                            <span className="mono">
                              ×{n(p.quantity, 4)} @ {n(p.fish.currentPrice)}
                            </span>
                          </div>
                        ))}
                        {!selectedUser.portfolioPositions?.length && (
                          <div className="muted">Пусто</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <h2 style={{ fontSize: '1rem' }}>Ledger</h2>
                      <div className="list-compact">
                        {(selectedUser.ledgerEntries || []).slice(0, 12).map((e, i) => (
                          <div key={i} className="item">
                            <span>{e.type}</span>
                            <span className="mono">
                              {n(e.amount)} · {when(e.createdAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
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
                          {f.symbol}
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
                        {ev.fish?.symbol || 'все'} · ×{n(ev.priceMultiplier, 2)}
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
                      {c.name} <span className="muted mono">{c.code}</span>
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
                      {o.case} → <strong>{o.fish}</strong>
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
