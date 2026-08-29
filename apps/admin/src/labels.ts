const FISH_NAMES: Record<string, string> = {
  GLDFSH: 'GOLDI',
  NEON: 'GRACEFULLY',
  CATFSH: 'ZOOFI',
  CLOWN: 'PORCUPINEFISH',
  HORSE: 'LIONFISH',
  DGUPPY: 'MEG',
  PIRANA: 'MONKFISH',
  CBETTA: 'SQUIDI',
  BARRA: 'GIGA JELLY',
  QKOI: 'BLOOP',
  ANGEL: 'MOZZI',
  AROWANA: 'TWISTY TOOTH',
  EPUFFER: 'MONSTER',
  ASHARK: 'ELECTRIC EEL',
  BDRAGON: 'DemogorFish',
  STING: 'STING',
  MANTA: 'PHANTOM',
  MWHALE: 'DEEP FEAR',
};

const CASE_NAMES: Record<string, string> = {
  DAILY: 'Ежедневный ящик',
  TIDE: 'Приливной ящик',
  REEF: 'Рифовый сундук',
  ABYSS: 'Бездна-хранилище',
  LEVIATHAN: 'Левиафан',
};

const LEDGER: Record<string, string> = {
  INITIAL_BONUS: 'Стартовый бонус',
  REFERRAL_JOIN_BONUS: 'Бонус за приглашение (новичок)',
  REFERRAL_BONUS: 'Реферальный бонус',
  DEPOSIT_STARS: 'Депозит Stars',
  DEPOSIT_TON: 'Депозит TON',
  DEPOSIT_GIFT: 'Депозит подарок',
  DEPOSIT_CRYPTO: 'Депозит crypto',
  BUY_FISH: 'Покупка рыбы',
  SELL_FISH: 'Продажа рыбы',
  ADMIN_ADJUSTMENT: 'Корректировка админа',
  FEE: 'Комиссия',
  CASE_OPEN: 'Открытие кейса',
  PROMO_BONUS: 'Промокод',
};

const RARITY: Record<string, string> = {
  COMMON: 'Обычная',
  RARE: 'Редкая',
  EPIC: 'Эпическая',
  LEGENDARY: 'Легендарная',
  MYTHIC: 'Мифическая',
};

export function fishName(symbol?: string | null, fallback?: string | null) {
  if (!symbol) return fallback || '—';
  return FISH_NAMES[symbol.toUpperCase()] || fallback || symbol;
}

export function caseName(code?: string | null, fallback?: string | null) {
  if (!code) return fallback || '—';
  return CASE_NAMES[code.toUpperCase()] || fallback || code;
}

export function ledgerLabel(type?: string | null) {
  if (!type) return '—';
  return LEDGER[type.toUpperCase()] || type;
}

export function rarityLabel(rarity?: string | null) {
  if (!rarity) return '';
  return RARITY[rarity.toUpperCase()] || rarity;
}

const DEPOSIT_STATUS: Record<string, string> = {
  CONFIRMED: 'Оплата прошла',
  FAILED: 'Оплата не прошла',
  CANCELLED: 'Оплата отменена',
  PENDING: 'Ждёт оплату',
};

const DEPOSIT_PROVIDER: Record<string, string> = {
  TELEGRAM_STARS: 'Telegram Stars',
  TON: 'TON',
  TELEGRAM_GIFT: 'Подарок',
  CRYPTO: 'Crypto',
};

export function depositStatusLabel(status?: string | null) {
  if (!status) return '—';
  return DEPOSIT_STATUS[status.toUpperCase()] || status;
}

export function depositStatusTone(status?: string | null) {
  switch ((status || '').toUpperCase()) {
    case 'CONFIRMED':
      return 'ok';
    case 'FAILED':
      return 'danger';
    case 'CANCELLED':
      return 'muted';
    case 'PENDING':
      return 'warn';
    default:
      return '';
  }
}

export function depositProviderLabel(provider?: string | null) {
  if (!provider) return '—';
  return DEPOSIT_PROVIDER[provider.toUpperCase()] || provider;
}
