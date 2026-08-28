import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { randomUUID } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { fishDisplayName } from '../fish/fish-names';
import { caseDisplayDesc, caseDisplayName } from './case-names';

type WeightedReward = {
  weight: number;
  quantity: number;
  fish: {
    currentPrice: Prisma.Decimal;
    availableSupply: number;
  };
};

type RewardRow = {
  id: string;
  fishId: string;
  weight: number;
  quantity: number;
  fish: {
    id: string;
    symbol: string;
    name: string;
    rarity: string;
    currentPrice: Prisma.Decimal;
    availableSupply: number;
    imageUrl: string | null;
  };
};

/** Tolerance for the price the client last saw, so a mid-roll tick is not fatal. */
const PRICE_SLIPPAGE = 1.08;
const FREE_DAILY_MS = 24 * 60 * 60 * 1000;

function isFreeDailyCase(code: string) {
  return code.toUpperCase() === 'DAILY';
}

@Injectable()
export class CasinoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async listCases(userId?: string) {
    const cases = await this.prisma.db.lootCase.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        rewards: {
          include: {
            fish: {
              select: {
                id: true,
                symbol: true,
                name: true,
                rarity: true,
                currentPrice: true,
                availableSupply: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });

    let lastDailyAt: Date | null = null;
    const credits = new Map<string, number>();
    if (userId) {
      const daily = cases.find((c) => isFreeDailyCase(c.code));
      if (daily) {
        const last = await this.prisma.db.caseOpening.findFirst({
          where: { userId, caseId: daily.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        lastDailyAt = last?.createdAt ?? null;
      }
      const creditRows = await this.prisma.db.userCaseCredit.findMany({
        where: { userId, remaining: { gt: 0 } },
        select: { caseId: true, remaining: true },
      });
      for (const row of creditRows) credits.set(row.caseId, row.remaining);
    }

    return cases.map((c) =>
      this.serializeCase(c, lastDailyAt, credits.get(c.id) ?? 0),
    );
  }

  async getCase(caseId: string) {
    const row = await this.prisma.db.lootCase.findFirst({
      where: { OR: [{ id: caseId }, { code: caseId }], isActive: true },
      include: {
        rewards: {
          include: {
            fish: {
              select: {
                id: true,
                symbol: true,
                name: true,
                rarity: true,
                currentPrice: true,
                availableSupply: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Case not found');
    return this.serializeCase(row);
  }

  async recentOpenings(userId: string, limit = 20) {
    const rows = await this.prisma.db.caseOpening.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
      include: {
        lootCase: { select: { code: true, name: true } },
        fish: {
          select: {
            id: true,
            symbol: true,
            name: true,
            rarity: true,
            currentPrice: true,
            imageUrl: true,
          },
        },
      },
    });
    return rows.map((o) => ({
      id: o.id,
      caseCode: o.lootCase.code,
      caseName: caseDisplayName(o.lootCase.code, o.lootCase.name),
      fishId: o.fish.id,
      symbol: o.fish.symbol,
      name: fishDisplayName(o.fish.symbol, o.fish.name),
      rarity: o.fish.rarity,
      imageUrl: o.fish.imageUrl || `/fish/${o.fish.symbol}.jpg`,
      quantity: o.quantity,
      pricePaid: o.pricePaid.toFixed(4),
      fishUnitPrice: o.fishUnitPrice.toFixed(4),
      fishMarketValue: o.fishMarketValue.toFixed(4),
      currentPrice: o.fish.currentPrice.toFixed(4),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async openCase(
    userId: string,
    caseId: string,
    idempotencyKey?: string,
    maxPrice?: number,
  ) {
    const key = idempotencyKey || `case:${userId}:${caseId}:${randomUUID()}`;

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const existing = await tx.caseOpening.findUnique({
          where: { idempotencyKey: key },
          include: {
            lootCase: { select: { code: true, name: true } },
            fish: {
              select: {
                id: true,
                symbol: true,
                name: true,
                rarity: true,
                currentPrice: true,
                imageUrl: true,
              },
            },
          },
        });
        if (existing) return this.serializeOpening(existing);

        const crate = await tx.lootCase.findFirst({
          where: {
            OR: [{ id: caseId }, { code: caseId }],
            isActive: true,
          },
          include: {
            rewards: {
              include: {
                fish: {
                  select: {
                    id: true,
                    symbol: true,
                    name: true,
                    rarity: true,
                    currentPrice: true,
                    availableSupply: true,
                    imageUrl: true,
                  },
                },
              },
            },
          },
        });
        if (!crate) throw new NotFoundException('Case not found');
        if (!crate.rewards.length) {
          throw new BadRequestException('Case has no rewards configured');
        }

        const freeDaily = isFreeDailyCase(crate.code);
        if (freeDaily) {
          const last = await tx.caseOpening.findFirst({
            where: { userId, caseId: crate.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });
          if (last) {
            const nextAt = last.createdAt.getTime() + FREE_DAILY_MS;
            if (Date.now() < nextAt) {
              const mins = Math.ceil((nextAt - Date.now()) / 60_000);
              const hours = Math.floor(mins / 60);
              const rem = mins % 60;
              throw new BadRequestException(
                hours > 0
                  ? `Бесплатный кейс через ${hours} ч ${rem} мин`
                  : `Бесплатный кейс через ${mins} мин`,
              );
            }
          }
        }

        let useCredit = false;
        if (!freeDaily) {
          const credit = await tx.userCaseCredit.findUnique({
            where: { userId_caseId: { userId, caseId: crate.id } },
          });
          useCredit = Boolean(credit && credit.remaining > 0);
        }

        const available = crate.rewards.filter(
          (r) => r.fish.availableSupply >= r.quantity,
        ) as RewardRow[];
        if (!available.length) {
          throw new BadRequestException(
            'All fish in this case are sold out — try another case',
          );
        }

        const pricePaid =
          freeDaily || useCredit
            ? new Prisma.Decimal(0)
            : this.ticketPrice(
                this.expectedValue(available),
                crate.edgePercent,
                crate.priceCredits,
              );
        if (
          !freeDaily &&
          !useCredit &&
          maxPrice !== undefined &&
          Number(pricePaid) > maxPrice * PRICE_SLIPPAGE
        ) {
          throw new BadRequestException(
            'Case price moved — refresh and try again',
          );
        }

        const picked = this.weightedPick(available);
        const qty = picked.quantity;
        const unitPrice = picked.fish.currentPrice;
        const marketValue = unitPrice.mul(qty);

        const reserved = await tx.fish.updateMany({
          where: { id: picked.fishId, availableSupply: { gte: qty } },
          data: { availableSupply: { decrement: qty } },
        });
        if (reserved.count === 0) {
          throw new BadRequestException(
            `${picked.fish.symbol} just sold out — open again`,
          );
        }

        if (useCredit) {
          const spent = await tx.userCaseCredit.updateMany({
            where: {
              userId,
              caseId: crate.id,
              remaining: { gt: 0 },
            },
            data: { remaining: { decrement: 1 } },
          });
          if (spent.count === 0) {
            throw new BadRequestException(
              'Промо-открытие уже использовано — обновите',
            );
          }
        }

        if (!freeDaily && !useCredit) {
          await this.ledger.debitInTransaction(tx, {
            userId,
            type: 'CASE_OPEN',
            amount: pricePaid,
            idempotencyKey: `ledger:${key}`,
            referenceType: 'case_opening',
            metadata: {
              caseId: crate.id,
              caseCode: crate.code,
              fishId: picked.fishId,
              quantity: qty,
            },
          });
        }

        const position = await tx.portfolioPosition.findUnique({
          where: { userId_fishId: { userId, fishId: picked.fishId } },
        });
        const qtyDec = new Prisma.Decimal(qty);
        if (position) {
          const newQty = position.quantity.add(qtyDec);
          const newInvested = position.totalInvested.add(marketValue);
          await tx.portfolioPosition.update({
            where: { id: position.id },
            data: {
              quantity: newQty,
              totalInvested: newInvested,
              avgBuyPrice: newInvested.div(newQty),
            },
          });
        } else {
          await tx.portfolioPosition.create({
            data: {
              userId,
              fishId: picked.fishId,
              quantity: qtyDec,
              avgBuyPrice: unitPrice,
              totalInvested: marketValue,
            },
          });
        }

        const opening = await tx.caseOpening.create({
          data: {
            userId,
            caseId: crate.id,
            fishId: picked.fishId,
            quantity: qty,
            pricePaid,
            fishUnitPrice: unitPrice,
            fishMarketValue: marketValue,
            idempotencyKey: key,
          },
          include: {
            lootCase: { select: { code: true, name: true } },
            fish: {
              select: {
                id: true,
                symbol: true,
                name: true,
                rarity: true,
                currentPrice: true,
                imageUrl: true,
              },
            },
          },
        });

        await tx.gameBalanceLedger.updateMany({
          where: { idempotencyKey: `ledger:${key}` },
          data: { referenceId: opening.id },
        });

        return this.serializeOpening(opening);
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        const existing = await this.prisma.db.caseOpening.findUnique({
          where: { idempotencyKey: key },
          include: {
            lootCase: { select: { code: true, name: true } },
            fish: {
              select: {
                id: true,
                symbol: true,
                name: true,
                rarity: true,
                currentPrice: true,
                imageUrl: true,
              },
            },
          },
        });
        if (existing) return this.serializeOpening(existing);
      }
      throw e;
    }
  }

  /** Mean payout in credits over the rewards that can actually drop. */
  private expectedValue(rewards: WeightedReward[]): Prisma.Decimal {
    const totalWeight = rewards.reduce((s, r) => s + r.weight, 0);
    if (!totalWeight) return new Prisma.Decimal(0);
    return rewards.reduce(
      (sum, r) =>
        sum.add(
          r.fish.currentPrice
            .mul(r.quantity)
            .mul(new Prisma.Decimal(r.weight))
            .div(totalWeight),
        ),
      new Prisma.Decimal(0),
    );
  }

  /**
   * Fish prices drift every few seconds, so a fixed ticket price would swing the
   * house edge wildly. Derive it from the live EV instead and keep the stored
   * price as a floor.
   */
  private ticketPrice(
    ev: Prisma.Decimal,
    edgePercent: Prisma.Decimal,
    floor: Prisma.Decimal,
  ): Prisma.Decimal {
    const keep = new Prisma.Decimal(1).sub(edgePercent.div(100));
    if (keep.lte(0)) return floor;
    const price = this.roundPrice(ev.div(keep));
    return price.lt(floor) ? floor : price;
  }

  /** Snap to human-looking increments that grow with the tier. */
  private roundPrice(value: Prisma.Decimal): Prisma.Decimal {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return new Prisma.Decimal(0);
    const step =
      n < 0.1 ? 0.001 : n < 1 ? 0.01 : n < 10 ? 0.1 : n < 100 ? 1 : n < 1000 ? 5 : 25;
    return new Prisma.Decimal(Math.ceil(n / step) * step).toDecimalPlaces(4);
  }

  private weightedPick(rewards: RewardRow[]): RewardRow {
    const total = rewards.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    for (const r of rewards) {
      roll -= r.weight;
      if (roll <= 0) return r;
    }
    return rewards[rewards.length - 1];
  }

  private serializeCase(
    c: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      priceCredits: Prisma.Decimal;
      edgePercent: Prisma.Decimal;
      sortOrder: number;
      rewards: Array<{
        weight: number;
        quantity: number;
        fish: {
          id: string;
          symbol: string;
          name: string;
          rarity: string;
          currentPrice: Prisma.Decimal;
          availableSupply: number;
          imageUrl: string | null;
        };
      }>;
    },
    lastDailyAt: Date | null = null,
    freeCredits = 0,
  ) {
    const freeDaily = isFreeDailyCase(c.code);
    const droppable = c.rewards.filter(
      (r) => r.fish.availableSupply >= r.quantity,
    );
    const totalWeight = droppable.reduce((s, r) => s + r.weight, 0);
    const expectedValue = this.expectedValue(droppable);
    const priceCredits = freeDaily
      ? new Prisma.Decimal(0)
      : this.ticketPrice(expectedValue, c.edgePercent, c.priceCredits);

    const loot = c.rewards
      .map((r) => {
        const canDrop = r.fish.availableSupply >= r.quantity;
        const chance = canDrop && totalWeight ? (r.weight / totalWeight) * 100 : 0;
        return {
          fishId: r.fish.id,
          symbol: r.fish.symbol,
          name: fishDisplayName(r.fish.symbol, r.fish.name),
          rarity: r.fish.rarity,
          imageUrl: r.fish.imageUrl || `/fish/${r.fish.symbol}.jpg`,
          quantity: r.quantity,
          weight: r.weight,
          chancePercent: Number(chance.toFixed(2)),
          marketPrice: r.fish.currentPrice.toFixed(4),
          available: canDrop,
        };
      })
      .sort((a, b) => b.chancePercent - a.chancePercent);

    const price = Number(priceCredits);
    const ev = Number(expectedValue);

    let canOpenFree = true;
    let nextFreeAt: string | null = null;
    if (freeDaily && lastDailyAt) {
      const next = lastDailyAt.getTime() + FREE_DAILY_MS;
      if (Date.now() < next) {
        canOpenFree = false;
        nextFreeAt = new Date(next).toISOString();
      }
    }

    return {
      id: c.id,
      code: c.code,
      name: caseDisplayName(c.code, c.name),
      description: caseDisplayDesc(c.code, c.description),
      priceCredits: priceCredits.toFixed(4),
      sortOrder: c.sortOrder,
      expectedValue: expectedValue.toFixed(4),
      houseEdgePercent:
        price > 0 ? Number((((price - ev) / price) * 100).toFixed(1)) : 0,
      isFreeDaily: freeDaily,
      canOpenFree: freeDaily ? canOpenFree : true,
      nextFreeAt: freeDaily ? nextFreeAt : null,
      freeCredits,
      loot,
    };
  }

  private serializeOpening(o: {
    id: string;
    quantity: number;
    pricePaid: Prisma.Decimal;
    fishUnitPrice: Prisma.Decimal;
    fishMarketValue: Prisma.Decimal;
    createdAt: Date;
    lootCase: { code: string; name: string };
    fish: {
      id: string;
      symbol: string;
      name: string;
      rarity: string;
      currentPrice: Prisma.Decimal;
      imageUrl: string | null;
    };
  }) {
    const paid = Number(o.pricePaid);
    const value = Number(o.fishMarketValue);
    return {
      id: o.id,
      caseCode: o.lootCase.code,
      caseName: caseDisplayName(o.lootCase.code, o.lootCase.name),
      fishId: o.fish.id,
      symbol: o.fish.symbol,
      name: fishDisplayName(o.fish.symbol, o.fish.name),
      rarity: o.fish.rarity,
      imageUrl: o.fish.imageUrl || `/fish/${o.fish.symbol}.jpg`,
      quantity: o.quantity,
      pricePaid: o.pricePaid.toFixed(4),
      fishUnitPrice: o.fishUnitPrice.toFixed(4),
      fishMarketValue: o.fishMarketValue.toFixed(4),
      currentPrice: o.fish.currentPrice.toFixed(4),
      profit: (value - paid).toFixed(4),
      createdAt: o.createdAt.toISOString(),
    };
  }
}
