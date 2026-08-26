export enum LedgerType {
  INITIAL_BONUS = 'INITIAL_BONUS',
  REFERRAL_JOIN_BONUS = 'REFERRAL_JOIN_BONUS',
  REFERRAL_BONUS = 'REFERRAL_BONUS',
  DEPOSIT_STARS = 'DEPOSIT_STARS',
  DEPOSIT_TON = 'DEPOSIT_TON',
  DEPOSIT_GIFT = 'DEPOSIT_GIFT',
  DEPOSIT_CRYPTO = 'DEPOSIT_CRYPTO',
  BUY_FISH = 'BUY_FISH',
  SELL_FISH = 'SELL_FISH',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
  FEE = 'FEE',
}

export enum DepositStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum DepositProvider {
  TELEGRAM_STARS = 'TELEGRAM_STARS',
  TON = 'TON',
  TELEGRAM_GIFT = 'TELEGRAM_GIFT',
  CRYPTO = 'CRYPTO',
}

export enum FishRarity {
  COMMON = 'COMMON',
  RARE = 'RARE',
  EPIC = 'EPIC',
  LEGENDARY = 'LEGENDARY',
  MYTHIC = 'MYTHIC',
}

export enum PriceSource {
  AUTOMATIC = 'AUTOMATIC',
  ADMIN = 'ADMIN',
  EVENT = 'EVENT',
}

export enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  BANNED = 'BANNED',
}

export enum ReferralStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

export const DEFAULT_INITIAL_BONUS = 200;
export const DEFAULT_REFERRAL_BONUS = 300;
export const DEFAULT_REFERRAL_JOIN_BONUS = 50;

export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Accepts Telegram start payloads in common shapes:
 *   ref_ABCD1234 | REF_ABCD1234 | ABCD1234
 * Also strips accidental wrapping from share URLs.
 */
export function parseReferralCode(startParam?: string | null): string | null {
  if (!startParam) return null;
  let raw = startParam.trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  // If a full link was pasted into start, pull the payload out.
  const fromQuery =
    raw.match(/[?&#](?:startapp|start|tgWebAppStartParam)=([^&#]+)/i)?.[1] ||
    raw.match(/startapp=([^&#]+)/i)?.[1];
  if (fromQuery) {
    try {
      raw = decodeURIComponent(fromQuery);
    } catch {
      raw = fromQuery;
    }
  }
  const match = raw.match(/^(?:ref[_-])?([A-Z0-9]{6,12})$/i);
  return match ? match[1].toUpperCase() : null;
}
