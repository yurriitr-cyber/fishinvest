import { translateError } from './labels';

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
  volatility?: string;
  totalSupply: number;
  availableSupply: number;
  isFrozen: boolean;
  imageUrl: string | null;
  sortOrder?: number;
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
    imageUrl: string | null;
    quantity: string;
    avgBuyPrice: string;
    currentPrice: string;
    totalInvested: string;
    currentValue: string;
    unrealizedPnl: string;
    unrealizedPnlPercent: string;
    realizedPnl: string;
    joint?: boolean;
    jointHoldingId?: string | null;
    partner?: {
      id: string;
      username: string | null;
      firstName: string | null;
    } | null;
  }>;
};

export type JointFriend = {
  id: string;
  username: string | null;
  firstName: string | null;
};

export type JointProposal = {
  id: string;
  kind: 'BUY' | 'SELL' | string;
  status: string;
  quantity: string;
  halfAmount: string;
  unitPrice: string;
  fish: {
    symbol: string;
    name: string;
    imageUrl: string | null;
    rarity: string;
  };
  initiator: {
    id: string;
    username: string | null;
    firstName: string | null;
  } | null;
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

export type CaseLootItem = {
  fishId: string;
  symbol: string;
  name: string;
  rarity: string;
  imageUrl: string | null;
  quantity: number;
  weight: number;
  chancePercent: number;
  marketPrice: string;
  available: boolean;
};

export type LootCase = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCredits: string;
  sortOrder: number;
  expectedValue: string;
  houseEdgePercent: number;
  isFreeDaily?: boolean;
  canOpenFree?: boolean;
  nextFreeAt?: string | null;
  freeCredits?: number;
  loot: CaseLootItem[];
};

export type CaseOpening = {
  id: string;
  caseCode: string;
  caseName: string;
  fishId: string;
  symbol: string;
  name: string;
  rarity: string;
  imageUrl: string | null;
  quantity: number;
  pricePaid: string;
  fishUnitPrice: string;
  fishMarketValue: string;
  currentPrice?: string;
  profit?: string;
  createdAt: string;
};

export type DepositMethod = {
  code: string;
  label: string;
  enabled: boolean;
  feePercent: string;
  note: string;
  packs?: number[];
  tonPacks?: number[];
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
  depositAddress?: string | null;
  memo?: string | null;
  transferLink?: string | null;
  rateNote?: string | null;
  createdAt: string;
};

export type TonQuote = {
  provider: string;
  assetAmount: string;
  tonUsdPrice: string;
  usdValue: string;
  gameCreditAmount: string;
  feePercent: string;
  bonusPercent?: string;
  bonusAmount?: string;
  rateNote: string;
  rateSource?: string;
  rateFetchedAt?: string;
  depositAddress: string;
  exchangeRate: string;
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
    let message: string | string[] = `Ошибка запроса (${res.status})`;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      /* ignore */
    }
    const text = Array.isArray(message) ? message.join(', ') : String(message);
    throw new Error(translateError(text));
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
  referralShareCard: () =>
    request<{
      ok: boolean;
      preparedMessageId: string;
      deepLink: string;
      inviteUrl: string;
    }>('/referrals/share-card', { method: 'POST', body: '{}' }),
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
  quoteTon: (tonAmount: number) =>
    request<TonQuote>('/deposit/ton/quote', {
      method: 'POST',
      body: JSON.stringify({ tonAmount }),
    }),
  createTonDeposit: (tonAmount: number, idempotencyKey?: string) =>
    request<DepositRecord>('/deposit/ton', {
      method: 'POST',
      body: JSON.stringify({ tonAmount, idempotencyKey }),
    }),
  checkTonDeposit: (id: string) =>
    request<DepositRecord>(`/deposit/ton/${id}/check`, { method: 'POST' }),
  getDeposit: (id: string) => request<DepositRecord>(`/deposit/${id}`),
  casinoCases: () => request<LootCase[]>('/casino/cases'),
  casinoCase: (id: string) => request<LootCase>(`/casino/cases/${id}`),
  openCase: (id: string, idempotencyKey?: string, maxPrice?: number) =>
    request<CaseOpening>(`/casino/cases/${id}/open`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey, maxPrice }),
    }),
  casinoOpenings: (limit = 20) =>
    request<CaseOpening[]>(`/casino/openings?limit=${limit}`),
  redeemPromo: (code: string) =>
    request<{ ok: boolean; kind: string; message: string }>('/promo/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  jointFriends: () => request<JointFriend[]>('/joint/friends'),
  jointBuy: (
    partnerId: string | undefined,
    fishId: string,
    quantity: number,
    partnerUsername?: string,
  ) =>
    request('/joint/buy', {
      method: 'POST',
      body: JSON.stringify({
        partnerId: partnerId || undefined,
        partnerUsername: partnerUsername || undefined,
        fishId,
        quantity,
      }),
    }),
  jointSell: (holdingId: string) =>
    request('/joint/sell', {
      method: 'POST',
      body: JSON.stringify({ holdingId }),
    }),
  jointRespond: (id: string, accept: boolean) =>
    request(`/joint/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    }),
  jointMine: () =>
    request<{
      incoming: JointProposal[];
      outgoing: JointProposal[];
      holdings: unknown[];
    }>('/joint/mine'),
};
