import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  async getPortfolio(userId: string) {
    const [positions, balance] = await Promise.all([
      this.prisma.db.portfolioPosition.findMany({
        where: { userId },
        include: { fish: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.db.gameBalance.findUnique({ where: { userId } }),
    ]);

    let totalInvested = new Prisma.Decimal(0);
    let currentValue = new Prisma.Decimal(0);
    let realizedPnl = new Prisma.Decimal(0);

    const items = positions.map((p) => {
      const value = p.fish.currentPrice.mul(p.quantity);
      const unrealized = value.sub(p.totalInvested);
      const pct = p.totalInvested.gt(0)
        ? unrealized.div(p.totalInvested).mul(100)
        : new Prisma.Decimal(0);

      totalInvested = totalInvested.add(p.totalInvested);
      currentValue = currentValue.add(value);
      realizedPnl = realizedPnl.add(p.realizedPnl);

      return {
        fishId: p.fishId,
        symbol: p.fish.symbol,
        name: p.fish.name,
        rarity: p.fish.rarity,
        imageUrl: p.fish.imageUrl || `/fish/${p.fish.symbol}.jpg`,
        quantity: p.quantity.toFixed(4),
        avgBuyPrice: p.avgBuyPrice.toFixed(4),
        currentPrice: p.fish.currentPrice.toFixed(4),
        totalInvested: p.totalInvested.toFixed(4),
        currentValue: value.toFixed(4),
        unrealizedPnl: unrealized.toFixed(4),
        unrealizedPnlPercent: pct.toFixed(4),
        realizedPnl: p.realizedPnl.toFixed(4),
      };
    });

    const unrealizedPnl = currentValue.sub(totalInvested);
    const unrealizedPct = totalInvested.gt(0)
      ? unrealizedPnl.div(totalInvested).mul(100)
      : new Prisma.Decimal(0);

    return {
      balance: (balance?.available ?? new Prisma.Decimal(0)).toFixed(4),
      totalInvested: totalInvested.toFixed(4),
      currentValue: currentValue.toFixed(4),
      unrealizedPnl: unrealizedPnl.toFixed(4),
      unrealizedPnlPercent: unrealizedPct.toFixed(4),
      realizedPnl: realizedPnl.toFixed(4),
      positions: items,
    };
  }

  async getPosition(userId: string, fishId: string) {
    const portfolio = await this.getPortfolio(userId);
    const position = portfolio.positions.find(
      (p) => p.fishId === fishId || p.symbol === fishId.toUpperCase(),
    );
    if (!position) throw new NotFoundException('Position not found');
    return position;
  }
}
