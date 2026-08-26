import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bot, InlineKeyboard } from 'grammy';

const envCandidates = [
  resolve(process.cwd(), '../../.env'), // pnpm --filter from apps/bot
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '../../../.env'), // src/ or dist/
  resolve(__dirname, '../../.env'),
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5180';
/** Filled from Telegram getMe on start — do not trust a wrong env username. */
let botUsername =
  process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || 'rarefishinvestment_bot';
const apiBase = process.env.API_INTERNAL_URL || 'http://localhost:3000/api';
const internalSecret = process.env.INTERNAL_API_SECRET || '';

if (!token || token === 'your_bot_token_here') {
  console.error('Set TELEGRAM_BOT_TOKEN in .env before starting the bot.');
  process.exit(1);
}

if (!internalSecret) {
  console.warn(
    'WARNING: INTERNAL_API_SECRET is empty — Stars payment confirm will fail until set.',
  );
}

const bot = new Bot(token);

function openAppKeyboard(startParam?: string) {
  // Always open the hosted Mini App URL. Telegram keeps the query string, and
  // our frontend also reads tgWebAppStartParam / startapp into x-start-param.
  // Direct t.me/<bot>/<short> links fail when the BotFather short name is wrong.
  const url = startParam
    ? `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}tgWebAppStartParam=${encodeURIComponent(startParam)}`
    : webAppUrl;

  if (url.startsWith('https://')) {
    return new InlineKeyboard().webApp('🐟 Open Rare Fish Market', url);
  }

  return new InlineKeyboard().url(
    '🐟 Open Mini App (set WEBAPP_URL to https)',
    startParam
      ? `https://t.me/${botUsername}?start=${encodeURIComponent(startParam)}`
      : `https://t.me/${botUsername}`,
  );
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': internalSecret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim();
  const startParam =
    payload && payload.length > 0
      ? payload.startsWith('ref_')
        ? payload
        : `ref_${payload}`
      : undefined;

  const isInvite = Boolean(startParam?.startsWith('ref_'));

  await ctx.reply(
    [
      '*Rare Fish Investment*',
      '',
      isInvite
        ? 'You were invited — tap below to claim your *+50 CR* join bonus.'
        : 'A simulated aquarium market.',
      isInvite
        ? 'Your friend gets *+300 CR* when you open the app.'
        : 'You get *200 game ⭐* to start.',
      isInvite ? '' : 'Invite a friend: they get *+50*, you get *+300*.',
      '',
      '_Game credits are not real Telegram Stars._',
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
    {
      parse_mode: 'Markdown',
      reply_markup: openAppKeyboard(startParam),
    },
  );
});

bot.command('app', async (ctx) => {
  await ctx.reply('Dive in.', { reply_markup: openAppKeyboard() });
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Commands:',
      '/start — welcome + open Mini App',
      '/app — open market',
      '/help — this message',
      '',
      'Share your invite link from the Invite tab inside the app.',
    ].join('\n'),
  );
});

bot.on('pre_checkout_query', async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const depositId = q.invoice_payload;
  try {
    const result = await apiPost<{ ok: boolean }>(
      '/deposit/internal/stars/pre-checkout',
      {
        depositId,
        telegramUserId: q.from.id,
      },
    );
    await ctx.answerPreCheckoutQuery(result.ok, result.ok
      ? undefined
      : 'Deposit expired or invalid. Open the app and try again.');
  } catch (err) {
    console.error('pre_checkout failed', err);
    await ctx.answerPreCheckoutQuery(
      false,
      'Payment verification temporarily unavailable.',
    );
  }
});

bot.on('message:successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  if (!payment) return;

  try {
    const confirmed = await apiPost<{
      gameCreditAmount: string | null;
      status: string;
    }>('/deposit/internal/stars/confirm', {
      depositId: payment.invoice_payload,
      telegramPaymentChargeId: payment.telegram_payment_charge_id,
      providerPaymentChargeId: payment.provider_payment_charge_id,
      totalAmount: payment.total_amount,
      currency: payment.currency,
      telegramUserId: ctx.from!.id,
    });

    await ctx.reply(
      [
        '✅ Payment received.',
        `+${confirmed.gameCreditAmount ?? '?'} game credits credited.`,
        'Open the market and buy more fish.',
      ].join('\n'),
      { reply_markup: openAppKeyboard() },
    );
  } catch (err) {
    console.error('successful_payment handling failed', err);
    await ctx.reply(
      'Payment received, but crediting failed. Contact support with your payment receipt.',
    );
  }
});

bot.catch((err) => {
  console.error('Bot error', err);
});

bot.start({
  onStart: (info) => {
    if (info.username) {
      if (botUsername !== info.username) {
        console.warn(
          `TELEGRAM_BOT_USERNAME=${botUsername} != getMe @${info.username} — using getMe`,
        );
      }
      botUsername = info.username;
    }
    console.log(`Bot @${botUsername} running`);
    console.log(`WEBAPP_URL=${webAppUrl}`);
    console.log(`API_INTERNAL_URL=${apiBase}`);
    if (!webAppUrl.startsWith('https://')) {
      console.warn(
        'WEBAPP_URL is not https — Mini App button falls back to t.me link. Set WEBAPP_URL to your Railway web URL.',
      );
    }
  },
});
