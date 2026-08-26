import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

type TonQuoteResult = {
  usdPrice: string;
  source: string;
  fetchedAt: string;
  expiresAt: string;
};

/**
 * Live TON/USD oracle (CoinGecko → Binance fallback).
 * Quotes always force a fresh fetch so deposit rates stay current.
 */
@Injectable()
export class OracleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OracleService.name);
  private readonly ttlMs: number;
  private refreshTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<TonQuoteResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Default 30s — quotes still force-refresh; TTL only for opportunistic cache
    this.ttlMs = Number(this.config.get('ORACLE_TTL_SECONDS') || 30) * 1000;
  }

  onModuleInit() {
    this.logger.log(`Oracle TTL: ${this.ttlMs}ms`);
    // Keep a warm live price in the DB
    this.refreshTimer = setInterval(() => {
      this.getTonUsd({ force: true }).catch((err) =>
        this.logger.warn(`Background TON oracle refresh failed: ${err?.message || err}`),
      );
    }, Math.max(20_000, Math.min(this.ttlMs, 60_000)));
    setTimeout(() => {
      this.getTonUsd({ force: true }).catch(() => undefined);
    }, 1500);
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async getTonUsd(opts?: { force?: boolean }): Promise<TonQuoteResult> {
    if (!opts?.force) {
      const fresh = await this.prisma.db.priceOracleSnapshot.findFirst({
        where: {
          asset: 'TON',
          isValid: true,
          expiresAt: { gt: new Date() },
        },
        orderBy: { fetchedAt: 'desc' },
      });
      if (fresh) {
        return {
          usdPrice: fresh.usdPrice.toFixed(8),
          source: fresh.source,
          fetchedAt: fresh.fetchedAt.toISOString(),
          expiresAt: fresh.expiresAt.toISOString(),
        };
      }
    }

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchLiveTon().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchLiveTon(): Promise<TonQuoteResult> {
    const errors: string[] = [];

    try {
      return await this.fetchAndStoreTon('COINGECKO', async () => {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
          { signal: AbortSignal.timeout(8_000) },
        );
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        const data = (await res.json()) as {
          'the-open-network'?: { usd?: number };
        };
        const price = data['the-open-network']?.usd;
        if (!price || !Number.isFinite(price) || price <= 0) {
          throw new Error('CoinGecko missing TON price');
        }
        return price;
      }, 1);
    } catch (err) {
      errors.push(`CoinGecko: ${err instanceof Error ? err.message : err}`);
    }

    try {
      return await this.fetchAndStoreTon('BINANCE', async () => {
        const res = await fetch(
          'https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT',
          { signal: AbortSignal.timeout(8_000) },
        );
        if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
        const data = (await res.json()) as { price?: string };
        const price = Number(data.price);
        if (!Number.isFinite(price) || price <= 0) {
          throw new Error('Binance missing TONUSDT price');
        }
        return price;
      }, 2);
    } catch (err) {
      errors.push(`Binance: ${err instanceof Error ? err.message : err}`);
    }

    // Last resort: last known snapshot even if expired
    const stale = await this.prisma.db.priceOracleSnapshot.findFirst({
      where: { asset: 'TON', isValid: true },
      orderBy: { fetchedAt: 'desc' },
    });
    if (stale) {
      this.logger.warn(
        `Using stale TON price $${stale.usdPrice} (${stale.source}); live fetch failed: ${errors.join('; ')}`,
      );
      return {
        usdPrice: stale.usdPrice.toFixed(8),
        source: `${stale.source}_STALE`,
        fetchedAt: stale.fetchedAt.toISOString(),
        expiresAt: stale.expiresAt.toISOString(),
      };
    }

    this.logger.error(`TON price unavailable: ${errors.join('; ')}`);
    throw new Error('TON price unavailable from all oracles');
  }

  private async fetchAndStoreTon(
    source: 'COINGECKO' | 'BINANCE' | 'TONAPI' | 'MANUAL',
    fetcher: () => Promise<number>,
    priority: number,
  ) {
    const usd = await fetcher();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const snap = await this.prisma.db.priceOracleSnapshot.create({
      data: {
        asset: 'TON',
        usdPrice: new Prisma.Decimal(usd),
        source,
        sourcePriority: priority,
        fetchedAt: now,
        expiresAt,
        isValid: true,
        rawPayload: { usd },
      },
    });
    this.logger.log(`TON/USD $${snap.usdPrice.toFixed(4)} via ${source}`);
    return {
      usdPrice: snap.usdPrice.toFixed(8),
      source: snap.source,
      fetchedAt: snap.fetchedAt.toISOString(),
      expiresAt: snap.expiresAt.toISOString(),
    };
  }
}
