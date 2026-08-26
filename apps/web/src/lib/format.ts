export function formatStars(value: string | number, digits = 0) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Credits span many orders of magnitude, so scale precision to the amount. */
export function formatCredits(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return n.toLocaleString('en-US', {
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

export function formatSupply(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function pnlClass(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

/** Short monogram for list rows — no emoji. */
export function fishGlyph(symbol: string) {
  const s = symbol.toUpperCase();
  if (s.length <= 3) return s;
  return s.slice(0, 2);
}
