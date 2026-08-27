import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';
import { fishDisplayName } from '../fish/fish-names';

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  async getPortfolio(userId: string) {
    const [positions, balance, jointMembers] = await Promise.all([
      this.prisma.db.portfolioPosition.findMany({
        where: { userId },
        include: { fish: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.db.gameBalance.findUnique({ where: { userId } }),
      this.prisma.db.jointHoldingMember.findMany({
        where: { userId },
        include: {
          holding: {
            include: {
              fish: true,
              members: {
                include: {
                  user: {
                    select: { id: true, username: true, firstName: true },
                  },
                },
              },
            },
          },
        },
      }),
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
        name: fishDisplayName(p.fish.symbol, p.fish.name),
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
        joint: false as const,
        jointHoldingId: null as string | null,
        partner: null as null,
      };
    });

    const jointItems = jointMembers.map((m) => {
      const h = m.holding;
      const value = h.fish.currentPrice.mul(m.quantity);
      const unrealized = value.sub(m.totalInvested);
      const pct = m.totalInvested.gt(0)
        ? unrealized.div(m.totalInvested).mul(100)
        : new Prisma.Decimal(0);
      const partner = h.members.find((x) => x.userId !== userId);

      totalInvested = totalInvested.add(m.totalInvested);
      currentValue = currentValue.add(value);

      return {
        fishId: h.fishId,
        symbol: h.fish.symbol,
        name: fishDisplayName(h.fish.symbol, h.fish.name),
        rarity: h.fish.rarity,
        imageUrl: h.fish.imageUrl || `/fish/${h.fish.symbol}.jpg`,
        quantity: m.quantity.toFixed(4),
        avgBuyPrice: h.avgBuyPrice.toFixed(4),
        currentPrice: h.fish.currentPrice.toFixed(4),
        totalInvested: m.totalInvested.toFixed(4),
        currentValue: value.toFixed(4),
        unrealizedPnl: unrealized.toFixed(4),
        unrealizedPnlPercent: pct.toFixed(4),
        realizedPnl: '0.0000',
        joint: true as const,
        jointHoldingId: h.id,
        partner: partner
          ? {
              id: partner.user.id,
              username: partner.user.username,
              firstName: partner.user.firstName,
            }
          : null,
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
      positions: [...jointItems, ...items],
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
