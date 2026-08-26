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

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async buy(
    userId: string,
    fishId: string,
    quantity: number,
    idempotencyKey?: string,
  ) {
    const key = idempotencyKey || `buy:${userId}:${fishId}:${randomUUID()}`;

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const existing = await tx.trade.findUnique({
          where: { idempotencyKey: key },
        });
        if (existing) {
          return this.serializeTrade(existing);
        }

        const fish = await tx.fish.findUnique({ where: { id: fishId } });
        if (!fish || !fish.isActive) {
          throw new NotFoundException('Fish not found');
        }
        if (fish.isFrozen) {
          throw new BadRequestException('Trading for this fish is frozen');
        }

        const qty = new Prisma.Decimal(quantity);
        const unitPrice = fish.currentPrice;
        const totalAmount = unitPrice.mul(qty);

        await this.ledger.debitInTransaction(tx, {
          userId,
          type: 'BUY_FISH',
          amount: totalAmount,
          idempotencyKey: `ledger:${key}`,
          referenceType: 'trade',
          metadata: { fishId, quantity: qty.toString(), side: 'BUY' },
        });

        const position = await tx.portfolioPosition.findUnique({
          where: { userId_fishId: { userId, fishId } },
        });

        if (position) {
          const newQty = position.quantity.add(qty);
          const newInvested = position.totalInvested.add(totalAmount);
          const avgBuyPrice = newInvested.div(newQty);
          await tx.portfolioPosition.update({
            where: { id: position.id },
            data: {
              quantity: newQty,
              totalInvested: newInvested,
              avgBuyPrice,
            },
          });
        } else {
          await tx.portfolioPosition.create({
            data: {
              userId,
              fishId,
              quantity: qty,
              avgBuyPrice: unitPrice,
              totalInvested: totalAmount,
            },
          });
        }

        const trade = await tx.trade.create({
          data: {
            userId,
            fishId,
            side: 'BUY',
            quantity: qty,
            unitPrice,
            totalAmount,
            idempotencyKey: key,
          },
        });

        return this.serializeTrade(trade);
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        const existing = await this.prisma.db.trade.findUnique({
          where: { idempotencyKey: key },
        });
        if (existing) return this.serializeTrade(existing);
      }
      throw e;
    }
  }

  async sell(
    userId: string,
    fishId: string,
    quantity: number,
    idempotencyKey?: string,
  ) {
    const key = idempotencyKey || `sell:${userId}:${fishId}:${randomUUID()}`;

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const existing = await tx.trade.findUnique({
          where: { idempotencyKey: key },
        });
        if (existing) {
          return this.serializeTrade(existing);
        }

        const fish = await tx.fish.findUnique({ where: { id: fishId } });
        if (!fish || !fish.isActive) {
          throw new NotFoundException('Fish not found');
        }
        if (fish.isFrozen) {
          throw new BadRequestException('Trading for this fish is frozen');
        }

        const qty = new Prisma.Decimal(quantity);
        const position = await tx.portfolioPosition.findUnique({
          where: { userId_fishId: { userId, fishId } },
        });
        if (!position || position.quantity.lt(qty)) {
          throw new BadRequestException('Insufficient fish quantity');
        }

        const unitPrice = fish.currentPrice;
        const totalAmount = unitPrice.mul(qty);
        const costBasis = position.avgBuyPrice.mul(qty);
        const realizedPnl = totalAmount.sub(costBasis);

        await this.ledger.creditInTransaction(tx, {
          userId,
          type: 'SELL_FISH',
          amount: totalAmount,
          idempotencyKey: `ledger:${key}`,
          referenceType: 'trade',
          metadata: { fishId, quantity: qty.toString(), side: 'SELL' },
        });

        const remainingQty = position.quantity.sub(qty);
        if (remainingQty.lte(0)) {
          await tx.portfolioPosition.delete({ where: { id: position.id } });
        } else {
          const remainingInvested = position.avgBuyPrice.mul(remainingQty);
          await tx.portfolioPosition.update({
            where: { id: position.id },
            data: {
              quantity: remainingQty,
              totalInvested: remainingInvested,
              realizedPnl: position.realizedPnl.add(realizedPnl),
            },
          });
        }

        const trade = await tx.trade.create({
          data: {
            userId,
            fishId,
            side: 'SELL',
            quantity: qty,
            unitPrice,
            totalAmount,
            realizedPnl,
            idempotencyKey: key,
          },
        });

        return this.serializeTrade(trade);
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        const existing = await this.prisma.db.trade.findUnique({
          where: { idempotencyKey: key },
        });
        if (existing) return this.serializeTrade(existing);
      }
      throw e;
    }
  }

  private serializeTrade(trade: {
    id: string;
    userId: string;
    fishId: string;
    side: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    realizedPnl: Prisma.Decimal | null;
    idempotencyKey: string;
    createdAt: Date;
  }) {
    return {
      id: trade.id,
      fishId: trade.fishId,
      side: trade.side,
      quantity: trade.quantity.toFixed(4),
      unitPrice: trade.unitPrice.toFixed(4),
      totalAmount: trade.totalAmount.toFixed(4),
      realizedPnl: trade.realizedPnl?.toFixed(4) ?? null,
      idempotencyKey: trade.idempotencyKey,
      createdAt: trade.createdAt.toISOString(),
    };
  }
}
