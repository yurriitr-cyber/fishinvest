import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

function parseIntervalMs(value: string | undefined): number {
  const v = (value || '3s').trim().toLowerCase();
  const match = v.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 3000;
  const n = Number(match[1]);
  switch (match[2]) {
    case 's':
      return Math.max(1000, n * 1000);
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      return 3000;
  }
}

/** Absolute $ move per tick — big fish ~$1–2, cheap fish cents. */
function tickStep(price: number): number {
  if (price >= 200) return 0.9 + Math.random() * 1.4;
  if (price >= 80) return 0.5 + Math.random() * 1.2;
  if (price >= 20) return 0.12 + Math.random() * 0.7;
  if (price >= 5) return 0.03 + Math.random() * 0.15;
  return 0.005 + Math.random() * 0.04;
}

@Injectable()
export class PriceEngineService implements OnModuleInit, OnModuleDestroy {
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

    // First tick soon so charts have history
    setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error('Price tick failed', err?.stack || err),
      );
    }, 1500);

    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error('Price tick failed', err?.stack || err),
      );
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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
  }

  private async updateFishPrice(
    fish: {
      id: string;
      currentPrice: Prisma.Decimal;
      previousPrice: Prisma.Decimal;
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
    const current = Number(fish.currentPrice);
    const previous = Number(fish.previousPrice);
    const trend = Number(fish.trend);
    const momentum = Number(fish.momentum);
    const vol = Number(fish.volatility);

    // Mean-reversion toward recent level + small trend drift
    const anchor = previous || current;
    const pull = (anchor - current) * 0.18;
    const drift = current * trend * 0.002;
    const step = tickStep(current) * (0.6 + vol);
    const noise = (Math.random() * 2 - 1) * step;

    let delta = pull + drift + noise + momentum * current * 0.05;

    if (eventMultiplier) {
      delta += current * (Number(eventMultiplier) - 1) * 0.04;
    }

    // Cap single-tick move relative to price (keeps chart readable)
    const maxAbs = Math.max(step * 1.8, current * 0.04);
    delta = Math.max(-maxAbs, Math.min(maxAbs, delta));

    let newPrice = current + delta;
    newPrice = Math.max(Number(fish.minPrice), Math.min(Number(fish.maxPrice), newPrice));
    newPrice = Math.round(newPrice * 10000) / 10000;

    const prevDec = fish.currentPrice;
    const price = new Prisma.Decimal(newPrice);
    const changePercent = prevDec.gt(0)
      ? price.sub(prevDec).div(prevDec).mul(100)
      : new Prisma.Decimal(0);

    const newMomentum = new Prisma.Decimal(
      Math.max(
        -0.2,
        Math.min(0.2, momentum * 0.65 + (delta / Math.max(current, 0.01)) * 0.35),
      ),
    );

    await this.prisma.db.$transaction(async (tx) => {
      await tx.fish.update({
        where: { id: fish.id },
        data: {
          previousPrice: prevDec,
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
          previousPrice: prevDec,
          changePercent,
          source: eventMultiplier ? 'EVENT' : 'AUTOMATIC',
          marketEventId: marketEventId ?? null,
        },
      });
    });
  }
}
