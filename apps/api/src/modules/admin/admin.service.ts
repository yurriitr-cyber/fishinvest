import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, User } from '@rare-fish/db';
import { randomUUID } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { OracleService } from '../oracle/oracle.service';
import { TelegramNotifyService } from '../joint/telegram-notify.service';
import { getAdminConfiguredSecret } from '../../security/security';
import { fishDisplayName } from '../fish/fish-names';
import { caseDisplayName } from '../casino/case-names';

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const TEXT_MAX = 4096;
const CAPTION_MAX = 1024;

function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  const gif = buf.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedError(error?: string) {
  const e = (error || '').toLowerCase();
  return (
    e.includes('blocked') ||
    e.includes('deactivated') ||
    e.includes('chat not found') ||
    e.includes('user is deactivated') ||
    e.includes('forbidden')
  );
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly oracle: OracleService,
    private readonly tg: TelegramNotifyService,
  ) {}

  async dashboard() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      usersCount,
      activeUsers,
      deposits,
      gameCredits,
      tradesAgg,
      topFish,
      confirmedDeposits,
      openings24h,
      deposits24h,
    ] = await Promise.all([
      this.prisma.db.user.count(),
      this.prisma.db.user.count({ where: { lastSeenAt: { gte: since24h } } }),
      this.prisma.db.deposit.groupBy({
        by: ['provider', 'status'],
        _sum: { assetAmount: true, gameCreditAmount: true },
        _count: true,
      }),
      this.prisma.db.gameBalance.aggregate({ _sum: { available: true } }),
      this.prisma.db.trade.aggregate({
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.db.fish.findMany({
        where: { isActive: true },
        orderBy: { dailyChangePercent: 'desc' },
        take: 5,
      }),
      this.prisma.db.deposit.findMany({
        where: { status: 'CONFIRMED' },
        select: {
          provider: true,
          assetAmount: true,
          gameCreditAmount: true,
        },
      }),
      this.prisma.db.caseOpening.count({
        where: { createdAt: { gte: since24h } },
      }),
      this.prisma.db.deposit.count({
        where: { status: 'CONFIRMED', createdAt: { gte: since24h } },
      }),
    ]);

    const volumeByProvider: Record<string, { asset: string; credits: string; count: number }> = {};
    for (const d of confirmedDeposits) {
      const key = d.provider;
      if (!volumeByProvider[key]) {
        volumeByProvider[key] = { asset: '0', credits: '0', count: 0 };
      }
      volumeByProvider[key].asset = new Prisma.Decimal(volumeByProvider[key].asset)
        .add(d.assetAmount)
        .toFixed(4);
      volumeByProvider[key].credits = new Prisma.Decimal(volumeByProvider[key].credits)
        .add(d.gameCreditAmount ?? 0)
        .toFixed(4);
      volumeByProvider[key].count += 1;
    }

    // Top users by portfolio value
    const positions = await this.prisma.db.portfolioPosition.findMany({
      include: {
        fish: { select: { currentPrice: true } },
        user: { select: { id: true, username: true, firstName: true, telegramId: true } },
      },
    });
    const byUser = new Map<string, { user: (typeof positions)[0]['user']; value: Prisma.Decimal }>();
    for (const p of positions) {
      const value = p.fish.currentPrice.mul(p.quantity);
      const cur = byUser.get(p.userId);
      if (cur) cur.value = cur.value.add(value);
      else byUser.set(p.userId, { user: p.user, value });
    }
    const topUsers = [...byUser.values()]
      .sort((a, b) => b.value.comparedTo(a.value))
      .slice(0, 10)
      .map((u, i) => ({
        rank: i + 1,
        id: u.user.id,
        telegramId: u.user.telegramId.toString(),
        displayName: u.user.username || u.user.firstName || 'User',
        portfolioValue: u.value.toFixed(4),
      }));

    return {
      users: usersCount,
      activeUsers24h: activeUsers,
      totalGameCredits: (gameCredits._sum.available ?? new Prisma.Decimal(0)).toFixed(4),
      tradingVolume: (tradesAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(4),
      tradesCount: tradesAgg._count,
      depositsByProvider: volumeByProvider,
      depositGroups: deposits.map((g) => ({
        provider: g.provider,
        status: g.status,
        count: g._count,
        assetSum: (g._sum.assetAmount ?? new Prisma.Decimal(0)).toFixed(4),
        creditsSum: (g._sum.gameCreditAmount ?? new Prisma.Decimal(0)).toFixed(4),
      })),
      topFish: topFish.map((f) => ({
        id: f.id,
        symbol: f.symbol,
        name: fishDisplayName(f.symbol, f.name),
        price: f.currentPrice.toFixed(4),
        change: f.dailyChangePercent.toFixed(4),
        frozen: f.isFrozen,
      })),
      topUsers,
      openings24h,
      depositsConfirmed24h: deposits24h,
    };
  }

  async listFish() {
    const fish = await this.prisma.db.fish.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    const now = Date.now();
    return fish.map((f) => {
      const rampActive =
        f.rampStartAt &&
        f.rampEndAt &&
        f.rampFromPrice &&
        f.rampToPrice &&
        f.rampEndAt.getTime() > now;
      const rampProgress =
        rampActive && f.rampStartAt && f.rampEndAt
          ? Math.min(
              1,
              Math.max(
                0,
                (now - f.rampStartAt.getTime()) /
                  Math.max(1, f.rampEndAt.getTime() - f.rampStartAt.getTime()),
              ),
            )
          : null;
      return {
        id: f.id,
        symbol: f.symbol,
        name: fishDisplayName(f.symbol, f.name),
        rarity: f.rarity,
        currentPrice: f.currentPrice.toFixed(4),
        previousPrice: f.previousPrice.toFixed(4),
        dailyChangePercent: f.dailyChangePercent.toFixed(4),
        dailyTargetPercent: f.dailyTargetPercent.toFixed(4),
        rampFromPrice: f.rampFromPrice?.toFixed(4) ?? null,
        rampToPrice: f.rampToPrice?.toFixed(4) ?? null,
        rampStartAt: f.rampStartAt?.toISOString() ?? null,
        rampEndAt: f.rampEndAt?.toISOString() ?? null,
        rampProgress,
        volatility: f.volatility.toFixed(6),
        trend: f.trend.toFixed(6),
        totalSupply: f.totalSupply,
        availableSupply: f.availableSupply,
        minPrice: f.minPrice.toFixed(4),
        maxPrice: f.maxPrice.toFixed(4),
        isFrozen: f.isFrozen,
        isActive: f.isActive,
        sortOrder: f.sortOrder,
      };
    });
  }

  async createFish(admin: User, data: {
    symbol: string;
    name: string;
    rarity: string;
    currentPrice: number;
    volatility?: number;
    trend?: number;
    description?: string;
  }) {
    const price = new Prisma.Decimal(data.currentPrice);
    const fish = await this.prisma.db.fish.create({
      data: {
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        description: data.description,
        rarity: data.rarity as never,
        currentPrice: price,
        previousPrice: price,
        allTimeHigh: price,
        allTimeLow: price,
        volatility: data.volatility ?? 0.1,
        trend: data.trend ?? 0,
        momentum: 0,
        minPrice: Math.max(0.001, data.currentPrice * 0.1),
        maxPrice: Math.max(data.currentPrice * 4, data.currentPrice + 1),
        totalSupply: 10000,
        availableSupply: 10000,
      },
    });
    await this.log(admin.id, 'CREATE_FISH', 'fish', fish.id, null, fish);
    return fish;
  }

  async updateFish(admin: User, id: string, data: Record<string, unknown>) {
    const before = await this.prisma.db.fish.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Fish not found');

    const after = await this.prisma.db.fish.update({
      where: { id },
      data: {
        name: data.name as string | undefined,
        description: data.description as string | undefined,
        rarity: data.rarity as never,
        volatility: data.volatility != null ? Number(data.volatility) : undefined,
        trend: data.trend != null ? Number(data.trend) : undefined,
        dailyTargetPercent:
          data.dailyTargetPercent != null
            ? Number(data.dailyTargetPercent)
            : undefined,
        isActive: data.isActive as boolean | undefined,
        minPrice: data.minPrice != null ? Number(data.minPrice) : undefined,
        maxPrice: data.maxPrice != null ? Number(data.maxPrice) : undefined,
        sortOrder: data.sortOrder != null ? Number(data.sortOrder) : undefined,
        imageUrl:
          data.imageUrl === null
            ? null
            : data.imageUrl != null
              ? String(data.imageUrl)
              : undefined,
      },
    });
    await this.log(admin.id, 'UPDATE_FISH', 'fish', id, before, after);
    return after;
  }

  async setPrice(admin: User, id: string, newPrice: number, reason?: string) {
    if (newPrice <= 0) throw new BadRequestException('Price must be positive');
    const fish = await this.prisma.db.fish.findUnique({ where: { id } });
    if (!fish) throw new NotFoundException('Fish not found');

    const previous = fish.currentPrice;
    const price = new Prisma.Decimal(newPrice);
    const changePercent = previous.gt(0)
      ? price.sub(previous).div(previous).mul(100)
      : new Prisma.Decimal(0);

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const row = await tx.fish.update({
        where: { id },
        data: {
          previousPrice: previous,
          currentPrice: price,
          dailyChangePercent: changePercent,
          allTimeHigh: price.gt(fish.allTimeHigh) ? price : fish.allTimeHigh,
          allTimeLow: price.lt(fish.allTimeLow) ? price : fish.allTimeLow,
        },
      });
      await tx.priceHistory.create({
        data: {
          fishId: id,
          price,
          previousPrice: previous,
          changePercent,
          source: 'ADMIN',
        },
      });
      return row;
    });

    await this.log(admin.id, 'SET_PRICE', 'fish', id, { price: previous }, { price, reason });
    return updated;
  }

  async adjustPricePercent(admin: User, id: string, percent: number) {
    const fish = await this.prisma.db.fish.findUnique({ where: { id } });
    if (!fish) throw new NotFoundException('Fish not found');
    const next = Number(fish.currentPrice) * (1 + percent / 100);
    return this.setPrice(admin, id, Math.round(next * 10000) / 10000, `${percent}%`);
  }

  /**
   * Schedule a smooth price move over `durationHours` (default 24).
   * percent=10 → reach +10% of current price by end of window (not instantly).
   */
  async setDailyTargets(
    admin: User,
    targets: Array<{ fishId: string; percent: number }>,
    durationHours = 24,
  ) {
    const hours = Math.min(168, Math.max(1, durationHours));
    const results = [];
    const now = new Date();
    const end = new Date(now.getTime() + hours * 60 * 60 * 1000);

    for (const t of targets) {
      if (!Number.isFinite(t.percent) || t.percent < -90 || t.percent > 500) {
        throw new BadRequestException(
          `Invalid daily target for ${t.fishId}: ${t.percent}`,
        );
      }
      const fish = await this.prisma.db.fish.findUnique({ where: { id: t.fishId } });
      if (!fish) throw new NotFoundException(`Fish not found: ${t.fishId}`);

      const price = Number(fish.currentPrice);
      const targetPrice =
        Math.round(price * (1 + t.percent / 100) * 10000) / 10000;

      if (t.percent === 0) {
        const after = await this.prisma.db.fish.update({
          where: { id: t.fishId },
          data: {
            dailyTargetPercent: 0,
            rampFromPrice: null,
            rampToPrice: null,
            rampStartAt: null,
            rampEndAt: null,
          },
        });
        await this.log(
          admin.id,
          'CLEAR_PRICE_RAMP',
          'fish',
          t.fishId,
          { dailyTargetPercent: fish.dailyTargetPercent },
          { dailyTargetPercent: 0 },
        );
        results.push({
          id: after.id,
          symbol: after.symbol,
          dailyTargetPercent: '0.0000',
          currentPrice: after.currentPrice.toFixed(4),
          rampToPrice: null,
          rampEndAt: null,
        });
        continue;
      }

      const hi = Math.max(price, targetPrice);
      const lo = Math.min(price, targetPrice);
      const nextMax = Math.max(Number(fish.maxPrice), hi * 1.25, targetPrice * 1.1);
      const nextMin = Math.min(
        Number(fish.minPrice),
        Math.max(0.001, lo * 0.75),
      );

      const after = await this.prisma.db.fish.update({
        where: { id: t.fishId },
        data: {
          dailyTargetPercent: t.percent,
          rampFromPrice: price,
          rampToPrice: targetPrice,
          rampStartAt: now,
          rampEndAt: end,
          maxPrice: nextMax,
          minPrice: nextMin,
        },
      });
      await this.log(
        admin.id,
        'SET_PRICE_RAMP',
        'fish',
        t.fishId,
        { price, dailyTargetPercent: fish.dailyTargetPercent },
        {
          percent: t.percent,
          from: price,
          to: targetPrice,
          hours,
          rampEndAt: end.toISOString(),
        },
      );
      results.push({
        id: after.id,
        symbol: after.symbol,
        dailyTargetPercent: after.dailyTargetPercent.toFixed(4),
        currentPrice: after.currentPrice.toFixed(4),
        rampFromPrice: after.rampFromPrice?.toFixed(4) ?? null,
        rampToPrice: after.rampToPrice?.toFixed(4) ?? null,
        rampEndAt: after.rampEndAt?.toISOString() ?? null,
        minPrice: after.minPrice.toFixed(4),
        maxPrice: after.maxPrice.toFixed(4),
      });
    }
    return { updated: results.length, durationHours: hours, fish: results };
  }

  async freeze(admin: User, id: string, frozen: boolean) {
    const before = await this.prisma.db.fish.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Fish not found');
    const after = await this.prisma.db.fish.update({
      where: { id },
      data: { isFrozen: frozen },
    });
    await this.log(admin.id, frozen ? 'FREEZE' : 'UNFREEZE', 'fish', id, before, after);
    return after;
  }

  async createEvent(admin: User, data: {
    name: string;
    description?: string;
    fishId?: string;
    priceMultiplier: number;
    startTime: string;
    endTime: string;
  }) {
    const event = await this.prisma.db.marketEvent.create({
      data: {
        name: data.name,
        description: data.description,
        fishId: data.fishId || null,
        priceMultiplier: data.priceMultiplier,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        createdById: admin.id,
        isActive: true,
      },
    });
    await this.log(admin.id, 'CREATE_EVENT', 'market_event', event.id, null, event);
    return event;
  }

  async listDeposits(limit = 50) {
    const rows = await this.prisma.db.deposit.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        user: { select: { id: true, username: true, telegramId: true } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      provider: d.provider,
      status: d.status,
      assetAmount: d.assetAmount.toFixed(4),
      gameCreditAmount: d.gameCreditAmount?.toFixed(4) ?? null,
      createdAt: d.createdAt.toISOString(),
      user: d.user
        ? {
            id: d.user.id,
            username: d.user.username,
            telegramId: d.user.telegramId.toString(),
          }
        : null,
    }));
  }

  async oracleStatus() {
    let ton: {
      ok: boolean;
      usdPrice?: string;
      source?: string;
      fetchedAt?: string;
      expiresAt?: string;
      error?: string;
    };
    try {
      const quote = await this.oracle.getTonUsd();
      ton = {
        ok: true,
        usdPrice: quote.usdPrice,
        source: quote.source,
        fetchedAt: quote.fetchedAt,
        expiresAt: quote.expiresAt,
      };
    } catch (e) {
      ton = {
        ok: false,
        error: e instanceof Error ? e.message : 'unavailable',
      };
    }
    const latest = await this.prisma.db.priceOracleSnapshot.findMany({
      orderBy: { fetchedAt: 'desc' },
      take: 10,
    });
    return {
      ton,
      recent: latest.map((s) => ({
        id: s.id,
        asset: s.asset,
        usdPrice: s.usdPrice.toFixed(8),
        source: s.source,
        isValid: s.isValid,
        fetchedAt: s.fetchedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    };
  }

  async listPaymentSettings() {
    return this.prisma.db.paymentProviderConfig.findMany({ orderBy: { code: 'asc' } });
  }

  async updatePaymentSettings(
    admin: User,
    code: string,
    data: {
      isEnabled?: boolean;
      feePercent?: number;
      minDeposit?: number | null;
      maxDeposit?: number | null;
    },
  ) {
    const before = await this.prisma.db.paymentProviderConfig.findUnique({
      where: { code: code as never },
    });
    if (!before) throw new NotFoundException('Provider not found');
    const after = await this.prisma.db.paymentProviderConfig.update({
      where: { code: code as never },
      data: {
        isEnabled: data.isEnabled,
        feePercent: data.feePercent,
        minDeposit: data.minDeposit === null ? null : data.minDeposit,
        maxDeposit: data.maxDeposit === null ? null : data.maxDeposit,
      },
    });
    await this.log(admin.id, 'UPDATE_PAYMENT_SETTINGS', 'payment_provider', after.id, before, after);
    return after;
  }

  async searchUsers(q?: string, limit = 200) {
    const query = q?.trim();
    const where = query
      ? {
          OR: [
            { username: { contains: query, mode: 'insensitive' as const } },
            { firstName: { contains: query, mode: 'insensitive' as const } },
            { lastName: { contains: query, mode: 'insensitive' as const } },
            ...( /^\d+$/.test(query) ? [{ telegramId: BigInt(query) }] : []),
          ],
        }
      : {};
    const [users, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        take: Math.min(Math.max(limit, 1), 500),
        orderBy: { createdAt: 'desc' },
        include: { gameBalance: true },
      }),
      this.prisma.db.user.count({ where }),
    ]);
    return {
      total,
      users: users.map((u) => this.serializeUserSummary(u)),
    };
  }

  private async userActivity(userId: string) {
    const now = Date.now();
    const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const cuts = {
      h1: now - 60 * 60 * 1000,
      h24: now - 24 * 60 * 60 * 1000,
      d7: now - 7 * 24 * 60 * 60 * 1000,
      d30: since30.getTime(),
    };
    const countIn = (rows: { createdAt: Date }[], from: number) =>
      rows.filter((row) => row.createdAt.getTime() >= from).length;

    const [
      trades,
      cases,
      deposits,
      ledgers,
      lastTrade,
      lastCase,
      lastDeposit,
      lastLedger,
    ] = await Promise.all([
      this.prisma.db.trade.findMany({
        where: { userId, createdAt: { gte: since30 } },
        select: { createdAt: true },
      }),
      this.prisma.db.caseOpening.findMany({
        where: { userId, createdAt: { gte: since30 } },
        select: { createdAt: true },
      }),
      this.prisma.db.deposit.findMany({
        where: { userId, status: 'CONFIRMED', createdAt: { gte: since30 } },
        select: { createdAt: true },
      }),
      this.prisma.db.gameBalanceLedger.findMany({
        where: { userId, createdAt: { gte: since30 } },
        select: { createdAt: true },
      }),
      this.prisma.db.trade.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.db.caseOpening.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.db.deposit.findFirst({
        where: { userId, status: 'CONFIRMED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.db.gameBalanceLedger.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const windowOf = (from: number) => ({
      trades: countIn(trades, from),
      cases: countIn(cases, from),
      deposits: countIn(deposits, from),
      ledger: countIn(ledgers, from),
    });

    const dayKeys = new Set<string>();
    for (const row of [...trades, ...cases, ...deposits]) {
      dayKeys.add(row.createdAt.toISOString().slice(0, 10));
    }

    const lastActionMs = Math.max(
      lastTrade?.createdAt.getTime() ?? 0,
      lastCase?.createdAt.getTime() ?? 0,
      lastDeposit?.createdAt.getTime() ?? 0,
      lastLedger?.createdAt.getTime() ?? 0,
    );

    return {
      windows: {
        h1: windowOf(cuts.h1),
        h24: windowOf(cuts.h24),
        d7: windowOf(cuts.d7),
        d30: windowOf(cuts.d30),
      },
      lastTradeAt: lastTrade?.createdAt.toISOString() ?? null,
      lastCaseAt: lastCase?.createdAt.toISOString() ?? null,
      lastDepositAt: lastDeposit?.createdAt.toISOString() ?? null,
      lastLedgerAt: lastLedger?.createdAt.toISOString() ?? null,
      lastActionAt: lastActionMs ? new Date(lastActionMs).toISOString() : null,
      activeDays30: dayKeys.size,
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id },
      include: {
        gameBalance: true,
        referredBy: {
          select: {
            id: true,
            username: true,
            firstName: true,
            telegramId: true,
          },
        },
        portfolioPositions: {
          include: { fish: true },
          orderBy: { updatedAt: 'desc' },
        },
        deposits: { orderBy: { createdAt: 'desc' }, take: 20 },
        ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 40 },
        trades: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { fish: { select: { symbol: true, name: true } } },
        },
        caseOpenings: {
          orderBy: { createdAt: 'desc' },
          take: 15,
          include: {
            fish: { select: { symbol: true, name: true } },
            lootCase: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      depositSum,
      openingsAgg,
      openingsCount,
      buyAgg,
      sellAgg,
      referralCount,
      activity,
    ] = await Promise.all([
      this.prisma.db.deposit.aggregate({
        where: { userId: id, status: 'CONFIRMED' },
        _sum: { gameCreditAmount: true },
        _count: true,
      }),
      this.prisma.db.caseOpening.aggregate({
        where: { userId: id },
        _sum: { pricePaid: true, fishMarketValue: true },
      }),
      this.prisma.db.caseOpening.count({ where: { userId: id } }),
      this.prisma.db.trade.aggregate({
        where: { userId: id, side: 'BUY' },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.db.trade.aggregate({
        where: { userId: id, side: 'SELL' },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.db.referral.count({ where: { referrerId: id } }),
      this.userActivity(id),
    ]);

    let portfolioValue = new Prisma.Decimal(0);
    let invested = new Prisma.Decimal(0);
    let realizedPnl = new Prisma.Decimal(0);
    const portfolioPositions = user.portfolioPositions.map((p) => {
      const value = p.fish.currentPrice.mul(p.quantity);
      portfolioValue = portfolioValue.add(value);
      invested = invested.add(p.totalInvested);
      realizedPnl = realizedPnl.add(p.realizedPnl);
      return {
        quantity: p.quantity.toFixed(4),
        avgBuyPrice: p.avgBuyPrice.toFixed(4),
        totalInvested: p.totalInvested.toFixed(4),
        realizedPnl: p.realizedPnl.toFixed(4),
        marketValue: value.toFixed(4),
        unrealizedPnl: value.sub(p.totalInvested).toFixed(4),
        fish: {
          id: p.fish.id,
          symbol: p.fish.symbol,
          name: fishDisplayName(p.fish.symbol, p.fish.name),
          rarity: p.fish.rarity,
          currentPrice: p.fish.currentPrice.toFixed(4),
        },
      };
    });

    const cash = user.gameBalance?.available ?? new Prisma.Decimal(0);
    const caseSpent = openingsAgg._sum.pricePaid ?? new Prisma.Decimal(0);
    const caseWon = openingsAgg._sum.fishMarketValue ?? new Prisma.Decimal(0);

    return {
      ...this.serializeUserSummary(user),
      lastName: user.lastName,
      languageCode: user.languageCode,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      referredAt: user.referredAt?.toISOString() ?? null,
      referralCode: user.referralCode,
      referredBy: user.referredBy
        ? {
            id: user.referredBy.id,
            username: user.referredBy.username,
            firstName: user.referredBy.firstName,
            telegramId: user.referredBy.telegramId.toString(),
          }
        : null,
      stats: {
        cash: cash.toFixed(4),
        portfolioValue: portfolioValue.toFixed(4),
        netWorth: cash.add(portfolioValue).toFixed(4),
        invested: invested.toFixed(4),
        unrealizedPnl: portfolioValue.sub(invested).toFixed(4),
        realizedPnl: realizedPnl.toFixed(4),
        depositsTotal: (
          depositSum._sum.gameCreditAmount ?? new Prisma.Decimal(0)
        ).toFixed(4),
        depositsCount: depositSum._count,
        buyVolume: (buyAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(4),
        sellVolume: (sellAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(
          4,
        ),
        buyCount: buyAgg._count,
        sellCount: sellAgg._count,
        caseOpenings: openingsCount,
        caseOpenings24h: activity.windows.h24.cases,
        caseSpent: caseSpent.toFixed(4),
        caseWonValue: caseWon.toFixed(4),
        casePnl: caseWon.sub(caseSpent).toFixed(4),
        referralsCount: referralCount,
        trades24h: activity.windows.h24.trades,
        lastTradeAt: activity.lastTradeAt,
        lastCaseAt: activity.lastCaseAt,
        lastDepositAt: activity.lastDepositAt,
        lastLedgerAt: activity.lastLedgerAt,
        lastActionAt: activity.lastActionAt,
        activeDays30: activity.activeDays30,
        windows: activity.windows,
      },
      portfolioPositions,
      deposits: user.deposits.map((d) => ({
        id: d.id,
        provider: d.provider,
        status: d.status,
        assetAmount: d.assetAmount.toFixed(4),
        gameCreditAmount: d.gameCreditAmount?.toFixed(4) ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      ledgerEntries: user.ledgerEntries.map((e) => ({
        type: e.type,
        amount: e.amount.toFixed(4),
        balanceAfter: e.balanceAfter.toFixed(4),
        createdAt: e.createdAt.toISOString(),
      })),
      trades: user.trades.map((t) => ({
        side: t.side,
        quantity: t.quantity.toFixed(4),
        unitPrice: t.unitPrice.toFixed(4),
        totalAmount: t.totalAmount.toFixed(4),
        createdAt: t.createdAt.toISOString(),
        fish: {
          symbol: t.fish.symbol,
          name: fishDisplayName(t.fish.symbol, t.fish.name),
        },
      })),
      openings: user.caseOpenings.map((o) => ({
        id: o.id,
        quantity: o.quantity,
        pricePaid: o.pricePaid.toFixed(4),
        fishMarketValue: o.fishMarketValue.toFixed(4),
        createdAt: o.createdAt.toISOString(),
        case: {
          code: o.lootCase.code,
          name: caseDisplayName(o.lootCase.code, o.lootCase.name),
        },
        fish: {
          symbol: o.fish.symbol,
          name: fishDisplayName(o.fish.symbol, o.fish.name),
        },
      })),
    };
  }

  private serializeUserSummary(u: {
    id: string;
    telegramId: bigint;
    username: string | null;
    firstName: string | null;
    status: string;
    isAdmin: boolean;
    createdAt?: Date;
    lastSeenAt?: Date | null;
    gameBalance?: { available: Prisma.Decimal } | null;
  }) {
    return {
      id: u.id,
      telegramId: u.telegramId.toString(),
      username: u.username,
      firstName: u.firstName,
      status: u.status,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt?.toISOString?.() ?? undefined,
      lastSeenAt: u.lastSeenAt?.toISOString?.() ?? null,
      gameBalance: u.gameBalance
        ? { available: u.gameBalance.available.toFixed(4) }
        : null,
    };
  }

  async adjustBalance(admin: User, userId: string, amount: number, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Reason required');
    if (amount === 0) throw new BadRequestException('Amount cannot be zero');

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const abs = Math.abs(amount);
    const key = `admin:adjust:${userId}:${randomUUID()}`;

    if (amount > 0) {
      await this.ledger.credit({
        userId,
        type: 'ADMIN_ADJUSTMENT',
        amount: abs,
        idempotencyKey: key,
        referenceType: 'admin_action',
        metadata: { reason, adminId: admin.id, mode: 'delta' },
      });
    } else {
      await this.ledger.debit({
        userId,
        type: 'ADMIN_ADJUSTMENT',
        amount: abs,
        idempotencyKey: key,
        referenceType: 'admin_action',
        metadata: { reason, adminId: admin.id, mode: 'delta' },
      });
    }

    await this.log(admin.id, 'ADJUST_BALANCE', 'user', userId, null, { amount, reason });
    return this.getUser(userId);
  }

  /** Set absolute game-credit balance (credits or debits the delta). */
  async setBalance(admin: User, userId: string, balance: number, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Reason required');
    if (!Number.isFinite(balance) || balance < 0) {
      throw new BadRequestException('Balance must be a non-negative number');
    }

    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { gameBalance: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const current = Number(user.gameBalance?.available ?? 0);
    const target = Math.round(balance * 10000) / 10000;
    const delta = Math.round((target - current) * 10000) / 10000;
    if (delta === 0) return this.getUser(userId);

    const key = `admin:set-balance:${userId}:${randomUUID()}`;
    if (delta > 0) {
      await this.ledger.credit({
        userId,
        type: 'ADMIN_ADJUSTMENT',
        amount: delta,
        idempotencyKey: key,
        referenceType: 'admin_action',
        metadata: {
          reason,
          adminId: admin.id,
          mode: 'set',
          from: current,
          to: target,
        },
      });
    } else {
      await this.ledger.debit({
        userId,
        type: 'ADMIN_ADJUSTMENT',
        amount: Math.abs(delta),
        idempotencyKey: key,
        referenceType: 'admin_action',
        metadata: {
          reason,
          adminId: admin.id,
          mode: 'set',
          from: current,
          to: target,
        },
      });
    }

    await this.log(admin.id, 'SET_BALANCE', 'user', userId, { balance: current }, {
      balance: target,
      delta,
      reason,
    });
    return this.getUser(userId);
  }

  async giftFish(
    admin: User,
    userId: string,
    fishId: string,
    quantity: number,
    reason: string,
  ) {
    if (!reason?.trim()) throw new BadRequestException('Reason required');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const fish = await this.prisma.db.fish.findUnique({ where: { id: fishId } });
    if (!fish) throw new NotFoundException('Fish not found');

    const qty = new Prisma.Decimal(quantity);
    const marketValue = fish.currentPrice.mul(qty);

    await this.prisma.db.$transaction(async (tx) => {
      const position = await tx.portfolioPosition.findUnique({
        where: { userId_fishId: { userId, fishId } },
      });
      if (position) {
        const newQty = position.quantity.add(qty);
        await tx.portfolioPosition.update({
          where: { id: position.id },
          data: {
            quantity: newQty,
            avgBuyPrice: newQty.gt(0)
              ? position.totalInvested.div(newQty)
              : new Prisma.Decimal(0),
          },
        });
      } else {
        await tx.portfolioPosition.create({
          data: {
            userId,
            fishId,
            quantity: qty,
            avgBuyPrice: new Prisma.Decimal(0),
            totalInvested: new Prisma.Decimal(0),
          },
        });
      }
      const take = Math.max(0, Math.min(fish.availableSupply, Math.ceil(quantity)));
      if (take > 0) {
        await tx.fish.update({
          where: { id: fishId },
          data: { availableSupply: { decrement: take } },
        });
      }
    });

    await this.log(admin.id, 'GIFT_FISH', 'user', userId, null, {
      fishId,
      symbol: fish.symbol,
      quantity,
      marketValue: marketValue.toFixed(4),
      reason,
    });
    return this.getUser(userId);
  }

  async setBan(admin: User, userId: string, banned: boolean, reason?: string) {
    const before = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!before) throw new NotFoundException('User not found');
    const after = await this.prisma.db.user.update({
      where: { id: userId },
      data: { status: banned ? 'BANNED' : 'ACTIVE' },
    });
    await this.log(admin.id, banned ? 'BAN' : 'UNBAN', 'user', userId, before, { after, reason });
    return after;
  }

  async listAudit(limit = 50, actionType?: string) {
    const rows = await this.prisma.db.adminAction.findMany({
      where: actionType ? { actionType } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        adminUser: {
          select: {
            id: true,
            username: true,
            firstName: true,
            telegramId: true,
          },
        },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      entityType: a.entityType,
      entityId: a.entityId,
      createdAt: a.createdAt.toISOString(),
      afterState: a.afterState,
      adminUser: a.adminUser
        ? {
            username: a.adminUser.username,
            firstName: a.adminUser.firstName,
            telegramId: a.adminUser.telegramId.toString(),
          }
        : null,
    }));
  }

  async listEvents(limit = 30) {
    const rows = await this.prisma.db.marketEvent.findMany({
      orderBy: { startTime: 'desc' },
      take: Math.min(limit, 100),
      include: {
        fish: { select: { id: true, symbol: true, name: true } },
      },
    });
    return rows.map((ev) => ({
      ...ev,
      fish: ev.fish
        ? {
            ...ev.fish,
            name: fishDisplayName(ev.fish.symbol, ev.fish.name),
          }
        : null,
    }));
  }

  async setEventActive(admin: User, id: string, isActive: boolean) {
    const before = await this.prisma.db.marketEvent.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Event not found');
    const after = await this.prisma.db.marketEvent.update({
      where: { id },
      data: { isActive },
      include: { fish: { select: { id: true, symbol: true, name: true } } },
    });
    await this.log(
      admin.id,
      isActive ? 'ACTIVATE_EVENT' : 'DEACTIVATE_EVENT',
      'market_event',
      id,
      before,
      after,
    );
    return after;
  }

  async casinoStats() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [cases, openingsTotal, openings24h, spendAgg, spend24h] =
      await Promise.all([
        this.prisma.db.lootCase.findMany({
          orderBy: { sortOrder: 'asc' },
          include: { _count: { select: { openings: true } } },
        }),
        this.prisma.db.caseOpening.count(),
        this.prisma.db.caseOpening.count({
          where: { createdAt: { gte: since24h } },
        }),
        this.prisma.db.caseOpening.aggregate({
          _sum: { pricePaid: true, fishMarketValue: true },
        }),
        this.prisma.db.caseOpening.aggregate({
          where: { createdAt: { gte: since24h } },
          _sum: { pricePaid: true, fishMarketValue: true },
        }),
      ]);

    const recent = await this.prisma.db.caseOpening.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        user: { select: { username: true, telegramId: true, firstName: true } },
        lootCase: { select: { code: true, name: true } },
        fish: { select: { symbol: true, name: true } },
      },
    });

    return {
      openingsTotal,
      openings24h,
      spentTotal: (spendAgg._sum.pricePaid ?? new Prisma.Decimal(0)).toFixed(4),
      valueTotal: (
        spendAgg._sum.fishMarketValue ?? new Prisma.Decimal(0)
      ).toFixed(4),
      spent24h: (spend24h._sum.pricePaid ?? new Prisma.Decimal(0)).toFixed(4),
      value24h: (
        spend24h._sum.fishMarketValue ?? new Prisma.Decimal(0)
      ).toFixed(4),
      cases: cases.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        displayName: caseDisplayName(c.code, c.name),
        priceCredits: c.priceCredits.toFixed(4),
        edgePercent: c.edgePercent.toFixed(2),
        isActive: c.isActive,
        openings: c._count.openings,
      })),
      recent: recent.map((o) => ({
        id: o.id,
        case: caseDisplayName(o.lootCase.code, o.lootCase.name),
        caseCode: o.lootCase.code,
        fish: fishDisplayName(o.fish.symbol, o.fish.name),
        fishSymbol: o.fish.symbol,
        paid: o.pricePaid.toFixed(4),
        value: o.fishMarketValue.toFixed(4),
        user: o.user.username || o.user.firstName || String(o.user.telegramId),
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  async securityOverview() {
    const [banned, admins, actions24h, users24h] = await Promise.all([
      this.prisma.db.user.count({ where: { status: 'BANNED' } }),
      this.prisma.db.user.count({ where: { isAdmin: true } }),
      this.prisma.db.adminAction.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.db.user.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);
    const secretConfigured = getAdminConfiguredSecret().length >= 8;
    const cors = (process.env.CORS_ORIGINS || '').trim();
    return {
      bannedUsers: banned,
      adminUsers: admins,
      adminActions24h: actions24h,
      newUsers24h: users24h,
      adminSecretConfigured: secretConfigured,
      corsConfigured: Boolean(cors && cors !== '*'),
      telegramBotConfigured: Boolean(
        process.env.TELEGRAM_BOT_TOKEN &&
          process.env.TELEGRAM_BOT_TOKEN !== 'your_bot_token_here',
      ),
      rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 120),
      sessionAuthEnabled: true,
    };
  }

  async broadcastAudience() {
    const recipients = await this.prisma.db.user.count({
      where: { status: 'ACTIVE' },
    });
    return {
      recipients,
      botConfigured: this.tg.tokenConfigured(),
    };
  }

  async broadcast(
    admin: User,
    data: {
      message?: string;
      photoBase64?: string;
      photoFilename?: string;
      test?: boolean;
    },
  ) {
    if (!this.tg.tokenConfigured()) {
      throw new BadRequestException('Бот не настроен: нет TELEGRAM_BOT_TOKEN');
    }

    const message = (data.message || '').trim();
    const photoRaw = (data.photoBase64 || '').replace(/\s/g, '');
    if (!message && !photoRaw) {
      throw new BadRequestException('Введите текст или прикрепите фото');
    }
    if (message.length > TEXT_MAX) {
      throw new BadRequestException(`Текст длиннее ${TEXT_MAX} символов`);
    }

    let photoBuffer: Buffer | undefined;
    let photoMime: string | undefined;
    let photoFilename = data.photoFilename?.trim() || 'photo.jpg';
    if (photoRaw) {
      let decoded: Buffer;
      try {
        decoded = Buffer.from(photoRaw, 'base64');
      } catch {
        throw new BadRequestException('Не удалось прочитать фото');
      }
      if (!decoded.length || decoded.length > PHOTO_MAX_BYTES) {
        throw new BadRequestException('Фото должно быть до 5 МБ');
      }
      const kind = sniffImage(decoded);
      if (!kind) {
        throw new BadRequestException('Нужен JPEG, PNG, WEBP или GIF');
      }
      photoBuffer = decoded;
      photoMime = kind.mime;
      if (!/\.(jpe?g|png|webp|gif)$/i.test(photoFilename)) {
        photoFilename = `photo.${kind.ext}`;
      }
    }

    const caption = photoBuffer
      ? message.slice(0, CAPTION_MAX) || undefined
      : undefined;
    const textOnly = photoBuffer ? undefined : message;

    let recipients: Array<{ telegramId: bigint }>;
    if (data.test) {
      recipients = [{ telegramId: admin.telegramId }];
    } else {
      recipients = await this.prisma.db.user.findMany({
        where: { status: 'ACTIVE' },
        select: { telegramId: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!recipients.length) {
      throw new BadRequestException('Нет получателей');
    }

    let sent = 0;
    let blocked = 0;
    let failed = 0;
    let fileId: string | undefined;

    for (const user of recipients) {
      let result = photoBuffer
        ? await this.tg.sendBroadcastPhoto(
            user.telegramId,
            fileId
              ? { fileId }
              : {
                  buffer: photoBuffer,
                  filename: photoFilename,
                  mime: photoMime,
                },
            caption,
          )
        : await this.tg.sendBroadcastText(user.telegramId, textOnly || '');

      if (result.retryAfter) {
        await sleep((result.retryAfter + 0.4) * 1000);
        result = photoBuffer
          ? await this.tg.sendBroadcastPhoto(
              user.telegramId,
              fileId ? { fileId } : { buffer: photoBuffer, filename: photoFilename, mime: photoMime },
              caption,
            )
          : await this.tg.sendBroadcastText(user.telegramId, textOnly || '');
      }

      if (result.ok) {
        sent += 1;
        if (result.fileId) fileId = result.fileId;
      } else if (isBlockedError(result.error)) {
        blocked += 1;
      } else {
        failed += 1;
      }

      await sleep(40);
    }

    await this.log(admin.id, 'BROADCAST', 'telegram', 'all', null, {
      test: Boolean(data.test),
      hasPhoto: Boolean(photoBuffer),
      messageChars: message.length,
      recipients: recipients.length,
      sent,
      blocked,
      failed,
    });

    return {
      recipients: recipients.length,
      sent,
      blocked,
      failed,
      test: Boolean(data.test),
      hasPhoto: Boolean(photoBuffer),
    };
  }

  private async log(
    adminUserId: string,
    actionType: string,
    entityType: string,
    entityId: string,
    beforeState: unknown,
    afterState: unknown,
  ) {
    await this.prisma.db.adminAction.create({
      data: {
        adminUserId,
        actionType,
        entityType,
        entityId,
        beforeState: beforeState as never,
        afterState: afterState as never,
      },
    });
  }
}
