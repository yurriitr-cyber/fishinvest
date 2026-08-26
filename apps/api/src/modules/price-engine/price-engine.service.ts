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

/** Residual jitter when no admin ramp is active. */
function tickStep(price: number, volatility: number): number {
  const vol = Math.max(0.01, volatility);
  const pct = vol * (0.06 + Math.random() * 0.08);
  const abs = price * pct;
  const floor = price < 0.1 ? 0.0005 : price < 1 ? 0.002 : 0.01;
  return Math.max(floor, abs);
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
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
      await this.updateFishPrice(fish, event?.priceMultiplier ?? null, event?.id, now);
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
      rampFromPrice: Prisma.Decimal | null;
      rampToPrice: Prisma.Decimal | null;
      rampStartAt: Date | null;
      rampEndAt: Date | null;
      momentum: Prisma.Decimal;
      minPrice: Prisma.Decimal;
      maxPrice: Prisma.Decimal;
      allTimeHigh: Prisma.Decimal;
      allTimeLow: Prisma.Decimal;
    },
    eventMultiplier: Prisma.Decimal | null,
    marketEventId: string | undefined,
    now: Date,
  ) {
    const current = Number(fish.currentPrice);
    const previous = Number(fish.previousPrice);
    const trend = Number(fish.trend);
    const momentum = Number(fish.momentum);
    const vol = Number(fish.volatility);

    const hasRamp =
      fish.rampFromPrice != null &&
      fish.rampToPrice != null &&
      fish.rampStartAt != null &&
      fish.rampEndAt != null;

    let newPrice = current;
    let clearRamp = false;
    let source: 'AUTOMATIC' | 'EVENT' | 'ADMIN' = eventMultiplier
      ? 'EVENT'
      : 'AUTOMATIC';

    if (hasRamp) {
      const from = Number(fish.rampFromPrice);
      const to = Number(fish.rampToPrice);
      const start = fish.rampStartAt!.getTime();
      const end = fish.rampEndAt!.getTime();
      const span = Math.max(1, end - start);
      const rawT = (now.getTime() - start) / span;
      const t = smoothstep(Math.min(1, Math.max(0, rawT)));

      // Geometric interpolation so +10% lands exactly on target
      const desired =
        from > 0 && to > 0
          ? from * Math.pow(to / from, t)
          : from + (to - from) * t;

      // Tiny noise so the chart still breathes (~0.05% of path)
      const path = Math.abs(to - from) || current * 0.01;
      const micro = (Math.random() * 2 - 1) * path * 0.008;
      newPrice = desired + micro;

      if (rawT >= 1) {
        newPrice = to;
        clearRamp = true;
        source = 'ADMIN';
      }
    } else {
      // No admin ramp: normal noisy market
      const anchor = previous || current;
      const pullStrength = Math.max(0.04, 0.22 - vol * 0.35);
      const pull = (anchor - current) * pullStrength;
      const legacyDrift = current * trend * 0.0015;
      const step = tickStep(current, vol);
      const noise = (Math.random() * 2 - 1) * step;
      let delta = pull + legacyDrift + noise + momentum * current * 0.04;

      if (eventMultiplier) {
        delta += current * (Number(eventMultiplier) - 1) * 0.03;
      }

      const maxPct = Math.min(0.12, Math.max(0.008, vol * 0.25));
      const maxAbs = Math.max(step * 1.5, current * maxPct);
      delta = Math.max(-maxAbs, Math.min(maxAbs, delta));
      newPrice = current + delta;
    }

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
        Math.min(
          0.2,
          momentum * 0.65 + ((newPrice - current) / Math.max(current, 0.01)) * 0.35,
        ),
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
          ...(clearRamp
            ? {
                dailyTargetPercent: 0,
                rampFromPrice: null,
                rampToPrice: null,
                rampStartAt: null,
                rampEndAt: null,
              }
            : {}),
        },
      });

      await tx.priceHistory.create({
        data: {
          fishId: fish.id,
          price,
          previousPrice: prevDec,
          changePercent,
          source,
          marketEventId: marketEventId ?? null,
        },
      });
    });
  }
}
