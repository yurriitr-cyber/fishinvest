import {
  ConflictException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { LedgerType, Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

export type TxClient = Prisma.TransactionClient;

export interface CreditParams {
  userId: string;
  type: LedgerType;
  amount: number | string | Prisma.Decimal;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface DebitParams extends CreditParams {}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async credit(params: CreditParams) {
    return this.prisma.db.$transaction((tx) =>
      this.creditInTransaction(tx, params),
    );
  }

  async debit(params: DebitParams) {
    return this.prisma.db.$transaction((tx) =>
      this.debitInTransaction(tx, params),
    );
  }

  async creditInTransaction(tx: TxClient, params: CreditParams) {
    const amount = new Prisma.Decimal(params.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Credit amount must be positive');
    }

    const existing = await tx.gameBalanceLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      throw new ConflictException(
        `Duplicate ledger entry: ${params.idempotencyKey}`,
      );
    }

    const balance = await tx.gameBalance.upsert({
      where: { userId: params.userId },
      create: { userId: params.userId, available: 0 },
      update: {},
    });

    const newAvailable = balance.available.add(amount);

    await tx.gameBalance.update({
      where: { userId: params.userId },
      data: { available: newAvailable },
    });

    return tx.gameBalanceLedger.create({
      data: {
        userId: params.userId,
        type: params.type,
        amount,
        balanceAfter: newAvailable,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata,
      },
    });
  }

  async debitInTransaction(tx: TxClient, params: DebitParams) {
    const amount = new Prisma.Decimal(params.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Debit amount must be positive');
    }

    const existing = await tx.gameBalanceLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      throw new ConflictException(
        `Duplicate ledger entry: ${params.idempotencyKey}`,
      );
    }

    const balance = await tx.gameBalance.findUnique({
      where: { userId: params.userId },
    });
    if (!balance || balance.available.lt(amount)) {
      throw new BadRequestException('Insufficient game balance');
    }

    const newAvailable = balance.available.sub(amount);

    await tx.gameBalance.update({
      where: { userId: params.userId },
      data: { available: newAvailable },
    });

    return tx.gameBalanceLedger.create({
      data: {
        userId: params.userId,
        type: params.type,
        amount: amount.neg(),
        balanceAfter: newAvailable,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata,
      },
    });
  }
}
