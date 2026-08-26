import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Price oracle for REAL assets (TON/USD, etc.).
 * Separate from virtual fish prices.
 */
@Injectable()
export class OracleService implements OnModuleInit {
  private readonly logger = new Logger(OracleService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.ttlMs = Number(this.config.get('ORACLE_TTL_SECONDS') || 120) * 1000;
  }

  onModuleInit() {
    this.logger.log(`Oracle TTL: ${this.ttlMs}ms`);
  }

  async getTonUsd(): Promise<{
    usdPrice: string;
    source: string;
    fetchedAt: string;
    expiresAt: string;
  }> {
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

    // Primary: CoinGecko
    try {
      return await this.fetchAndStoreTon('COINGECKO', async () => {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
        );
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        const data = (await res.json()) as {
          'the-open-network'?: { usd?: number };
        };
        const price = data['the-open-network']?.usd;
        if (!price) throw new Error('CoinGecko missing TON price');
        return price;
      }, 1);
    } catch (primaryErr) {
      this.logger.warn(`Primary oracle failed: ${String(primaryErr)}`);
    }

    throw new Error('TON price unavailable from all oracles');
  }

  private async fetchAndStoreTon(
    source: 'COINGECKO' | 'TONAPI' | 'MANUAL',
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
    return {
      usdPrice: snap.usdPrice.toFixed(8),
      source: snap.source,
      fetchedAt: snap.fetchedAt.toISOString(),
      expiresAt: snap.expiresAt.toISOString(),
    };
  }
}
