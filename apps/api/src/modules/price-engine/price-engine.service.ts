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

/**
 * Per-tick absolute step sized so a random walk drifts ~1–2%/hour on average.
 * Seed vols ~0.02–0.42: cheap/common fish move more, mythics a bit less.
 */
function tickStep(
  price: number,
  volatility: number,
  intervalMs: number,
): number {
  const vol = Math.max(0.01, Math.min(1, volatility));
  const ticksPerHour = Math.max(60, 3_600_000 / Math.max(2000, intervalMs));
  // Target RMS move over an hour (fraction of price), scaled by volatility.
  const hourTarget = 0.01 + vol * 0.03; // ~1.0% … ~2.3%
  const stepPct = hourTarget / Math.sqrt(ticksPerHour);
  const jitter = 0.65 + Math.random() * 0.7; // 0.65×–1.35×
  const abs = price * stepPct * jitter;
  // Always at least one 4-decimal ULP so cheap fish don't freeze at 0.0000.
  const floor = price < 1 ? 0.0001 : price < 100 ? 0.001 : 0.01;
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
      // Free market: random walk aimed at ~1–2% RMS move per hour.
      const step = tickStep(current, vol, this.intervalMs);
      // Mild mean-reversion to last price so we don't runaway, but weak enough
      // to let the hour-scale walk accumulate.
      const pull = (previous - current) * 0.04;
      const legacyDrift = current * trend * 0.002;
      const noise = (Math.random() * 2 - 1) * step;
      let delta =
        pull + legacyDrift + noise + momentum * current * 0.08;

      if (eventMultiplier) {
        delta += current * (Number(eventMultiplier) - 1) * 0.01;
      }

      // Cap a single tick ~0.35% so the tape doesn't jump like a slot machine.
      const maxPct = Math.min(0.0035, Math.max(0.0015, vol * 0.012));
      const maxAbs = Math.max(step * 1.4, current * maxPct);
      delta = Math.max(-maxAbs, Math.min(maxAbs, delta));
      newPrice = current + delta;
    }

    newPrice = Math.max(Number(fish.minPrice), Math.min(Number(fish.maxPrice), newPrice));
    let rounded = Math.round(newPrice * 10000) / 10000;
    // If the move rounded away, nudge one ULP in the intended direction.
    if (rounded === current && newPrice !== current) {
      rounded = current + (newPrice > current ? 0.0001 : -0.0001);
      rounded = Math.max(
        Number(fish.minPrice),
        Math.min(Number(fish.maxPrice), rounded),
      );
    }
    newPrice = rounded;

    const prevDec = fish.currentPrice;
    const price = new Prisma.Decimal(newPrice);

    // Market % = change vs ~1h ago (not last tick), so the board isn't stuck at 0.
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    let base = (
      await this.prisma.db.priceHistory.findFirst({
        where: { fishId: fish.id, createdAt: { lte: hourAgo } },
        orderBy: { createdAt: 'desc' },
        select: { price: true },
      })
    )?.price;
    if (!base) {
      // First hour after deploy: measure from earliest tick we have.
      base = (
        await this.prisma.db.priceHistory.findFirst({
          where: { fishId: fish.id },
          orderBy: { createdAt: 'asc' },
          select: { price: true },
        })
      )?.price;
    }
    if (!base) base = prevDec;
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
