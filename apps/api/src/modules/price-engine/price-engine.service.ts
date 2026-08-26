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
  const pct = vol * (0.06 + Math.random() * 0.08);
  const abs = price * pct;
  const floor = price < 0.1 ? 0.0005 : price < 1 ? 0.002 : 0.01;
  return Math.max(floor, abs);
}

@Injectable()
export class PriceEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceEngineService.name);
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = 3000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.intervalMs = parseIntervalMs(
      this.config.get<string>('PRICE_UPDATE_INTERVAL'),
    );
    this.logger.log(`Price engine interval: ${this.intervalMs}ms`);

    setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error('Price tick failed', err?.stack || err),
      );
    }, 1500);

    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error('Price tick failed', err?.stack || err),
      );
    }, this.intervalMs);
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
      dailyTargetPercent: Prisma.Decimal;
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
    const dailyTarget = Number(fish.dailyTargetPercent);

    const ticksPerDay = Math.max(1, (24 * 60 * 60 * 1000) / this.intervalMs);
    // Linear approx: +15%/day → each tick adds ~15%/ticksPerDay of price
    const targetDrift = current * (dailyTarget / 100) / ticksPerDay;
    const legacyDrift = current * trend * 0.0015;

    // Mean-reversion fights sustained targets — soften when target is set
    const anchor = previous || current;
    const pullStrength =
      Math.abs(dailyTarget) >= 0.5
        ? 0.04
        : Math.max(0.04, 0.22 - vol * 0.35);
    const pull = (anchor - current) * pullStrength;
    const step = tickStep(current, vol);
    // When admin set a daily path, damp noise so the path stays readable
    const noiseScale = Math.abs(dailyTarget) >= 0.5 ? 0.35 : 1;
    const noise = (Math.random() * 2 - 1) * step * noiseScale;

    let delta =
      pull + targetDrift + legacyDrift + noise + momentum * current * 0.04;

    if (eventMultiplier) {
      delta += current * (Number(eventMultiplier) - 1) * 0.03;
    }

    const maxPct = Math.min(0.12, Math.max(0.008, vol * 0.25));
    // Allow a bit more room when following a strong daily target
    const targetRoom =
      Math.abs(dailyTarget) >= 0.5
        ? Math.abs(targetDrift) * 3 + current * 0.002
        : 0;
    const maxAbs = Math.max(step * 1.5, current * maxPct, targetRoom);
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
