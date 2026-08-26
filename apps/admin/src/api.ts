const TG_ID_KEY = 'rf_admin_tg_id';
const SECRET_KEY = 'rf_admin_secret';

export function getDevTelegramId() {
  return localStorage.getItem(TG_ID_KEY) || '';
}

export function setDevTelegramId(id: string) {
  localStorage.setItem(TG_ID_KEY, id);
}

export function getAdminSecret() {
  return localStorage.getItem(SECRET_KEY) || '';
}

export function setAdminSecret(secret: string) {
  localStorage.setItem(SECRET_KEY, secret);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', 'tma unused');

  const tgId = getDevTelegramId();
  const secret = getAdminSecret();
  if (tgId) {
    headers.set('x-admin-telegram-id', tgId);
    headers.set('x-dev-telegram-id', tgId);
  }
  if (secret) {
    headers.set('x-admin-secret', secret);
  }

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || message;
      if (Array.isArray(message)) message = message.join(', ');
    } catch {
      /* ignore */
    }
    throw new Error(String(message));
  }
  return res.json() as Promise<T>;
}

export const adminApi = {
  me: () =>
    request<{ isAdmin: boolean; firstName: string | null; telegramId: string }>(
      '/me',
    ),
  dashboard: () => request<Record<string, unknown>>('/admin/dashboard'),
  fish: () => request<Fish[]>('/admin/fish'),
  setDailyTargets: (
    targets: Array<{ fishId: string; percent: number }>,
    durationHours = 24,
  ) =>
    request<{ updated: number; durationHours: number }>(
      '/admin/fish/daily-targets',
      {
        method: 'POST',
        body: JSON.stringify({ targets, durationHours }),
      },
    ),
  setPrice: (id: string, price: number) =>
    request(`/admin/fish/${id}/set-price`, {
      method: 'POST',
      body: JSON.stringify({ price }),
    }),
  adjustPercent: (id: string, percent: number) =>
    request(`/admin/fish/${id}/adjust-percent`, {
      method: 'POST',
      body: JSON.stringify({ percent }),
    }),
  freeze: (id: string) => request(`/admin/fish/${id}/freeze`, { method: 'POST' }),
  unfreeze: (id: string) =>
    request(`/admin/fish/${id}/unfreeze`, { method: 'POST' }),
  updateFish: (id: string, data: Record<string, unknown>) =>
    request(`/admin/fish/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createEvent: (data: Record<string, unknown>) =>
    request('/admin/events', { method: 'POST', body: JSON.stringify(data) }),
  deposits: () => request<Deposit[]>('/admin/deposits'),
  oracles: () => request<Record<string, unknown>>('/admin/oracles'),
  paymentSettings: () => request<Payment[]>('/admin/payment-settings'),
  patchPayment: (code: string, data: Record<string, unknown>) =>
    request(`/admin/payment-settings/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  users: (q?: string) =>
    request<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  user: (id: string) => request<AdminUserDetail>(`/admin/users/${id}`),
  adjustBalance: (id: string, amount: number, reason: string) =>
    request<AdminUserDetail>(`/admin/users/${id}/adjust-balance`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    }),
  ban: (id: string) =>
    request(`/admin/users/${id}/ban`, { method: 'POST', body: '{}' }),
  unban: (id: string) =>
    request(`/admin/users/${id}/unban`, { method: 'POST', body: '{}' }),
};

export type Fish = {
  id: string;
  symbol: string;
  name: string;
  currentPrice?: string | number;
  price?: string | number;
  dailyChangePercent?: string | number;
  dailyTargetPercent?: string | number;
  rampFromPrice?: string | number | null;
  rampToPrice?: string | number | null;
  rampStartAt?: string | null;
  rampEndAt?: string | null;
  rampProgress?: number | null;
  change?: string | number;
  volatility?: string | number;
  trend?: string | number;
  isFrozen?: boolean;
  isActive?: boolean;
  minPrice?: string | number;
  maxPrice?: string | number;
};

export type Deposit = {
  id: string;
  provider: string;
  status: string;
  assetAmount: string | number;
  gameCreditAmount: string | number | null;
  createdAt: string;
  user: { username: string | null; telegramId: string | number };
};

export type Payment = {
  id: string;
  code: string;
  isEnabled: boolean;
  feePercent: string | number;
  minDeposit: string | number | null;
  maxDeposit: string | number | null;
};

export type AdminUser = {
  id: string;
  telegramId: string | number;
  username: string | null;
  firstName: string | null;
  status: string;
  isAdmin: boolean;
  gameBalance?: { available: string | number };
};

export type AdminUserDetail = AdminUser & {
  ledgerEntries: Array<{
    type: string;
    amount: string | number;
    createdAt: string;
  }>;
  deposits: Array<{
    id: string;
    provider: string;
    status: string;
    gameCreditAmount: string | number | null;
  }>;
  portfolioPositions: Array<{
    quantity: string | number;
    fish: { symbol: string; currentPrice: string | number };
  }>;
};
