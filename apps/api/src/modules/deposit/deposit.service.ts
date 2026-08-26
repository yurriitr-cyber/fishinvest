import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { randomUUID } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

const STAR_PACKS = [50, 100, 250, 500, 1000] as const;

@Injectable()
export class DepositService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // Keep DB in sync with env so admin/UI never show stale 10x / 3% values.
    const rate = await this.getStarsToGameCreditRate();
    const fee = await this.getStarsFeePercent(new Prisma.Decimal(0));

    await this.prisma.db.paymentProviderConfig.updateMany({
      where: { code: 'TELEGRAM_STARS' },
      data: { feePercent: fee },
    });

    await this.prisma.db.exchangeRate.updateMany({
      where: {
        fromAsset: { in: ['REAL_TELEGRAM_STAR', 'STARS_EQUIVALENT'] },
        toAsset: 'GAME_CREDIT',
      },
      data: { rate },
    });
  }
  listStarPacks() {
    return [...STAR_PACKS];
  }

  async getMethods() {
    const providers = await this.prisma.db.paymentProviderConfig.findMany({
      orderBy: { code: 'asc' },
    });
    const starsFee = await this.getStarsFeePercent(new Prisma.Decimal(0));

    const labels: Record<string, { label: string; note: string }> = {
      TELEGRAM_STARS: {
        label: '⭐ Telegram Stars',
        note: '1 Telegram Star = 1 game credit',
      },
      TON: {
        label: '💎 TON',
        note: 'Live oracle rate TON → USD → Stars-equivalent',
      },
      TELEGRAM_GIFT: {
        label: '🎁 Telegram Gift',
        note: 'Verified gifts only after valuation',
      },
      CRYPTO: {
        label: '₿ Other crypto',
        note: 'USDT / BTC / ETH via shared payment interface',
      },
    };

    return providers.map((p) => {
      const meta = labels[p.code] || { label: p.code, note: 'Payment provider' };
      const fee =
        p.code === 'TELEGRAM_STARS' ? starsFee : p.feePercent;
      return {
        code: p.code,
        label: meta.label,
        enabled: p.isEnabled,
        feePercent: fee.toFixed(2),
        note: p.isEnabled
          ? meta.note
          : 'Provider scaffolded — not enabled yet',
        packs: p.code === 'TELEGRAM_STARS' ? this.listStarPacks() : undefined,
      };
    });
  }

  /** REAL Telegram Stars → GAME CREDITS (default 1:1). */
  async getStarsToGameCreditRate(): Promise<Prisma.Decimal> {
    const envRate = this.config.get<string>('STARS_TO_GAME_CREDIT_RATE');
    if (envRate) return new Prisma.Decimal(envRate);

    const row = await this.prisma.db.exchangeRate.findFirst({
      where: {
        fromAsset: 'REAL_TELEGRAM_STAR',
        toAsset: 'GAME_CREDIT',
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (row) return row.rate;

    const legacy = await this.prisma.db.exchangeRate.findFirst({
      where: { fromAsset: 'STARS_EQUIVALENT', toAsset: 'GAME_CREDIT' },
      orderBy: { effectiveFrom: 'desc' },
    });
    return legacy?.rate ?? new Prisma.Decimal(1);
  }

  async getStarsFeePercent(providerFee: Prisma.Decimal): Promise<Prisma.Decimal> {
    const envFee = this.config.get<string>('STARS_DEPOSIT_FEE_PERCENT');
    if (envFee !== undefined && envFee !== '') {
      return new Prisma.Decimal(envFee);
    }
    return providerFee;
  }

  async quoteStars(starAmount: number) {
    if (!Number.isInteger(starAmount) || starAmount < 1) {
      throw new BadRequestException('Star amount must be a positive integer');
    }

    const provider = await this.requireProvider('TELEGRAM_STARS');
    const rate = await this.getStarsToGameCreditRate();
    const assetAmount = new Prisma.Decimal(starAmount);
    const gross = assetAmount.mul(rate);
    const feePercent = await this.getStarsFeePercent(provider.feePercent);
    const feeAmount = gross.mul(feePercent).div(100);
    const net = gross.sub(feeAmount);

    return {
      provider: 'TELEGRAM_STARS' as const,
      assetType: 'XTR',
      assetAmount: assetAmount.toFixed(0),
      exchangeRate: rate.toFixed(8),
      rateSource: 'config_exchange_rate',
      rateNote: '1 Telegram Star = 1 game credit (configurable).',
      feePercent: feePercent.toFixed(4),
      grossGameCredits: gross.toFixed(4),
      feeAmount: feeAmount.toFixed(4),
      gameCreditAmount: net.toFixed(4),
    };
  }

  async createStarsDeposit(userId: string, starAmount: number, idempotencyKey?: string) {
    const provider = await this.requireProvider('TELEGRAM_STARS');
    const quote = await this.quoteStars(starAmount);
    const key = idempotencyKey || `stars:${userId}:${starAmount}:${randomUUID()}`;

    const existing = await this.prisma.db.deposit.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      return this.serializeDeposit(existing, existing.metadata as Record<string, unknown>);
    }

    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken || botToken === 'your_bot_token_here') {
      throw new BadRequestException(
        'TELEGRAM_BOT_TOKEN is required to create Stars invoices',
      );
    }

    const deposit = await this.prisma.db.deposit.create({
      data: {
        userId,
        provider: 'TELEGRAM_STARS',
        assetType: 'XTR',
        assetAmount: quote.assetAmount,
        exchangeRate: quote.exchangeRate,
        grossGameCredits: quote.grossGameCredits,
        feePercent: quote.feePercent,
        feeAmount: quote.feeAmount,
        gameCreditAmount: quote.gameCreditAmount,
        status: 'PENDING',
        oracleSource: quote.rateSource,
        idempotencyKey: key,
        quoteExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        metadata: {
          rateNote: quote.rateNote,
        },
      },
    });

    const invoiceLink = await this.createInvoiceLink({
      botToken,
      title: 'Rare Fish game credits',
      description:
        Number(quote.feePercent) > 0
          ? `${quote.gameCreditAmount} game credits (after ${quote.feePercent}% fee)`
          : `${quote.gameCreditAmount} game credits (1★ = 1 credit)`,
      payload: deposit.id,
      starAmount,
    });

    const updated = await this.prisma.db.deposit.update({
      where: { id: deposit.id },
      data: {
        metadata: {
          rateNote: quote.rateNote,
          invoiceLink,
        },
      },
    });

    await this.prisma.db.paymentTransaction.create({
      data: {
        depositId: deposit.id,
        step: 'INVOICE_CREATED',
        payload: { invoiceLink, starAmount },
      },
    });

    return this.serializeDeposit(updated, {
      rateNote: quote.rateNote,
      invoiceLink,
    });
  }

  async confirmStarsPayment(params: {
    depositId: string;
    telegramPaymentChargeId: string;
    providerPaymentChargeId?: string;
    totalAmount: number;
    currency: string;
    telegramUserId: number;
  }) {
    if (params.currency !== 'XTR') {
      throw new BadRequestException('Only XTR (Telegram Stars) supported here');
    }

    const deposit = await this.prisma.db.deposit.findUnique({
      where: { id: params.depositId },
      include: { user: true },
    });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.provider !== 'TELEGRAM_STARS') {
      throw new BadRequestException('Deposit is not a Stars deposit');
    }
    if (Number(deposit.user.telegramId) !== params.telegramUserId) {
      throw new BadRequestException('Payment user mismatch');
    }
    if (Number(deposit.assetAmount) !== params.totalAmount) {
      throw new BadRequestException('Paid amount does not match deposit quote');
    }

    if (deposit.status === 'CONFIRMED') {
      return this.serializeDeposit(deposit);
    }

    // Idempotency on charge id
    const byCharge = await this.prisma.db.deposit.findUnique({
      where: { externalTransactionId: params.telegramPaymentChargeId },
    });
    if (byCharge && byCharge.id !== deposit.id) {
      throw new ConflictException('Charge already linked to another deposit');
    }

    const credited = await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.deposit.findUnique({ where: { id: deposit.id } });
      if (!locked) throw new NotFoundException('Deposit not found');
      if (locked.status === 'CONFIRMED') return locked;

      const net = locked.gameCreditAmount;
      if (!net) throw new BadRequestException('Deposit missing credit amount');

      await this.ledger.creditInTransaction(tx, {
        userId: locked.userId,
        type: 'DEPOSIT_STARS',
        amount: net,
        idempotencyKey: `deposit:stars:${locked.id}`,
        referenceType: 'deposit',
        referenceId: locked.id,
        metadata: {
          telegramPaymentChargeId: params.telegramPaymentChargeId,
          starsPaid: params.totalAmount,
        },
      });

      const confirmed = await tx.deposit.update({
        where: { id: locked.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          externalTransactionId: params.telegramPaymentChargeId,
          metadata: {
            ...(typeof locked.metadata === 'object' && locked.metadata
              ? (locked.metadata as object)
              : {}),
            providerPaymentChargeId: params.providerPaymentChargeId,
          },
        },
      });

      await tx.paymentTransaction.create({
        data: {
          depositId: locked.id,
          step: 'PAYMENT_CONFIRMED',
          payload: {
            telegramPaymentChargeId: params.telegramPaymentChargeId,
            totalAmount: params.totalAmount,
            currency: params.currency,
          },
        },
      });

      return confirmed;
    });

    return this.serializeDeposit(credited);
  }

  async getDeposit(userId: string, depositId: string) {
    const deposit = await this.prisma.db.deposit.findFirst({
      where: { id: depositId, userId },
    });
    if (!deposit) throw new NotFoundException('Deposit not found');
    return this.serializeDeposit(deposit);
  }

  async assertPendingStarsDeposit(depositId: string, telegramUserId: number) {
    const deposit = await this.prisma.db.deposit.findUnique({
      where: { id: depositId },
      include: { user: true },
    });
    if (!deposit || deposit.provider !== 'TELEGRAM_STARS') return false;
    if (deposit.status !== 'PENDING') return false;
    if (Number(deposit.user.telegramId) !== telegramUserId) return false;
    if (deposit.quoteExpiresAt && deposit.quoteExpiresAt < new Date()) return false;
    return true;
  }

  private async requireProvider(code: 'TELEGRAM_STARS' | 'TON' | 'TELEGRAM_GIFT' | 'CRYPTO') {
    const provider = await this.prisma.db.paymentProviderConfig.findUnique({
      where: { code },
    });
    if (!provider?.isEnabled) {
      throw new BadRequestException(`${code} deposits are not enabled`);
    }
    return provider;
  }

  private async createInvoiceLink(params: {
    botToken: string;
    title: string;
    description: string;
    payload: string;
    starAmount: number;
  }) {
    const res = await fetch(
      `https://api.telegram.org/bot${params.botToken}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: params.title.slice(0, 32),
          description: params.description.slice(0, 255),
          payload: params.payload,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: 'Game credits', amount: params.starAmount }],
        }),
      },
    );
    const data = (await res.json()) as { ok: boolean; result?: string; description?: string };
    if (!data.ok || !data.result) {
      throw new BadRequestException(
        data.description || 'Failed to create Telegram Stars invoice',
      );
    }
    return data.result;
  }

  private serializeDeposit(
    deposit: {
      id: string;
      provider: string;
      assetType: string;
      assetAmount: Prisma.Decimal;
      exchangeRate: Prisma.Decimal | null;
      grossGameCredits: Prisma.Decimal | null;
      feePercent: Prisma.Decimal | null;
      feeAmount: Prisma.Decimal | null;
      gameCreditAmount: Prisma.Decimal | null;
      status: string;
      externalTransactionId: string | null;
      confirmedAt: Date | null;
      createdAt: Date;
      metadata?: unknown;
    },
    metaOverride?: Record<string, unknown>,
  ) {
    const meta =
      metaOverride ||
      (typeof deposit.metadata === 'object' && deposit.metadata
        ? (deposit.metadata as Record<string, unknown>)
        : {});

    return {
      id: deposit.id,
      provider: deposit.provider,
      assetType: deposit.assetType,
      assetAmount: deposit.assetAmount.toFixed(4),
      exchangeRate: deposit.exchangeRate?.toFixed(8) ?? null,
      grossGameCredits: deposit.grossGameCredits?.toFixed(4) ?? null,
      feePercent: deposit.feePercent?.toFixed(4) ?? null,
      feeAmount: deposit.feeAmount?.toFixed(4) ?? null,
      gameCreditAmount: deposit.gameCreditAmount?.toFixed(4) ?? null,
      status: deposit.status,
      invoiceLink: typeof meta.invoiceLink === 'string' ? meta.invoiceLink : null,
      externalTransactionId: deposit.externalTransactionId,
      confirmedAt: deposit.confirmedAt?.toISOString() ?? null,
      createdAt: deposit.createdAt.toISOString(),
    };
  }
}
