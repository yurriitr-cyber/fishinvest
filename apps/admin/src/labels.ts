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
