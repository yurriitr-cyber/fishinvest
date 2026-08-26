import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

function parseIntervalMs(value: string | undefined): number {
  const v = (value || '1h').trim().toLowerCase();
  const match = v.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60 * 60 * 1000;
  const n = Number(match[1]);
  switch (match[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

@Injectable()
export class PriceEngineService implements OnModuleInit {
  private readonly logger = new Logger(PriceEngineService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = parseIntervalMs(
      this.config.get<string>('PRICE_UPDATE_INTERVAL'),
    );
    this.logger.log(`Price engine interval: ${intervalMs}ms`);
    // Delay first tick slightly so DB is ready
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error('Price tick failed', err?.stack || err),
      );
    }, intervalMs);
  }

  async tick() {
    const fishList = await this.prisma.db.fish.findMany({
      where: { isActive: true, isFrozen: false },
    });

    const now = new Date();
    const events = await this.prisma.db.marketEvent.findMany({
      where: {
        isActive: true,
        startTime: { lte: now },
        endTime: { gte: now },
      },
    });

    for (const fish of fishList) {
      const event = events.find((e) => !e.fishId || e.fishId === fish.id);
      await this.updateFishPrice(fish, event?.priceMultiplier ?? null, event?.id);
    }

    this.logger.debug(`Updated ${fishList.length} fish prices`);
  }

  private async updateFishPrice(
    fish: {
      id: string;
      currentPrice: Prisma.Decimal;
      volatility: Prisma.Decimal;
      trend: Prisma.Decimal;
      momentum: Prisma.Decimal;
      minPrice: Prisma.Decimal;
      maxPrice: Prisma.Decimal;
      allTimeHigh: Prisma.Decimal;
      allTimeLow: Prisma.Decimal;
    },
    eventMultiplier: Prisma.Decimal | null,
    marketEventId?: string,
  ) {
    const vol = Number(fish.volatility);
    const trend = Number(fish.trend);
    const momentum = Number(fish.momentum);
    const noise = (Math.random() * 2 - 1) * vol;
    let marketChange = trend + momentum * 0.3 + noise;

    if (eventMultiplier) {
      // Blend event into one tick rather than applying full multiplier every tick
      const eventBump = Number(eventMultiplier) - 1;
      marketChange += eventBump * 0.15;
    }

    // Clamp extreme single-tick moves
    marketChange = Math.max(-0.35, Math.min(0.35, marketChange));

    let newPrice = Number(fish.currentPrice) * (1 + marketChange);
    newPrice = Math.max(Number(fish.minPrice), Math.min(Number(fish.maxPrice), newPrice));
    newPrice = Math.round(newPrice * 10000) / 10000;

    const previous = fish.currentPrice;
    const price = new Prisma.Decimal(newPrice);
    const changePercent = previous.gt(0)
      ? price.sub(previous).div(previous).mul(100)
      : new Prisma.Decimal(0);

    const newMomentum = new Prisma.Decimal(
      Math.max(-0.2, Math.min(0.2, momentum * 0.7 + marketChange * 0.3)),
    );

    await this.prisma.db.$transaction(async (tx) => {
      await tx.fish.update({
        where: { id: fish.id },
        data: {
          previousPrice: previous,
          currentPrice: price,
          dailyChangePercent: changePercent,
          momentum: newMomentum,
          allTimeHigh: price.gt(fish.allTimeHigh) ? price : fish.allTimeHigh,
          allTimeLow: price.lt(fish.allTimeLow) ? price : fish.allTimeLow,
        },
      });

      await tx.priceHistory.create({
        data: {
          fishId: fish.id,
          price,
          previousPrice: previous,
          changePercent,
          source: eventMultiplier ? 'EVENT' : 'AUTOMATIC',
          marketEventId: marketEventId ?? null,
        },
      });
    });
  }
}
