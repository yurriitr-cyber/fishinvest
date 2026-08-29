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

const DAY_BAND = 0.2;

/**
 * Per-tick step: ~0.7–1.5%/hour RMS so a day usually stays well inside ±20%.
 */
function tickStep(
  price: number,
  volatility: number,
  intervalMs: number,
): number {
  const vol = Math.max(0.01, Math.min(1, volatility));
  const ticksPerHour = Math.max(60, 3_600_000 / Math.max(2000, intervalMs));
  const hourTarget = 0.007 + vol * 0.016;
  const stepPct = hourTarget / Math.sqrt(ticksPerHour);
  const jitter = 0.7 + Math.random() * 0.5;
  const abs = price * stepPct * jitter;
  const floor = price < 1 ? 0.0001 : price < 100 ? 0.001 : 0.01;
  return Math.max(floor, abs);
}

function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Per-fish 3h lean in [-1, 1] so names don't all move the same way. */
function fishMood(fishId: string, nowMs: number): number {
  const slot = Math.floor(nowMs / (3 * 3_600_000));
  return hashUnit(`${fishId}:${slot}`) * 2 - 1;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Soft 24h band: never go further outside ±20%, but don't snap back. */
function applyDayBand(next: number, current: number, lo: number, hi: number) {
  if (next < lo) return Math.max(next, Math.min(current, lo));
  if (next > hi) return Math.min(next, Math.max(current, hi));
  return next;
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

    const step = tickStep(current, vol, this.intervalMs);
    const mood = fishMood(fish.id, now.getTime());
    const pull = (previous - current) * 0.03;
    const legacyDrift = current * trend * 0.0015;
    const noise = (Math.random() * 2 - 1) * step;
    const moodDrift = mood * step * 0.32;
    let delta =
      pull + legacyDrift + noise + moodDrift + momentum * current * 0.05;

    let clearRamp = false;
    let source: 'AUTOMATIC' | 'EVENT' | 'ADMIN' = eventMultiplier
      ? 'EVENT'
      : 'AUTOMATIC';
    let rampTo: number | null = null;

    if (hasRamp) {
      const to = Number(fish.rampToPrice);
      rampTo = to;
      const remainingMs = fish.rampEndAt!.getTime() - now.getTime();
      const remainingTicks = Math.max(1, remainingMs / this.intervalMs);
      const needed =
        current > 0 && to > 0
          ? current * (Math.pow(to / current, 1 / remainingTicks) - 1)
          : (to - current) / remainingTicks;
      delta += needed;
    } else if (eventMultiplier) {
      delta += current * (Number(eventMultiplier) - 1) * 0.008;
    }

    const maxPct = Math.min(0.0028, Math.max(0.0012, vol * 0.01));
    const maxAbs = Math.max(step * 1.5, current * maxPct);
    delta = clamp(delta, -maxAbs, maxAbs);
    if (hasRamp && rampTo != null) {
      const remainingMs = fish.rampEndAt!.getTime() - now.getTime();
      if (remainingMs <= this.intervalMs && Math.abs(rampTo - current) <= maxAbs * 1.6) {
        delta = rampTo - current;
        clearRamp = true;
        source = 'ADMIN';
      }
    }
    let newPrice = current + delta;

    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [dayPoint, hourPoint, firstPoint] = await Promise.all([
      this.prisma.db.priceHistory.findFirst({
        where: { fishId: fish.id, createdAt: { lte: dayAgo } },
        orderBy: { createdAt: 'desc' },
        select: { price: true },
      }),
      this.prisma.db.priceHistory.findFirst({
        where: { fishId: fish.id, createdAt: { lte: hourAgo } },
        orderBy: { createdAt: 'desc' },
        select: { price: true },
      }),
      this.prisma.db.priceHistory.findFirst({
        where: { fishId: fish.id },
        orderBy: { createdAt: 'asc' },
        select: { price: true },
      }),
    ]);
    const dayBase = Number(dayPoint?.price ?? fish.currentPrice);
    const dayLo = dayBase * (1 - DAY_BAND);
    const dayHi = dayBase * (1 + DAY_BAND);
    if (hasRamp && rampTo != null) {
      const allowLo = Math.min(dayLo, rampTo, current);
      const allowHi = Math.max(dayHi, rampTo, current);
      newPrice = applyDayBand(newPrice, current, allowLo, allowHi);
    } else {
      newPrice = applyDayBand(newPrice, current, dayLo, dayHi);
    }

    newPrice = clamp(newPrice, Number(fish.minPrice), Number(fish.maxPrice));
    let rounded = Math.round(newPrice * 10000) / 10000;
    if (rounded === current && newPrice !== current) {
      const ulp = current < 1 ? 0.0001 : current < 100 ? 0.001 : 0.01;
      const dir = newPrice > current ? 1 : -1;
      const lastDir = current - previous;
      // Don't flip 0.0170↔0.0171 every tick — that reads as a fake chart.
      if (lastDir === 0 || lastDir * dir > 0) {
        rounded = current + dir * ulp;
        rounded = clamp(rounded, Number(fish.minPrice), Number(fish.maxPrice));
      }
    }
    newPrice = rounded;

    const prevDec = fish.currentPrice;
    const price = new Prisma.Decimal(newPrice);

    let base = hourPoint?.price ?? firstPoint?.price ?? prevDec;
    const changePercent = base.gt(0)
      ? price.sub(base).div(base).mul(100)
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
