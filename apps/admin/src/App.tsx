import { useEffect, useState } from 'react';
import {
  adminApi,
  getDevTelegramId,
  setDevTelegramId,
  type AdminUser,
  type AdminUserDetail,
  type Deposit,
  type Fish,
  type Payment,
} from './api';

type Tab = 'dashboard' | 'fish' | 'users' | 'payments' | 'deposits';

function n(v: string | number | null | undefined, d = 2) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d }) : '—';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [tgId, setTgId] = useState(getDevTelegramId());
  const [error, setError] = useState<string | null>(null);
  const [meOk, setMeOk] = useState(false);

  const [dash, setDash] = useState<Record<string, unknown> | null>(null);
  const [fish, setFish] = useState<Fish[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [oracle, setOracle] = useState<Record<string, unknown> | null>(null);
  const [q, setQ] = useState('');

  async function boot() {
    setError(null);
    try {
      const me = await adminApi.me();
      if (!me.isAdmin) throw new Error('Not an admin. Set ADMIN_TELEGRAM_IDS and reload.');
      setMeOk(true);
    } catch (e) {
      setMeOk(false);
      setError(e instanceof Error ? e.message : 'Auth failed');
    }
  }

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    if (!meOk) return;
    setError(null);
    (async () => {
      try {
        if (tab === 'dashboard') setDash(await adminApi.dashboard());
        if (tab === 'fish') setFish(await adminApi.fish());
        if (tab === 'users') setUsers(await adminApi.users(q || undefined));
        if (tab === 'payments') {
          setPayments(await adminApi.paymentSettings());
          setOracle(await adminApi.oracles());
        }
        if (tab === 'deposits') setDeposits(await adminApi.deposits());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed');
      }
    })();
  }, [tab, meOk]);

  function saveTg() {
    setDevTelegramId(tgId);
    boot();
  }

  return (
    <div className="layout">
      <aside className="side">
        <h1>
          Rare Fish
          <span>Admin console</span>
        </h1>
        <nav>
          {(
            [
              ['dashboard', 'Dashboard'],
              ['fish', 'Fish market'],
              ['users', 'Users'],
              ['payments', 'Payments'],
              ['deposits', 'Deposits'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'active' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 24 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Dev telegram id
          </div>
          <div className="toolbar">
            <input value={tgId} onChange={(e) => setTgId(e.target.value)} style={{ width: 90 }} />
            <button type="button" onClick={saveTg}>
              Use
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {error && <div className="error">{error}</div>}
        {!meOk && (
          <p className="muted">
            Add your telegram id to <code>ADMIN_TELEGRAM_IDS</code> (e.g. 1001 for browser
            mode), ensure API is running, then click Use.
          </p>
        )}

        {meOk && tab === 'dashboard' && dash && (
          <>
            <div className="grid">
              <div className="stat">
                <div className="label">Users</div>
                <div className="value">{n(dash.users as number, 0)}</div>
              </div>
              <div className="stat">
                <div className="label">Active 24h</div>
                <div className="value">{n(dash.activeUsers24h as number, 0)}</div>
              </div>
              <div className="stat">
                <div className="label">Game credits</div>
                <div className="value">{n(dash.totalGameCredits as string)}</div>
              </div>
              <div className="stat">
                <div className="label">Trade volume</div>
                <div className="value">{n(dash.tradingVolume as string)}</div>
              </div>
              <div className="stat">
                <div className="label">Trades</div>
                <div className="value">{n(dash.tradesCount as number, 0)}</div>
              </div>
            </div>

            <div className="panel">
              <h2>Top fish</h2>
              {((dash.topFish as Fish[]) || []).map((f) => (
                <div key={f.id} className="row">
                  <div>{f.name}</div>
                  <div className="mono">{f.symbol}</div>
                  <div className="mono">{n(f.currentPrice ?? f.price)}</div>
                  <div className="mono">{n(f.change ?? f.dailyChangePercent, 1)}%</div>
                </div>
              ))}
            </div>

            <div className="panel">
              <h2>Top users</h2>
              {((dash.topUsers as Array<Record<string, string>>) || []).map((u) => (
                <div key={u.id} className="row">
                  <div>
                    #{u.rank} {u.displayName}
                  </div>
                  <div className="mono">{u.telegramId}</div>
                  <div className="mono">{n(u.portfolioValue)}</div>
                  <div />
                </div>
              ))}
            </div>
          </>
        )}

        {meOk && tab === 'fish' && (
          <div className="panel">
            <h2>Fish controls</h2>
            <div className="row header">
              <div>Name</div>
              <div>Price</div>
              <div>Change</div>
              <div>Actions</div>
            </div>
            {fish.map((f) => (
              <div key={f.id} className="row">
                <div>
                  {f.name}{' '}
                  <span className="muted mono">{f.symbol}</span>
                  {f.isFrozen ? ' ❄️' : ''}
                </div>
                <div className="mono">{n(f.currentPrice)}</div>
                <div className="mono">{n(f.dailyChangePercent, 1)}%</div>
                <div className="actions">
                  {[10, 25, 50, -10, -25, -50].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={async () => {
                        await adminApi.adjustPercent(f.id, p);
                        setFish(await adminApi.fish());
                      }}
                    >
                      {p > 0 ? `+${p}%` : `${p}%`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      const raw = prompt('New price', String(Number(f.currentPrice)));
                      if (!raw) return;
                      await adminApi.setPrice(f.id, Number(raw));
                      setFish(await adminApi.fish());
                    }}
                  >
                    Set
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (f.isFrozen) await adminApi.unfreeze(f.id);
                      else await adminApi.freeze(f.id);
                      setFish(await adminApi.fish());
                    }}
                  >
                    {f.isFrozen ? 'Unfreeze' : 'Freeze'}
                  </button>
                </div>
              </div>
            ))}
            <div className="toolbar" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  const name = prompt('Event name', 'Whale bought the tank');
                  if (!name) return;
                  const mult = Number(prompt('Price multiplier', '1.25') || '1');
                  const start = new Date().toISOString();
                  const end = new Date(Date.now() + 3600_000).toISOString();
                  await adminApi.createEvent({
                    name,
                    priceMultiplier: mult,
                    startTime: start,
                    endTime: end,
                  });
                  alert('Event created');
                }}
              >
                Create market event
              </button>
            </div>
          </div>
        )}

        {meOk && tab === 'users' && (
          <>
            <div className="toolbar">
              <input
                placeholder="Search username / telegram id"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                type="button"
                onClick={async () => setUsers(await adminApi.users(q || undefined))}
              >
                Search
              </button>
            </div>
            <div className="panel">
              {users.map((u) => (
                <div key={u.id} className="row">
                  <div>
                    {u.username || u.firstName || 'User'}{' '}
                    <span className="muted">{u.status}</span>
                    {u.isAdmin ? ' · admin' : ''}
                  </div>
                  <div className="mono">{String(u.telegramId)}</div>
                  <div className="mono">{n(u.gameBalance?.available)}</div>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={async () => setSelectedUser(await adminApi.user(u.id))}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={async () => {
                        if (u.status === 'BANNED') await adminApi.unban(u.id);
                        else await adminApi.ban(u.id);
                        setUsers(await adminApi.users(q || undefined));
                      }}
                    >
                      {u.status === 'BANNED' ? 'Unban' : 'Ban'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {selectedUser && (
              <div className="panel">
                <h2>
                  User detail · {selectedUser.username || selectedUser.firstName}
                </h2>
                <div className="toolbar">
                  <button
                    type="button"
                    className="primary"
                    onClick={async () => {
                      const amount = Number(prompt('Adjust amount (+/-)', '50'));
                      if (!Number.isFinite(amount) || amount === 0) return;
                      const reason = prompt('Reason', 'admin top-up') || 'admin';
                      setSelectedUser(
                        await adminApi.adjustBalance(selectedUser.id, amount, reason),
                      );
                      setUsers(await adminApi.users(q || undefined));
                    }}
                  >
                    Adjust balance
                  </button>
                </div>
                <p className="muted">
                  Balance: {n(selectedUser.gameBalance?.available)} · positions:{' '}
                  {selectedUser.portfolioPositions?.length || 0}
                </p>
                <h2>Ledger</h2>
                {(selectedUser.ledgerEntries || []).map((e, i) => (
                  <div key={i} className="row">
                    <div>{e.type}</div>
                    <div className="mono">{n(e.amount)}</div>
                    <div className="muted">{new Date(e.createdAt).toLocaleString()}</div>
                    <div />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {meOk && tab === 'payments' && (
          <>
            <div className="panel">
              <h2>Oracle</h2>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                {JSON.stringify(oracle, null, 2)}
              </pre>
            </div>
            <div className="panel">
              <h2>Providers</h2>
              {payments.map((p) => (
                <div key={p.code} className="row">
                  <div>{p.code}</div>
                  <div className={p.isEnabled ? 'ok' : 'muted'}>
                    {p.isEnabled ? 'ON' : 'OFF'}
                  </div>
                  <div className="mono">fee {n(p.feePercent, 2)}%</div>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={async () => {
                        await adminApi.patchPayment(p.code, {
                          isEnabled: !p.isEnabled,
                        });
                        setPayments(await adminApi.paymentSettings());
                      }}
                    >
                      Toggle
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const fee = Number(
                          prompt('Fee percent', String(Number(p.feePercent))) ||
                            p.feePercent,
                        );
                        await adminApi.patchPayment(p.code, { feePercent: fee });
                        setPayments(await adminApi.paymentSettings());
                      }}
                    >
                      Fee
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {meOk && tab === 'deposits' && (
          <div className="panel">
            <h2>Recent deposits</h2>
            {deposits.map((d) => (
              <div key={d.id} className="row">
                <div>
                  {d.provider} · {d.status}
                </div>
                <div className="mono">{n(d.assetAmount)}</div>
                <div className="mono">{n(d.gameCreditAmount)}</div>
                <div className="muted">
                  {d.user?.username || d.user?.telegramId} ·{' '}
                  {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
