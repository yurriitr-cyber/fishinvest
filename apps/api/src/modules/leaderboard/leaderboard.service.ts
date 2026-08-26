import { Injectable } from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getTop(limit = 50, currentUserId?: string) {
    const positions = await this.prisma.db.portfolioPosition.findMany({
      include: {
        fish: { select: { currentPrice: true } },
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
          },
        },
      },
    });

    const byUser = new Map<
      string,
      {
        userId: string;
        username: string | null;
        firstName: string | null;
        portfolioValue: Prisma.Decimal;
        totalInvested: Prisma.Decimal;
        realizedPnl: Prisma.Decimal;
      }
    >();

    for (const p of positions) {
      const value = p.fish.currentPrice.mul(p.quantity);
      const existing = byUser.get(p.userId);
      if (existing) {
        existing.portfolioValue = existing.portfolioValue.add(value);
        existing.totalInvested = existing.totalInvested.add(p.totalInvested);
        existing.realizedPnl = existing.realizedPnl.add(p.realizedPnl);
      } else {
        byUser.set(p.userId, {
          userId: p.userId,
          username: p.user.username,
          firstName: p.user.firstName,
          portfolioValue: value,
          totalInvested: p.totalInvested,
          realizedPnl: p.realizedPnl,
        });
      }
    }

    const ranked = [...byUser.values()]
      .map((u) => {
        const unrealized = u.portfolioValue.sub(u.totalInvested);
        const totalPnl = unrealized.add(u.realizedPnl);
        const pct = u.totalInvested.gt(0)
          ? totalPnl.div(u.totalInvested).mul(100)
          : new Prisma.Decimal(0);
        return {
          userId: u.userId,
          displayName: u.username || u.firstName || 'Anonymous',
          portfolioValue: u.portfolioValue,
          totalProfit: totalPnl,
          profitPercent: pct,
        };
      })
      .sort((a, b) => b.portfolioValue.comparedTo(a.portfolioValue));

    const top = ranked.slice(0, Math.min(limit, 100)).map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName: r.displayName,
      portfolioValue: r.portfolioValue.toFixed(4),
      totalProfit: r.totalProfit.toFixed(4),
      profitPercent: r.profitPercent.toFixed(4),
      isYou: r.userId === currentUserId,
    }));

    let you = null;
    if (currentUserId) {
      const idx = ranked.findIndex((r) => r.userId === currentUserId);
      if (idx >= 0) {
        const r = ranked[idx];
        you = {
          rank: idx + 1,
          userId: r.userId,
          displayName: r.displayName,
          portfolioValue: r.portfolioValue.toFixed(4),
          totalProfit: r.totalProfit.toFixed(4),
          profitPercent: r.profitPercent.toFixed(4),
          isYou: true,
        };
      }
    }

    return { leaders: top, you };
  }
}
