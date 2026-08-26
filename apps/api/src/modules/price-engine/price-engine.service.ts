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

/**
 * Absolute move per tick. Cheap / high-vol fish swing hard (as %);
 * expensive / low-vol fish stay nearly flat.
 */
function tickStep(price: number, volatility: number): number {
  const vol = Math.max(0.01, volatility);
  // Relative swing: vol 0.42 → ~3–6% ticks; vol 0.02 → ~0.1–0.3%
  const pct = vol * (0.06 + Math.random() * 0.08);
  const abs = price * pct;
  // Floor so ultra-cheap fish still visibly jitter on chart
  const floor = price < 0.1 ? 0.0005 : price < 1 ? 0.002 : 0.01;
  return Math.max(floor, abs);
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

    // Mean-reversion is weaker for high-vol (chaotic) fish
    const anchor = previous || current;
    const pullStrength = Math.max(0.04, 0.22 - vol * 0.35);
    const pull = (anchor - current) * pullStrength;
    const drift = current * trend * 0.0015;
    const step = tickStep(current, vol);
    const noise = (Math.random() * 2 - 1) * step;

    let delta = pull + drift + noise + momentum * current * 0.04;

    if (eventMultiplier) {
      delta += current * (Number(eventMultiplier) - 1) * 0.03;
    }

    // Cap: high vol can move more %; mythic stays tight
    const maxPct = Math.min(0.12, Math.max(0.008, vol * 0.25));
    const maxAbs = Math.max(step * 1.5, current * maxPct);
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
