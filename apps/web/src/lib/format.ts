export function formatStars(value: string | number, digits = 0) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPct(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function pnlClass(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

export const FISH_GLYPH: Record<string, string> = {
  AROWANA: '𓆝',
  QKOI: '𓆟',
  DGUPPY: '𓆜',
  EPUFFER: '🐡',
  BDRAGON: '𓆞',
  CBETTA: '𓆛',
  ASHARK: '🦈',
  MWHALE: '🐋',
  NEON: '✨',
  CLOWN: '🐠',
  ANGEL: '👼',
  STING: '🛸',
  HORSE: '🐴',
  BARRA: '⚡',
  GLDFSH: '🥇',
  MANTA: '🦇',
  PIRANA: '🦷',
  CATFSH: '🐱',
};

export function fishGlyph(symbol: string) {
  return FISH_GLYPH[symbol] || '🐟';
}
