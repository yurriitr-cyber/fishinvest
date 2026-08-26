import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, User } from '@rare-fish/db';
import { randomUUID } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { OracleService } from '../oracle/oracle.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly oracle: OracleService,
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
        name: f.name,
        price: f.currentPrice.toFixed(4),
        change: f.dailyChangePercent.toFixed(4),
        frozen: f.isFrozen,
      })),
      topUsers,
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
        name: f.name,
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
    return this.prisma.db.deposit.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        user: { select: { id: true, username: true, telegramId: true } },
      },
    });
  }

  async oracleStatus() {
    let ton = null;
    try {
      ton = await this.oracle.getTonUsd();
    } catch (e) {
      ton = { error: e instanceof Error ? e.message : 'unavailable' };
    }
    const latest = await this.prisma.db.priceOracleSnapshot.findMany({
      orderBy: { fetchedAt: 'desc' },
      take: 10,
    });
    return { ton, recent: latest };
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

  async searchUsers(q?: string, limit = 50) {
    const where = q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' as const } },
            { firstName: { contains: q, mode: 'insensitive' as const } },
            ...( /^\d+$/.test(q) ? [{ telegramId: BigInt(q) }] : []),
          ],
        }
      : {};
    return this.prisma.db.user.findMany({
      where,
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
      include: { gameBalance: true },
    });
  }

  async getUser(id: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id },
      include: {
        gameBalance: true,
        portfolioPositions: { include: { fish: true } },
        deposits: { orderBy: { createdAt: 'desc' }, take: 20 },
        ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 30 },
        trades: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
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
