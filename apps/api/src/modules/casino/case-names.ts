const CASE_DISPLAY: Record<string, { name: string; description: string }> = {
  DAILY: {
    name: 'Ежедневный ящик',
    description:
      'Бесплатно раз в 24 часа. В основном дешёвая рыба, эпики — редкий джекпот.',
  },
  TIDE: {
    name: 'Приливной ящик',
    description: 'Мелководье. Дешёвые открытия, в основном обычная наживка.',
  },
  REEF: {
    name: 'Рифовый сундук',
    description: 'Коралловая полка. Редкие и первые эпики.',
  },
  ABYSS: {
    name: 'Бездна-хранилище',
    description: 'Зона давления. Эпики почти гарантированы, легендарки рядом.',
  },
  LEVIATHAN: {
    name: 'Левиафан',
    description: 'Глубокие деньги. Легендарки и погоня за мификами.',
  },
};

export function caseDisplayName(code: string, fallback?: string | null) {
  return CASE_DISPLAY[code.toUpperCase()]?.name || fallback || code;
}

export function caseDisplayDesc(code: string, fallback?: string | null) {
  return CASE_DISPLAY[code.toUpperCase()]?.description || fallback || '';
}
