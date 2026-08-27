import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

function parseIntervalMs(value: string | undefined): number {
  const v = (value || '5s').trim().toLowerCase();
  const match = v.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 5000;
  const n = Number(match[1]);
  switch (match[2]) {
    case 's':
      return Math.max(2000, n * 1000);
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      return 5000;
  }
}

/** Residual jitter when no admin ramp is active — crypto-like micro moves per tick. */
function tickStep(price: number, volatility: number): number {
  // Seed vols are ~0.02–0.42 (daily-ish). At ~3–5s ticks, real markets move
  // ~0.02–0.25% typically; memecoins a bit more. Keep abs floor tiny for cheap fish.
  const vol = Math.max(0.01, Math.min(1, volatility));
  const pct = vol * (0.0012 + Math.random() * 0.0028); // ~0.012%–0.4% for normal vols
  const abs = price * pct;
  const floor = price < 0.1 ? 0.00001 : price < 1 ? 0.00005 : 0.0002;
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
  private intervalMs = 5000;

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
      const micro = (Math.random() * 2 - 1) * path * 0.0005;
      newPrice = desired + micro;

      if (rawT >= 1) {
        newPrice = to;
        clearRamp = true;
        source = 'ADMIN';
      }
    } else {
      // Free market: quiet GBM-ish drift (crypto spot tape), not casino jumps.
      const anchor = previous || current;
      const pullStrength = Math.max(0.08, 0.35 - vol * 0.4);
      const pull = (anchor - current) * pullStrength;
      const legacyDrift = current * trend * 0.0004;
      const step = tickStep(current, vol);
      const noise = (Math.random() * 2 - 1) * step;
      let delta = pull + legacyDrift + noise + momentum * current * 0.012;

      if (eventMultiplier) {
        // Events still matter, but don't dump several % every 3s.
        delta += current * (Number(eventMultiplier) - 1) * 0.008;
      }

      // Hard cap ≈ 0.8% per tick (rare memecoin spike); typical << that.
      const maxPct = Math.min(0.008, Math.max(0.0012, vol * 0.018));
      const maxAbs = Math.max(step * 1.25, current * maxPct);
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
        -0.06,
        Math.min(
          0.06,
          momentum * 0.82 + ((newPrice - current) / Math.max(current, 0.01)) * 0.18,
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
