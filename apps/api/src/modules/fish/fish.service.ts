import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';
import { fishDisplayName } from './fish-names';

@Injectable()
export class FishService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const fish = await this.prisma.db.fish.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { symbol: 'asc' }],
    });

    return fish.map((f) => this.serialize(f));
  }

  async getById(id: string) {
    const fish = await this.prisma.db.fish.findFirst({
      where: { OR: [{ id }, { symbol: id.toUpperCase() }], isActive: true },
    });
    if (!fish) throw new NotFoundException('Fish not found');
    return this.serialize(fish);
  }

  async getHistory(id: string, limit = 100) {
    const fish = await this.prisma.db.fish.findFirst({
      where: { OR: [{ id }, { symbol: id.toUpperCase() }] },
    });
    if (!fish) throw new NotFoundException('Fish not found');

    const history = await this.prisma.db.priceHistory.findMany({
      where: { fishId: fish.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });

    return {
      fishId: fish.id,
      symbol: fish.symbol,
      history: history.map((h) => ({
        id: h.id,
        price: h.price.toFixed(4),
        previousPrice: h.previousPrice.toFixed(4),
        changePercent: h.changePercent.toFixed(4),
        source: h.source,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  serialize(f: {
    id: string;
    symbol: string;
    name: string;
    description: string | null;
    rarity: string;
    currentPrice: Prisma.Decimal;
    previousPrice: Prisma.Decimal;
    dailyChangePercent: Prisma.Decimal;
    allTimeHigh: Prisma.Decimal;
    allTimeLow: Prisma.Decimal;
    volatility: Prisma.Decimal;
    trend: Prisma.Decimal;
    momentum: Prisma.Decimal;
    totalSupply: number;
    availableSupply: number;
    isFrozen: boolean;
    imageUrl: string | null;
    sortOrder: number;
  }) {
    return {
      id: f.id,
      symbol: f.symbol,
      name: fishDisplayName(f.symbol, f.name),
      description: f.description,
      rarity: f.rarity,
      currentPrice: f.currentPrice.toFixed(4),
      previousPrice: f.previousPrice.toFixed(4),
      dailyChangePercent: f.dailyChangePercent.toFixed(4),
      allTimeHigh: f.allTimeHigh.toFixed(4),
      allTimeLow: f.allTimeLow.toFixed(4),
      volatility: f.volatility.toFixed(6),
      trend: f.trend.toFixed(6),
      momentum: f.momentum.toFixed(6),
      totalSupply: f.totalSupply,
      availableSupply: f.availableSupply,
      isFrozen: f.isFrozen,
      imageUrl: f.imageUrl || `/fish/${f.symbol}.jpg`,
      sortOrder: f.sortOrder,
    };
  }
}
