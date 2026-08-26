import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { randomUUID } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { OracleService } from '../oracle/oracle.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildTonTransferLink,
  fetchTonIncomings,
  memoForDeposit,
  nanoToTonString,
  tonToNano,
} from './ton.util';

const STAR_PACKS = [50, 100, 250, 500, 1000] as const;
const TON_PACKS = [0.5, 1, 2, 5, 10] as const;

@Injectable()
export class DepositService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositService.name);
  private tonTimer: NodeJS.Timeout | null = null;
  private tonCache:
    | { address: string; at: number; txs: Awaited<ReturnType<typeof fetchTonIncomings>> }
    | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly oracle: OracleService,
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

    // Enable TON when a deposit wallet is configured
    const tonAddr = (this.config.get<string>('TON_DEPOSIT_ADDRESS') || '').trim();
    if (tonAddr) {
      await this.prisma.db.paymentProviderConfig.updateMany({
        where: { code: 'TON' },
        data: { isEnabled: true, feePercent: 0 },
      });
      this.tonTimer = setInterval(() => {
        this.pollTonDeposits().catch((err) =>
          this.logger.warn(`TON poll failed: ${err?.message || err}`),
        );
      }, 12_000);
      setTimeout(() => {
        this.pollTonDeposits().catch(() => undefined);
      }, 2_000);
      this.logger.log(`TON deposits enabled → ${tonAddr.slice(0, 8)}… (+${this.tonBonusPercent()}% bonus)`);
    } else {
      this.logger.log('TON deposits off (set TON_DEPOSIT_ADDRESS to enable)');
    }
  }

  onModuleDestroy() {
    if (this.tonTimer) clearInterval(this.tonTimer);
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
        label: 'Telegram Stars',
        note: '1 Telegram Star = 1 game credit',
      },
      TON: {
        label: 'TON',
        note: 'Live TON→CR rate + 15% bonus · auto-confirm',
      },
      TELEGRAM_GIFT: {
        label: 'Telegram Gift',
        note: 'Verified gifts only after valuation',
      },
      CRYPTO: {
        label: 'Other crypto',
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
        tonPacks: p.code === 'TON' && p.isEnabled ? [...TON_PACKS] : undefined,
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
      title: 'Кредиты Rare Fish',
      description:
        Number(quote.feePercent) > 0
          ? `${quote.gameCreditAmount} игровых кредитов (после комиссии ${quote.feePercent}%)`
          : `${quote.gameCreditAmount} игровых кредитов (1★ = 1 кредит)`,
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

  /** Approx Telegram Star USD for converting TON→credits (1★ = 1 credit). */
  private starUsdPrice(): Prisma.Decimal {
    const raw = this.config.get<string>('STAR_USD_PRICE') || '0.02';
    return new Prisma.Decimal(raw);
  }

  /** Extra credits on TON deposits (default +15%). */
  private tonBonusPercent(): Prisma.Decimal {
    const raw = this.config.get<string>('TON_DEPOSIT_BONUS_PERCENT');
    if (raw === undefined || raw === '') return new Prisma.Decimal(15);
    return new Prisma.Decimal(raw);
  }

  async quoteTon(tonAmount: number) {
    if (!Number.isFinite(tonAmount) || tonAmount < 0.05 || tonAmount > 500) {
      throw new BadRequestException('TON amount must be between 0.05 and 500');
    }
    await this.requireProvider('TON');
    const address = (this.config.get<string>('TON_DEPOSIT_ADDRESS') || '').trim();
    if (!address) {
      throw new BadRequestException('TON_DEPOSIT_ADDRESS is not configured');
    }

    const ton = await this.oracle.getTonUsd({ force: true });
    const tonUsd = new Prisma.Decimal(ton.usdPrice);
    const assetAmount = new Prisma.Decimal(tonAmount.toFixed(9));
    const usdValue = assetAmount.mul(tonUsd);
    const starUsd = this.starUsdPrice();
    const starsEquivalent = usdValue.div(starUsd);
    const creditRate = await this.getStarsToGameCreditRate();
    const provider = await this.requireProvider('TON');
    const feePercent = provider.feePercent;
    const gross = starsEquivalent.mul(creditRate);
    const feeAmount = gross.mul(feePercent).div(100);
    const afterFee = gross.sub(feeAmount);
    const bonusPercent = this.tonBonusPercent();
    const bonusAmount = afterFee.mul(bonusPercent).div(100);
    const net = afterFee.add(bonusAmount);

    return {
      provider: 'TON' as const,
      assetType: 'TON',
      assetAmount: assetAmount.toFixed(9),
      tonUsdPrice: tonUsd.toFixed(8),
      usdValue: usdValue.toFixed(8),
      starUsdPrice: starUsd.toFixed(8),
      exchangeRate: creditRate.div(starUsd).mul(tonUsd).toFixed(8), // base credits per 1 TON (before bonus)
      rateSource: ton.source,
      rateFetchedAt: ton.fetchedAt,
      rateNote: `Live TON/USD ($${Number(ton.usdPrice).toFixed(4)}) → ★@$${starUsd} + ${bonusPercent}% TON bonus`,
      feePercent: feePercent.toFixed(4),
      bonusPercent: bonusPercent.toFixed(4),
      bonusAmount: bonusAmount.toFixed(4),
      grossGameCredits: gross.toFixed(4),
      feeAmount: feeAmount.toFixed(4),
      gameCreditAmount: net.toFixed(4),
      depositAddress: address,
    };
  }

  async createTonDeposit(userId: string, tonAmount: number, idempotencyKey?: string) {
    const quote = await this.quoteTon(tonAmount);
    const key = idempotencyKey || `ton:${userId}:${tonAmount}:${randomUUID()}`;

    const existing = await this.prisma.db.deposit.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      return this.serializeDeposit(existing);
    }

    const deposit = await this.prisma.db.deposit.create({
      data: {
        userId,
        provider: 'TON',
        assetType: 'TON',
        assetAmount: quote.assetAmount,
        assetUsdValue: quote.usdValue,
        exchangeRate: quote.exchangeRate,
        grossGameCredits: quote.grossGameCredits,
        feePercent: quote.feePercent,
        feeAmount: quote.feeAmount,
        gameCreditAmount: quote.gameCreditAmount,
        status: 'PENDING',
        oracleSource: quote.rateSource,
        idempotencyKey: key,
        quoteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: {},
      },
    });

    const memo = memoForDeposit(deposit.id);
    const amountNano = tonToNano(Number(quote.assetAmount));
    const transferLink = buildTonTransferLink({
      address: quote.depositAddress,
      amountNano,
      comment: memo,
    });

    const meta = {
      rateNote: quote.rateNote,
      tonUsdPrice: quote.tonUsdPrice,
      starUsdPrice: quote.starUsdPrice,
      bonusPercent: quote.bonusPercent,
      bonusAmount: quote.bonusAmount,
      depositAddress: quote.depositAddress,
      memo,
      amountNano: amountNano.toString(),
      transferLink,
    };

    const updated = await this.prisma.db.deposit.update({
      where: { id: deposit.id },
      data: { metadata: meta },
    });

    await this.prisma.db.paymentTransaction.create({
      data: {
        depositId: deposit.id,
        step: 'TON_INVOICE_CREATED',
        payload: meta,
      },
    });

    return this.serializeDeposit(updated, meta);
  }

  async checkTonDeposit(userId: string, depositId: string) {
    const deposit = await this.prisma.db.deposit.findFirst({
      where: { id: depositId, userId, provider: 'TON' },
    });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.status === 'CONFIRMED') {
      return this.serializeDeposit(deposit);
    }
    await this.tryConfirmTonDeposit(deposit.id);
    const fresh = await this.prisma.db.deposit.findUniqueOrThrow({
      where: { id: deposit.id },
    });
    return this.serializeDeposit(fresh);
  }

  async pollTonDeposits() {
    const address = (this.config.get<string>('TON_DEPOSIT_ADDRESS') || '').trim();
    if (!address) return;

    const pending = await this.prisma.db.deposit.findMany({
      where: {
        provider: 'TON',
        status: 'PENDING',
        quoteExpiresAt: { gt: new Date() },
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length === 0) return;

    // One chain fetch for the whole batch
    try {
      await this.loadTonIncomings(address);
    } catch (e) {
      this.logger.warn(`TON fetch failed: ${e instanceof Error ? e.message : e}`);
      return;
    }

    for (const d of pending) {
      await this.tryConfirmTonDeposit(d.id);
    }
  }

  private async loadTonIncomings(address: string) {
    const now = Date.now();
    if (
      this.tonCache &&
      this.tonCache.address === address &&
      now - this.tonCache.at < 8_000
    ) {
      return this.tonCache.txs;
    }
    const apiKey = this.config.get<string>('TONAPI_KEY') || undefined;
    const txs = await fetchTonIncomings({ address, apiKey, limit: 40 });
    this.tonCache = { address, at: now, txs };
    return txs;
  }

  private async tryConfirmTonDeposit(depositId: string) {
    const deposit = await this.prisma.db.deposit.findUnique({
      where: { id: depositId },
    });
    if (!deposit || deposit.provider !== 'TON' || deposit.status !== 'PENDING') {
      return;
    }
    if (deposit.quoteExpiresAt && deposit.quoteExpiresAt < new Date()) {
      await this.prisma.db.deposit.update({
        where: { id: deposit.id },
        data: { status: 'CANCELLED' },
      });
      return;
    }

    const address = (this.config.get<string>('TON_DEPOSIT_ADDRESS') || '').trim();
    const meta =
      typeof deposit.metadata === 'object' && deposit.metadata
        ? (deposit.metadata as Record<string, unknown>)
        : {};
    const memo = String(meta.memo || memoForDeposit(deposit.id));
    const expectedNano = tonToNano(Number(deposit.assetAmount));
    // Accept slight underpay from rounding (≥ 99%)
    const minNano = (expectedNano * 99n) / 100n;

    let txs;
    try {
      txs = await this.loadTonIncomings(address);
    } catch (e) {
      this.logger.warn(`TON fetch failed: ${e instanceof Error ? e.message : e}`);
      return;
    }

    const match = txs.find((tx) => {
      if (tx.valueNano < minNano) return false;
      const c = tx.comment.toLowerCase();
      return c.includes(memo.toLowerCase());
    });
    if (!match) return;

    // Already used?
    const byHash = await this.prisma.db.deposit.findUnique({
      where: { externalTransactionId: match.hash },
    });
    if (byHash && byHash.id !== deposit.id) {
      this.logger.warn(`TON tx ${match.hash} already linked to ${byHash.id}`);
      return;
    }

    await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.deposit.findUnique({ where: { id: deposit.id } });
      if (!locked || locked.status === 'CONFIRMED') return;
      const net = locked.gameCreditAmount;
      if (!net) throw new BadRequestException('Deposit missing credit amount');

      await this.ledger.creditInTransaction(tx, {
        userId: locked.userId,
        type: 'DEPOSIT_TON',
        amount: net,
        idempotencyKey: `deposit:ton:${locked.id}`,
        referenceType: 'deposit',
        referenceId: locked.id,
        metadata: {
          txHash: match.hash,
          tonPaid: nanoToTonString(match.valueNano),
          memo,
        },
      });

      await tx.deposit.update({
        where: { id: locked.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          externalTransactionId: match.hash,
          metadata: {
            ...(typeof locked.metadata === 'object' && locked.metadata
              ? (locked.metadata as object)
              : {}),
            txHash: match.hash,
            tonPaid: nanoToTonString(match.valueNano),
          },
        },
      });

      await tx.paymentTransaction.create({
        data: {
          depositId: locked.id,
          step: 'TON_PAYMENT_CONFIRMED',
          payload: {
            txHash: match.hash,
            valueNano: match.valueNano.toString(),
            comment: match.comment,
          },
        },
      });
    });

    this.logger.log(`TON deposit confirmed ${deposit.id} tx=${match.hash}`);
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
          prices: [{ label: 'Игровые кредиты', amount: params.starAmount }],
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
      assetAmount:
        deposit.provider === 'TON'
          ? deposit.assetAmount.toFixed(9)
          : deposit.assetAmount.toFixed(4),
      exchangeRate: deposit.exchangeRate?.toFixed(8) ?? null,
      grossGameCredits: deposit.grossGameCredits?.toFixed(4) ?? null,
      feePercent: deposit.feePercent?.toFixed(4) ?? null,
      feeAmount: deposit.feeAmount?.toFixed(4) ?? null,
      gameCreditAmount: deposit.gameCreditAmount?.toFixed(4) ?? null,
      status: deposit.status,
      invoiceLink: typeof meta.invoiceLink === 'string' ? meta.invoiceLink : null,
      depositAddress:
        typeof meta.depositAddress === 'string' ? meta.depositAddress : null,
      memo: typeof meta.memo === 'string' ? meta.memo : null,
      transferLink:
        typeof meta.transferLink === 'string' ? meta.transferLink : null,
      rateNote: typeof meta.rateNote === 'string' ? meta.rateNote : null,
      bonusPercent:
        typeof meta.bonusPercent === 'string' ? meta.bonusPercent : null,
      bonusAmount: typeof meta.bonusAmount === 'string' ? meta.bonusAmount : null,
      externalTransactionId: deposit.externalTransactionId,
      confirmedAt: deposit.confirmedAt?.toISOString() ?? null,
      createdAt: deposit.createdAt.toISOString(),
    };
  }
}
