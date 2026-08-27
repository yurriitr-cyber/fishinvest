const TG_ID_KEY = 'rf_admin_tg_id';
const SESSION_KEY = 'rf_admin_session';
const SESSION_EXP_KEY = 'rf_admin_session_exp';

/** Prefer sessionStorage so the raw secret / token die with the tab. */
const store = typeof sessionStorage !== 'undefined' ? sessionStorage : localStorage;

export function getDevTelegramId() {
  return store.getItem(TG_ID_KEY) || '';
}

export function setDevTelegramId(id: string) {
  store.setItem(TG_ID_KEY, id);
}

export function getAdminSession() {
  const token = store.getItem(SESSION_KEY) || '';
  const exp = store.getItem(SESSION_EXP_KEY) || '';
  if (!token) return null;
  if (exp && new Date(exp).getTime() < Date.now()) {
    clearAdminSession();
    return null;
  }
  return { token, expiresAt: exp };
}

export function setAdminSession(token: string, expiresAt: string) {
  store.setItem(SESSION_KEY, token);
  store.setItem(SESSION_EXP_KEY, expiresAt);
}

export function clearAdminSession() {
  store.removeItem(SESSION_KEY);
  store.removeItem(SESSION_EXP_KEY);
}

export function logoutAdmin() {
  clearAdminSession();
  store.removeItem(TG_ID_KEY);
  // migrate away from old localStorage secret if present
  try {
    localStorage.removeItem('rf_admin_secret');
    localStorage.removeItem('rf_admin_tg_id');
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', 'tma unused');

  const tgId = getDevTelegramId();
  const session = getAdminSession();
  if (tgId) {
    headers.set('x-admin-telegram-id', tgId);
  }
  if (session?.token) {
    headers.set('x-admin-session', session.token);
  }

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let message: string | string[] = `HTTP ${res.status}`;
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
  login: async (telegramId: number, secret: string) => {
    const res = await fetch('/api/admin-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, secret }),
    });
    if (!res.ok) {
      let message: string | string[] = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.message || message;
        if (Array.isArray(message)) message = message.join(', ');
      } catch {
        /* ignore */
      }
      throw new Error(String(message));
    }
    return res.json() as Promise<{
      token: string;
      expiresAt: string;
      telegramId: string;
    }>;
  },

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
  setPrice: (id: string, price: number, reason?: string) =>
    request(`/admin/fish/${id}/set-price`, {
      method: 'POST',
      body: JSON.stringify({ price, reason }),
    }),
  freeze: (id: string) => request(`/admin/fish/${id}/freeze`, { method: 'POST' }),
  unfreeze: (id: string) =>
    request(`/admin/fish/${id}/unfreeze`, { method: 'POST' }),
  deposits: (limit = 50) =>
    request<Deposit[]>(`/admin/deposits?limit=${limit}`),
  paymentSettings: () => request<Payment[]>('/admin/payment-settings'),
  patchPayment: (code: string, data: Record<string, unknown>) =>
    request(`/admin/payment-settings/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  users: (q?: string) =>
    request<{ total: number; users: AdminUser[] }>(
      `/admin/users?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  user: (id: string) => request<AdminUserDetail>(`/admin/users/${id}`),
  adjustBalance: (id: string, amount: number, reason: string) =>
    request<AdminUserDetail>(`/admin/users/${id}/adjust-balance`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    }),
  setBalance: (id: string, balance: number, reason: string) =>
    request<AdminUserDetail>(`/admin/users/${id}/set-balance`, {
      method: 'POST',
      body: JSON.stringify({ balance, reason }),
    }),
  ban: (id: string, reason?: string) =>
    request(`/admin/users/${id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  unban: (id: string) =>
    request(`/admin/users/${id}/unban`, { method: 'POST', body: '{}' }),
  giftFish: (id: string, fishId: string, quantity: number, reason: string) =>
    request<AdminUserDetail>(`/admin/users/${id}/gift-fish`, {
      method: 'POST',
      body: JSON.stringify({ fishId, quantity, reason }),
    }),
  audit: (limit = 60) => request<AuditItem[]>(`/admin/audit?limit=${limit}`),
  events: () => request<MarketEvent[]>('/admin/events'),
  createEvent: (data: Record<string, unknown>) =>
    request('/admin/events', { method: 'POST', body: JSON.stringify(data) }),
  activateEvent: (id: string) =>
    request(`/admin/events/${id}/activate`, { method: 'POST' }),
  deactivateEvent: (id: string) =>
    request(`/admin/events/${id}/deactivate`, { method: 'POST' }),
  casino: () => request<CasinoStats>('/admin/casino'),
  security: () => request<SecurityOverview>('/admin/security'),
  oracles: () =>
    request<{
      ton: {
        ok: boolean;
        usdPrice?: string;
        source?: string;
        fetchedAt?: string;
        expiresAt?: string;
        error?: string;
      };
      recent: Array<{
        id: string;
        asset: string;
        usdPrice: string;
        source: string;
        isValid: boolean;
        fetchedAt: string;
        expiresAt: string;
      }>;
    }>('/admin/oracles'),
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
  isFrozen?: boolean;
  isActive?: boolean;
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
  createdAt?: string;
  lastSeenAt?: string | null;
  gameBalance?: { available: string | number } | null;
};

export type AdminUserDetail = AdminUser & {
  lastName?: string | null;
  referralCode?: string;
  referredBy?: {
    id: string;
    username: string | null;
    firstName: string | null;
    telegramId: string;
  } | null;
  stats?: {
    cash: string;
    portfolioValue: string;
    netWorth: string;
    invested: string;
    unrealizedPnl: string;
    realizedPnl: string;
    depositsTotal: string;
    depositsCount: number;
    buyVolume: string;
    sellVolume: string;
    buyCount: number;
    sellCount: number;
    caseOpenings: number;
    caseOpenings24h: number;
    caseSpent: string;
    caseWonValue: string;
    casePnl: string;
    referralsCount: number;
    trades24h: number;
  };
  ledgerEntries: Array<{
    type: string;
    amount: string | number;
    balanceAfter?: string | number;
    createdAt: string;
  }>;
  deposits: Array<{
    id: string;
    provider: string;
    status: string;
    assetAmount?: string | number;
    gameCreditAmount: string | number | null;
    createdAt?: string;
  }>;
  portfolioPositions: Array<{
    quantity: string | number;
    avgBuyPrice?: string | number;
    totalInvested?: string | number;
    realizedPnl?: string | number;
    marketValue?: string | number;
    unrealizedPnl?: string | number;
    fish: {
      id?: string;
      symbol: string;
      name?: string;
      rarity?: string;
      currentPrice: string | number;
    };
  }>;
  trades?: Array<{
    side?: string;
    quantity?: string | number;
    unitPrice?: string | number;
    totalAmount?: string | number;
    createdAt: string;
    fish?: { symbol: string; name?: string };
  }>;
  openings?: Array<{
    id: string;
    quantity: number;
    pricePaid: string;
    fishMarketValue: string;
    createdAt: string;
    case: { code: string; name: string };
    fish: { symbol: string; name: string };
  }>;
};

export type AuditItem = {
  id: string;
  actionType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  afterState?: unknown;
  adminUser?: {
    username: string | null;
    firstName: string | null;
    telegramId: string | number;
  };
};

export type MarketEvent = {
  id: string;
  name: string;
  description?: string | null;
  priceMultiplier: string | number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  fish?: { id: string; symbol: string; name: string } | null;
};

export type CasinoStats = {
  openingsTotal: number;
  openings24h: number;
  spentTotal: string;
  valueTotal: string;
  spent24h: string;
  value24h: string;
  cases: Array<{
    id: string;
    code: string;
    name: string;
    displayName?: string;
    priceCredits: string;
    edgePercent: string;
    isActive: boolean;
    openings: number;
  }>;
  recent: Array<{
    id: string;
    case: string;
    fish: string;
    paid: string;
    value: string;
    user: string;
    createdAt: string;
  }>;
};

export type SecurityOverview = {
  bannedUsers: number;
  adminUsers: number;
  adminActions24h: number;
  newUsers24h: number;
  adminSecretConfigured: boolean;
  corsConfigured: boolean;
  telegramBotConfigured: boolean;
  rateLimitMax: number;
  sessionAuthEnabled: boolean;
};
