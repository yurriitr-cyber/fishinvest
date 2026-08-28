import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PromoRewardKind, User } from '@rare-fish/db';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { fishDisplayName } from '../fish/fish-names';
import { caseDisplayName } from '../casino/case-names';

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

export type CreatePromoInput = {
  code: string;
  kind: PromoRewardKind;
  amount?: number;
  fishId?: string;
  caseId?: string;
  quantity?: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  note?: string;
};

@Injectable()
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  normalizeCode(raw: string) {
    return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  async list() {
    const rows = await this.prisma.db.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        fish: { select: { id: true, symbol: true, name: true } },
        lootCase: { select: { id: true, code: true, name: true } },
        _count: { select: { redemptions: true } },
      },
    });
    return rows.map((p) => this.serialize(p));
  }

  async create(admin: User, data: CreatePromoInput) {
    const code = this.normalizeCode(data.code);
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(
        'Код: 3–32 символа, латиница, цифры, _ или -',
      );
    }
    const kind = data.kind;
    if (!['BALANCE', 'FISH', 'CASE'].includes(kind)) {
      throw new BadRequestException('Неверный тип награды');
    }

    const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
    let amount: Prisma.Decimal | null = null;
    let fishId: string | null = null;
    let caseId: string | null = null;

    if (kind === 'BALANCE') {
      const n = Number(data.amount);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('Укажите сумму пополнения');
      }
      amount = new Prisma.Decimal(n);
    } else if (kind === 'FISH') {
      if (!data.fishId) throw new BadRequestException('Выберите рыбу');
      const fish = await this.prisma.db.fish.findUnique({
        where: { id: data.fishId },
      });
      if (!fish) throw new NotFoundException('Рыба не найдена');
      fishId = fish.id;
    } else {
      if (!data.caseId) throw new BadRequestException('Выберите кейс');
      const crate = await this.prisma.db.lootCase.findUnique({
        where: { id: data.caseId },
      });
      if (!crate) throw new NotFoundException('Кейс не найден');
      if (crate.code.toUpperCase() === 'DAILY') {
        throw new BadRequestException(
          'Ежедневный кейс нельзя выдавать промокодом',
        );
      }
      caseId = crate.id;
    }

    const maxUses =
      data.maxUses == null || data.maxUses === undefined || Number(data.maxUses) <= 0
        ? null
        : Math.floor(Number(data.maxUses));
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Неверная дата');
    }

    try {
      const created = await this.prisma.db.promoCode.create({
        data: {
          code,
          kind,
          amount,
          fishId,
          caseId,
          quantity,
          maxUses,
          expiresAt,
          note: data.note?.trim() || null,
        },
        include: {
          fish: { select: { id: true, symbol: true, name: true } },
          lootCase: { select: { id: true, code: true, name: true } },
          _count: { select: { redemptions: true } },
        },
      });
      await this.prisma.db.adminAction.create({
        data: {
          adminUserId: admin.id,
          actionType: 'CREATE_PROMO',
          entityType: 'promo_code',
          entityId: created.id,
          afterState: {
            code,
            kind,
            amount: amount?.toString() ?? null,
            fishId,
            caseId,
            quantity,
            maxUses,
          } as never,
        },
      });
      return this.serialize(created);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('Такой промокод уже есть');
      }
      throw e;
    }
  }

  async setActive(admin: User, id: string, isActive: boolean) {
    const before = await this.prisma.db.promoCode.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Промокод не найден');
    const after = await this.prisma.db.promoCode.update({
      where: { id },
      data: { isActive },
      include: {
        fish: { select: { id: true, symbol: true, name: true } },
        lootCase: { select: { id: true, code: true, name: true } },
        _count: { select: { redemptions: true } },
      },
    });
    await this.prisma.db.adminAction.create({
      data: {
        adminUserId: admin.id,
        actionType: isActive ? 'ENABLE_PROMO' : 'DISABLE_PROMO',
        entityType: 'promo_code',
        entityId: id,
        beforeState: { isActive: before.isActive } as never,
        afterState: { isActive } as never,
      },
    });
    return this.serialize(after);
  }

  async redeem(userId: string, rawCode: string) {
    const code = this.normalizeCode(rawCode);
    if (!code) throw new BadRequestException('Введите промокод');

    return this.prisma.db.$transaction(async (tx) => {
      const promo = await tx.promoCode.findUnique({
        where: { code },
        include: {
          fish: { select: { id: true, symbol: true, name: true } },
          lootCase: { select: { id: true, code: true, name: true } },
        },
      });
      if (!promo || !promo.isActive) {
        throw new BadRequestException('Промокод не найден');
      }
      if (promo.expiresAt && promo.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('Промокод истёк');
      }
      if (promo.maxUses != null && promo.usesCount >= promo.maxUses) {
        throw new BadRequestException('Промокод больше не действует');
      }

      const already = await tx.promoRedemption.findUnique({
        where: {
          promoCodeId_userId: { promoCodeId: promo.id, userId },
        },
      });
      if (already) {
        throw new BadRequestException('Вы уже использовали этот промокод');
      }

      const bumped = await tx.promoCode.updateMany({
        where: {
          id: promo.id,
          isActive: true,
          ...(promo.maxUses != null ? { usesCount: { lt: promo.maxUses } } : {}),
        },
        data: { usesCount: { increment: 1 } },
      });
      if (bumped.count === 0) {
        throw new BadRequestException('Промокод больше не действует');
      }

      await tx.promoRedemption.create({
        data: { promoCodeId: promo.id, userId },
      });

      if (promo.kind === 'BALANCE') {
        const amount = promo.amount;
        if (!amount || amount.lte(0)) {
          throw new BadRequestException('Промокод настроен неверно');
        }
        await this.ledger.creditInTransaction(tx, {
          userId,
          type: 'PROMO_BONUS',
          amount,
          idempotencyKey: `promo:${promo.id}:${userId}`,
          referenceType: 'promo_code',
          referenceId: promo.id,
          metadata: { code: promo.code },
        });
        return {
          ok: true as const,
          kind: promo.kind,
          message: `Зачислено ${this.fmt(amount)} CR`,
        };
      }

      if (promo.kind === 'FISH') {
        if (!promo.fishId || !promo.fish) {
          throw new BadRequestException('Промокод настроен неверно');
        }
        const qty = new Prisma.Decimal(promo.quantity);
        const position = await tx.portfolioPosition.findUnique({
          where: { userId_fishId: { userId, fishId: promo.fishId } },
        });
        if (position) {
          const newQty = position.quantity.add(qty);
          await tx.portfolioPosition.update({
            where: { id: position.id },
            data: {
              quantity: newQty,
              avgBuyPrice: newQty.gt(0)
                ? position.totalInvested.div(newQty)
                : new Prisma.Decimal(0),
            },
          });
        } else {
          await tx.portfolioPosition.create({
            data: {
              userId,
              fishId: promo.fishId,
              quantity: qty,
              avgBuyPrice: new Prisma.Decimal(0),
              totalInvested: new Prisma.Decimal(0),
            },
          });
        }
        const take = Math.max(
          0,
          Math.min(
            (
              await tx.fish.findUnique({
                where: { id: promo.fishId },
                select: { availableSupply: true },
              })
            )?.availableSupply ?? 0,
            promo.quantity,
          ),
        );
        if (take > 0) {
          await tx.fish.update({
            where: { id: promo.fishId },
            data: { availableSupply: { decrement: take } },
          });
        }
        const name = fishDisplayName(promo.fish.symbol, promo.fish.name);
        return {
          ok: true as const,
          kind: promo.kind,
          message: `Получено: ${name} × ${promo.quantity}`,
        };
      }

      if (!promo.caseId || !promo.lootCase) {
        throw new BadRequestException('Промокод настроен неверно');
      }
      const existing = await tx.userCaseCredit.findUnique({
        where: { userId_caseId: { userId, caseId: promo.caseId } },
      });
      if (existing) {
        await tx.userCaseCredit.update({
          where: { id: existing.id },
          data: { remaining: { increment: promo.quantity } },
        });
      } else {
        await tx.userCaseCredit.create({
          data: {
            userId,
            caseId: promo.caseId,
            remaining: promo.quantity,
          },
        });
      }
      const caseName = caseDisplayName(promo.lootCase.code, promo.lootCase.name);
      return {
        ok: true as const,
        kind: promo.kind,
        message: `${caseName}: +${promo.quantity} бесплатных открытий`,
      };
    });
  }

  private fmt(amount: Prisma.Decimal) {
    const n = Number(amount);
    return Number.isFinite(n)
      ? n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
      : amount.toString();
  }

  private serialize(p: {
    id: string;
    code: string;
    kind: PromoRewardKind;
    amount: Prisma.Decimal | null;
    quantity: number;
    maxUses: number | null;
    usesCount: number;
    expiresAt: Date | null;
    isActive: boolean;
    note: string | null;
    createdAt: Date;
    fish: { id: string; symbol: string; name: string } | null;
    lootCase: { id: string; code: string; name: string } | null;
    _count?: { redemptions: number };
  }) {
    return {
      id: p.id,
      code: p.code,
      kind: p.kind,
      amount: p.amount ? p.amount.toFixed(4) : null,
      quantity: p.quantity,
      maxUses: p.maxUses,
      usesCount: p.usesCount,
      redemptions: p._count?.redemptions ?? p.usesCount,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      isActive: p.isActive,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
      fish: p.fish
        ? {
            id: p.fish.id,
            symbol: p.fish.symbol,
            name: fishDisplayName(p.fish.symbol, p.fish.name),
          }
        : null,
      lootCase: p.lootCase
        ? {
            id: p.lootCase.id,
            code: p.lootCase.code,
            name: caseDisplayName(p.lootCase.code, p.lootCase.name),
          }
        : null,
    };
  }
}
