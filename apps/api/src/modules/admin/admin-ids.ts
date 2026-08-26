/** Dev-friendly admin allowlist parser. */
export function parseAdminTelegramIds(raw?: string | null): string[] {
  const hasRealBotToken =
    !!process.env.TELEGRAM_BOT_TOKEN &&
    process.env.TELEGRAM_BOT_TOKEN !== 'your_bot_token_here';

  const value =
    raw && raw.trim().length > 0
      ? raw
      : !hasRealBotToken || process.env.NODE_ENV !== 'production'
        ? '1001'
        : '';

  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
