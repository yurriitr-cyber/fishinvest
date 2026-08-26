export type Me = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  balance: string;
  referralCode: string;
  referralLink: string;
  isNewUser: boolean;
  welcomeBonus: string;
  referralJoinBonus: string | null;
  portfolioValue: string;
  referredBy: string | null;
};

export type Fish = {
  id: string;
  symbol: string;
  name: string;
  rarity: string;
  currentPrice: string;
  previousPrice: string;
  dailyChangePercent: string;
  allTimeHigh: string;
  allTimeLow: string;
  isFrozen: boolean;
  imageUrl: string | null;
};

export type PricePoint = {
  id: string;
  price: string;
  previousPrice: string;
  changePercent: string;
  source: string;
  createdAt: string;
};

export type FishHistory = {
  fishId: string;
  symbol: string;
  history: PricePoint[];
};

export type Portfolio = {
  balance: string;
  totalInvested: string;
  currentValue: string;
  unrealizedPnl: string;
  unrealizedPnlPercent: string;
  realizedPnl: string;
  positions: Array<{
    fishId: string;
    symbol: string;
    name: string;
    rarity: string;
    quantity: string;
    avgBuyPrice: string;
    currentPrice: string;
    totalInvested: string;
    currentValue: string;
    unrealizedPnl: string;
    unrealizedPnlPercent: string;
    realizedPnl: string;
  }>;
};

export type Leaderboard = {
  leaders: Array<{
    rank: number;
    userId: string;
    displayName: string;
    portfolioValue: string;
    totalProfit: string;
    profitPercent: string;
    isYou: boolean;
  }>;
  you: {
    rank: number;
    displayName: string;
    portfolioValue: string;
    totalProfit: string;
    profitPercent: string;
  } | null;
};

export type ReferralStats = {
  count: number;
  totalBonusEarned: string;
  referrals: Array<{
    id: string;
    username: string | null;
    firstName: string | null;
    bonus: string;
    joinedAt: string;
  }>;
};

export type DepositMethod = {
  code: string;
  label: string;
  enabled: boolean;
  feePercent: string;
  note: string;
  packs?: number[];
};

export type StarsQuote = {
  provider: string;
  assetType: string;
  assetAmount: string;
  exchangeRate: string;
  rateSource: string;
  rateNote: string;
  feePercent: string;
  grossGameCredits: string;
  feeAmount: string;
  gameCreditAmount: string;
};

export type DepositRecord = {
  id: string;
  provider: string;
  assetAmount: string;
  gameCreditAmount: string | null;
  feeAmount: string | null;
  feePercent: string | null;
  exchangeRate: string | null;
  status: string;
  invoiceLink: string | null;
  createdAt: string;
};

type AuthState = {
  mode: 'tma' | 'dev';
  raw?: string;
  telegramId: string;
  startParam?: string;
};

const auth: AuthState = {
  mode: 'dev',
  telegramId: localStorage.getItem('rf_dev_tg_id') || '1001',
};

export function configureAuth(opts: {
  mode: 'tma' | 'dev';
  raw?: string;
  telegramId?: string;
  startParam?: string;
}) {
  auth.mode = opts.mode;
  auth.raw = opts.raw;
  if (opts.telegramId) {
    auth.telegramId = opts.telegramId;
    localStorage.setItem('rf_dev_tg_id', opts.telegramId);
  }
  auth.startParam = opts.startParam;
}

/** Empty = same-origin `/api` (Vite proxy / Railway web proxy). */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  if (auth.mode === 'tma' && auth.raw) {
    headers.set('Authorization', `tma ${auth.raw}`);
  } else {
    headers.set('Authorization', 'tma unused');
    headers.set('x-dev-telegram-id', auth.telegramId);
  }

  if (auth.startParam) {
    headers.set('x-start-param', auth.startParam);
  }

  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let message: string | string[] = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<Me>('/me'),
  fish: () => request<Fish[]>('/fish'),
  fishOne: (id: string) => request<Fish>(`/fish/${id}`),
  fishHistory: (id: string, limit = 80) =>
    request<FishHistory>(`/fish/${id}/history?limit=${limit}`),
  portfolio: () => request<Portfolio>('/portfolio'),
  buy: (fishId: string, quantity: number, idempotencyKey?: string) =>
    request('/trade/buy', {
      method: 'POST',
      body: JSON.stringify({ fishId, quantity, idempotencyKey }),
    }),
  sell: (fishId: string, quantity: number, idempotencyKey?: string) =>
    request('/trade/sell', {
      method: 'POST',
      body: JSON.stringify({ fishId, quantity, idempotencyKey }),
    }),
  leaderboard: () => request<Leaderboard>('/leaderboard'),
  referrals: () => request<ReferralStats>('/referrals'),
  depositMethods: () => request<DepositMethod[]>('/deposit/methods'),
  quoteStars: (starAmount: number) =>
    request<StarsQuote>('/deposit/stars/quote', {
      method: 'POST',
      body: JSON.stringify({ starAmount }),
    }),
  createStarsDeposit: (starAmount: number, idempotencyKey?: string) =>
    request<DepositRecord>('/deposit/stars', {
      method: 'POST',
      body: JSON.stringify({ starAmount, idempotencyKey }),
    }),
  getDeposit: (id: string) => request<DepositRecord>(`/deposit/${id}`),
};
