import { useEffect, useState } from 'react';
import {
  adminApi,
  getAdminSecret,
  getDevTelegramId,
  setAdminSecret,
  setDevTelegramId,
  type AdminUser,
  type AdminUserDetail,
  type Deposit,
  type Fish,
  type Payment,
} from './api';

type Tab = 'targets' | 'fish' | 'dashboard' | 'users' | 'payments' | 'deposits';

function n(v: string | number | null | undefined, d = 2) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d }) : '—';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('targets');
  const [tgId, setTgId] = useState(getDevTelegramId());
  const [secret, setSecret] = useState(getAdminSecret());
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [meOk, setMeOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const [dash, setDash] = useState<Record<string, unknown> | null>(null);
  const [fish, setFish] = useState<Fish[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
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
      if (!me.isAdmin) {
        throw new Error(
          'Not an admin. Add your Telegram ID to ADMIN_TELEGRAM_IDS on the API.',
        );
      }
      setMeOk(true);
    } catch (e) {
      setMeOk(false);
      setError(e instanceof Error ? e.message : 'Auth failed');
    }
  }

  function saveCreds() {
    setDevTelegramId(tgId.trim());
    setAdminSecret(secret.trim());
    boot();
  }

  useEffect(() => {
    if (getDevTelegramId() && getAdminSecret()) boot();
  }, []);

  useEffect(() => {
    if (!meOk) return;
    setError(null);
    (async () => {
      try {
        if (tab === 'dashboard') setDash(await adminApi.dashboard());
        if (tab === 'fish' || tab === 'targets') {
          const list = await adminApi.fish();
          setFish(list);
          const next: Record<string, string> = {};
          for (const f of list) {
            next[f.id] = String(Number(f.dailyTargetPercent ?? 0));
          }
          setTargets(next);
        }
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

  async function saveAllTargets() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const payload = fish.map((f) => ({
        fishId: f.id,
        percent: Number(targets[f.id] ?? 0),
      }));
      const res = await adminApi.setDailyTargets(payload);
      setOkMsg(`Saved daily targets for ${res.updated} fish`);
      setFish(await adminApi.fish());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="layout">
      <aside className="side">
        <h1>
          Rare Fish
          <span>Admin</span>
        </h1>
        <nav>
          {(
            [
              ['targets', 'Daily growth'],
              ['fish', 'Prices'],
              ['dashboard', 'Dashboard'],
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
              disabled={!meOk && id !== 'targets'}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="creds">
          <div className="muted">Telegram ID</div>
          <input
            value={tgId}
            onChange={(e) => setTgId(e.target.value)}
            placeholder="123456789"
          />
          <div className="muted">Admin secret</div>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="ADMIN_API_SECRET"
          />
          <button type="button" className="primary" onClick={saveCreds}>
            Sign in
          </button>
        </div>
      </aside>

      <main className="main">
        {error && <div className="error">{error}</div>}
        {okMsg && <div className="ok-box">{okMsg}</div>}

        {!meOk && (
          <div className="panel">
            <h2>Sign in</h2>
            <p className="muted">
              1. Telegram ID: <code>819826046</code> (or yours from{' '}
              <code>@userinfobot</code>)
              <br />
              2. Secret: value of <code>INTERNAL_API_SECRET</code> or{' '}
              <code>ADMIN_API_SECRET</code> from Railway →{' '}
              <strong>@rare-fish/api</strong> → Variables (click the eye to
              reveal).
              <br />
              3. Click <strong>Sign in</strong> in the left sidebar.
            </p>
          </div>
        )}

        {meOk && tab === 'targets' && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Daily growth targets</h2>
                <p className="muted">
                  How much each fish should move over ~24 hours. Example:{' '}
                  <code>15</code> ≈ +15%/day, <code>-8</code> ≈ −8%/day,{' '}
                  <code>0</code> = only noise. Price engine drifts toward this
                  gradually (not instantly).
                </p>
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={saveAllTargets}
              >
                {busy ? 'Saving…' : 'Save all'}
              </button>
            </div>

            <div className="row header targets-grid">
              <div>Fish</div>
              <div>Price</div>
              <div>24h now</div>
              <div>Target % / day</div>
            </div>
            {fish.map((f) => (
              <div key={f.id} className="row targets-grid">
                <div>
                  <strong>{f.symbol}</strong>
                  <div className="muted">{f.name}</div>
                </div>
                <div className="mono">{n(f.currentPrice)}</div>
                <div className="mono">{n(f.dailyChangePercent, 1)}%</div>
                <div>
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
                </div>
              </div>
            ))}

            <div className="toolbar" style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => {
                  const next: Record<string, string> = {};
                  for (const f of fish) next[f.id] = '0';
                  setTargets(next);
                }}
              >
                Reset all to 0
              </button>
              <button
                type="button"
                onClick={() => {
                  const next: Record<string, string> = {};
                  for (const f of fish) {
                    const price = Number(f.currentPrice);
                    // mild default ladder: cheap more volatile up-bias
                    next[f.id] =
                      price < 1 ? '12' : price < 50 ? '6' : price < 300 ? '3' : '1.5';
                  }
                  setTargets(next);
                }}
              >
                Suggest mild uptrend
              </button>
            </div>
          </div>
        )}

        {meOk && tab === 'fish' && (
          <div className="panel">
            <h2>Instant price controls</h2>
            <p className="muted">
              One-shot bumps. For sustained moves use Daily growth.
            </p>
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
                  {f.isFrozen ? ' · frozen' : ''}
                </div>
                <div className="mono">{n(f.currentPrice)}</div>
                <div className="mono">{n(f.dailyChangePercent, 1)}%</div>
                <div className="actions">
                  {[10, 25, -10, -25].map((p) => (
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
          </div>
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
          </>
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
                  User · {selectedUser.username || selectedUser.firstName}
                </h2>
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
                  }}
                >
                  Adjust balance
                </button>
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
