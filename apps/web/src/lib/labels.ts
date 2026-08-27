/** Client-side labels for fish display names / codes. */

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
  EPUFFER: 'WHALE',
  ASHARK: 'STINGY',
  BDRAGON: 'MONSTER',
  STING: 'DEEP FEAR',
  MANTA: 'MANTA',
  MWHALE: 'MEGA WHALE',
};

const RARITY: Record<string, string> = {
  COMMON: 'Обычная',
  RARE: 'Редкая',
  EPIC: 'Эпическая',
  LEGENDARY: 'Легендарная',
  MYTHIC: 'Мифическая',
};

const CASE_NAMES: Record<string, string> = {
  TIDE: 'Приливной ящик',
  REEF: 'Рифовый сундук',
  ABYSS: 'Бездна-хранилище',
  LEVIATHAN: 'Левиафан',
};

const CASE_DESC: Record<string, string> = {
  TIDE: 'Мелководье. Дешёвые открытия, в основном обычная наживка.',
  REEF: 'Коралловая полка. Редкие и первые эпики.',
  ABYSS: 'Зона давления. Эпики почти гарантированы, легендарки рядом.',
  LEVIATHAN: 'Глубокие деньги. Легендарки и погоня за мификами.',
};

const DEPOSIT_STATUS: Record<string, string> = {
  PENDING: 'Ожидание',
  CONFIRMED: 'Зачислено',
  CANCELLED: 'Отменено',
  FAILED: 'Ошибка',
  EXPIRED: 'Истекло',
};

const ERROR_MAP: Array<[RegExp | string, string]> = [
  ['Request failed', 'Ошибка запроса'],
  ['Insufficient game balance', 'Недостаточно кредитов'],
  ['Sold out', 'Распродано'],
  ['Trading for this fish is frozen', 'Торговля этой рыбой заморожена'],
  ['Case price moved — refresh and try again', 'Цена кейса изменилась — обновите и попробуйте снова'],
  ['Invoice link missing', 'Ссылка на счёт не получена'],
  ['Failed to load', 'Не удалось загрузить'],
  ['Quote failed', 'Не удалось получить котировку'],
  ['Deposit failed', 'Депозит не удался'],
  ['Open failed', 'Не удалось открыть'],
  ['Trade failed', 'Сделка не удалась'],
  ['Account is banned', 'Аккаунт заблокирован'],
  ['Unauthorized', 'Нет доступа'],
  ['Forbidden', 'Доступ запрещён'],
];

export function fishName(symbol: string, fallback?: string | null) {
  return FISH_NAMES[symbol.toUpperCase()] || fallback || symbol;
}

export function rarityLabel(rarity: string) {
  return RARITY[rarity.toUpperCase()] || rarity;
}

export function caseName(code: string, fallback?: string | null) {
  return CASE_NAMES[code.toUpperCase()] || fallback || code;
}

export function caseDesc(code: string, fallback?: string | null) {
  return CASE_DESC[code.toUpperCase()] || fallback || '';
}

export function depositStatus(status: string) {
  return DEPOSIT_STATUS[status.toUpperCase()] || status;
}

export function translateError(message: string) {
  for (const [key, ru] of ERROR_MAP) {
    if (typeof key === 'string') {
      if (message === key || message.includes(key)) return ru;
    } else if (key.test(message)) {
      return ru;
    }
  }
  return message;
}
