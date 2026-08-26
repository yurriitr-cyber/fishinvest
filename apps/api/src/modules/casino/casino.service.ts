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

@Injectable()
export class CasinoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async listCases() {
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
    return cases.map((c) => this.serializeCase(c));
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
      caseName: o.lootCase.name,
      fishId: o.fish.id,
      symbol: o.fish.symbol,
      name: o.fish.name,
      rarity: o.fish.rarity,
      imageUrl: o.fish.imageUrl,
      quantity: o.quantity,
      pricePaid: o.pricePaid.toFixed(4),
      fishUnitPrice: o.fishUnitPrice.toFixed(4),
      fishMarketValue: o.fishMarketValue.toFixed(4),
      currentPrice: o.fish.currentPrice.toFixed(4),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async openCase(userId: string, caseId: string, idempotencyKey?: string) {
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

        const available = crate.rewards.filter(
          (r) => r.fish.availableSupply >= r.quantity,
        ) as RewardRow[];
        if (!available.length) {
          throw new BadRequestException(
            'All fish in this case are sold out — try another case',
          );
        }

        const picked = this.weightedPick(available);
        const qty = picked.quantity;
        const unitPrice = picked.fish.currentPrice;
        const marketValue = unitPrice.mul(qty);
        const pricePaid = crate.priceCredits;

        const reserved = await tx.fish.updateMany({
          where: { id: picked.fishId, availableSupply: { gte: qty } },
          data: { availableSupply: { decrement: qty } },
        });
        if (reserved.count === 0) {
          throw new BadRequestException(
            `${picked.fish.symbol} just sold out — open again`,
          );
        }

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

  private weightedPick(rewards: RewardRow[]): RewardRow {
    const total = rewards.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    for (const r of rewards) {
      roll -= r.weight;
      if (roll <= 0) return r;
    }
    return rewards[rewards.length - 1];
  }

  private serializeCase(c: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    priceCredits: Prisma.Decimal;
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
  }) {
    const totalWeight = c.rewards.reduce((s, r) => s + r.weight, 0) || 1;
    let expectedValue = new Prisma.Decimal(0);
    const loot = c.rewards
      .map((r) => {
        const chance = (r.weight / totalWeight) * 100;
        const value = r.fish.currentPrice.mul(r.quantity);
        expectedValue = expectedValue.add(
          value.mul(new Prisma.Decimal(r.weight)).div(totalWeight),
        );
        return {
          fishId: r.fish.id,
          symbol: r.fish.symbol,
          name: r.fish.name,
          rarity: r.fish.rarity,
          imageUrl: r.fish.imageUrl,
          quantity: r.quantity,
          weight: r.weight,
          chancePercent: Number(chance.toFixed(2)),
          marketPrice: r.fish.currentPrice.toFixed(4),
          available: r.fish.availableSupply > 0,
        };
      })
      .sort((a, b) => b.chancePercent - a.chancePercent);

    const price = Number(c.priceCredits);
    const ev = Number(expectedValue);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      priceCredits: c.priceCredits.toFixed(4),
      sortOrder: c.sortOrder,
      expectedValue: expectedValue.toFixed(4),
      houseEdgePercent:
        price > 0 ? Number((((price - ev) / price) * 100).toFixed(1)) : 0,
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
      caseName: o.lootCase.name,
      fishId: o.fish.id,
      symbol: o.fish.symbol,
      name: o.fish.name,
      rarity: o.fish.rarity,
      imageUrl: o.fish.imageUrl,
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
