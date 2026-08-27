import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { randomUUID } from 'crypto';
import { fishDisplayName } from '../fish/fish-names';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from './telegram-notify.service';

function htmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

@Injectable()
export class JointService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly tg: TelegramNotifyService,
  ) {}

  /** Friends = people you invited + people who invited you. */
  async listFriends(userId: string) {
    const [outgoing, incoming, me] = await Promise.all([
      this.prisma.db.referral.findMany({
        where: { referrerId: userId },
        include: {
          referred: {
            select: {
              id: true,
              username: true,
              firstName: true,
            },
          },
        },
      }),
      this.prisma.db.referral.findMany({
        where: { referredId: userId },
        include: {
          referrer: {
            select: {
              id: true,
              username: true,
              firstName: true,
            },
          },
        },
      }),
      this.prisma.db.user.findUnique({
        where: { id: userId },
        select: {
          referredBy: {
            select: {
              id: true,
              username: true,
              firstName: true,
            },
          },
          referrals: {
            select: {
              id: true,
              username: true,
              firstName: true,
            },
          },
        },
      }),
    ]);

    const map = new Map<
      string,
      { id: string; username: string | null; firstName: string | null }
    >();
    const add = (u?: { id: string; username: string | null; firstName: string | null } | null) => {
      if (!u || u.id === userId) return;
      map.set(u.id, {
        id: u.id,
        username: u.username,
        firstName: u.firstName,
      });
    };
    for (const r of outgoing) add(r.referred);
    for (const r of incoming) add(r.referrer);
    add(me?.referredBy);
    for (const u of me?.referrals ?? []) add(u);
    return [...map.values()];
  }

  private async resolvePartner(
    initiatorId: string,
    partnerId?: string,
    partnerUsername?: string,
  ) {
    const username = (partnerUsername || '').replace(/^@/, '').trim();
    if (!partnerId && !username) {
      throw new BadRequestException('Выберите друга или укажите @username');
    }

    const partner = partnerId
      ? await this.prisma.db.user.findUnique({
          where: { id: partnerId },
          include: { gameBalance: true },
        })
      : await this.prisma.db.user.findFirst({
          where: { username: { equals: username, mode: 'insensitive' } },
          include: { gameBalance: true },
        });

    if (!partner) {
      throw new NotFoundException(
        'Друг не найден. Он должен хотя бы раз открыть приложение, либо укажите точный @username.',
      );
    }
    if (partner.id === initiatorId) {
      throw new BadRequestException('Нельзя пригласить самого себя');
    }
    return partner;
  }

  async listMine(userId: string) {
    const [incoming, outgoing, holdings] = await Promise.all([
      this.prisma.db.jointProposal.findMany({
        where: { partnerId: userId, status: 'PENDING' },
        include: {
          fish: true,
          initiator: {
            select: { id: true, username: true, firstName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.jointProposal.findMany({
        where: { initiatorId: userId, status: 'PENDING' },
        include: {
          fish: true,
          partner: {
            select: { id: true, username: true, firstName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.jointHoldingMember.findMany({
        where: { userId },
        include: {
          holding: {
            include: {
              fish: true,
              members: {
                include: {
                  user: {
                    select: { id: true, username: true, firstName: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      incoming: incoming.map((p) => this.serializeProposal(p)),
      outgoing: outgoing.map((p) => this.serializeProposal(p)),
      holdings: holdings.map((m) => this.serializeHolding(m.holding, userId)),
    };
  }

  async proposeBuy(
    initiatorId: string,
    fishId: string,
    quantity: number,
    partnerId?: string,
    partnerUsername?: string,
  ) {
    const qtyInt = Math.floor(Number(quantity));
    if (!Number.isFinite(qtyInt) || qtyInt < 2 || qtyInt % 2 !== 0) {
      throw new BadRequestException(
        'Для совместной покупки нужно чётное количество (минимум 2)',
      );
    }

    const partner = await this.resolvePartner(
      initiatorId,
      partnerId,
      partnerUsername,
    );

    const [fish, initiator] = await Promise.all([
      this.prisma.db.fish.findUnique({ where: { id: fishId } }),
      this.prisma.db.user.findUnique({
        where: { id: initiatorId },
        include: { gameBalance: true },
      }),
    ]);
    if (!fish?.isActive) throw new NotFoundException('Fish not found');
    if (fish.isFrozen) {
      throw new BadRequestException('Trading for this fish is frozen');
    }
    if (!initiator) throw new NotFoundException('User not found');
    if (fish.availableSupply < qtyInt) {
      throw new BadRequestException(
        fish.availableSupply <= 0
          ? 'Sold out'
          : `Only ${fish.availableSupply} available`,
      );
    }

    const unitPrice = fish.currentPrice;
    const totalAmount = unitPrice.mul(qtyInt);
    const half = totalAmount.div(2);
    const initiatorBal = initiator.gameBalance?.available ?? new Prisma.Decimal(0);
    const partnerBal = partner.gameBalance?.available ?? new Prisma.Decimal(0);
    if (initiatorBal.lt(half)) {
      throw new BadRequestException('Недостаточно кредитов для вашей половины');
    }
    if (partnerBal.lt(half)) {
      throw new BadRequestException(
        'У друга недостаточно кредитов для половины сделки',
      );
    }

    const pending = await this.prisma.db.jointProposal.findFirst({
      where: {
        status: 'PENDING',
        kind: 'BUY',
        OR: [
          { initiatorId, partnerId: partner.id, fishId },
          { initiatorId: partner.id, partnerId: initiatorId, fishId },
        ],
      },
    });
    if (pending) {
      throw new ConflictException('Уже есть активное приглашение по этой рыбе');
    }

    const key = `joint-buy:${initiatorId}:${partner.id}:${fishId}:${randomUUID()}`;
    const proposal = await this.prisma.db.jointProposal.create({
      data: {
        kind: 'BUY',
        status: 'PENDING',
        initiatorId,
        partnerId: partner.id,
        fishId,
        quantity: qtyInt,
        unitPrice,
        totalAmount,
        idempotencyKey: key,
      },
      include: {
        fish: true,
        initiator: {
          select: { id: true, username: true, firstName: true },
        },
      },
    });

    const label = htmlEscape(fishDisplayName(fish.symbol, fish.name));
    const who = htmlEscape(
      initiator.username || initiator.firstName || 'Друг',
    );
    const msgId = await this.tg.sendMessage(
      partner.telegramId,
      [
        `🤝 <b>Совместная покупка</b>`,
        '',
        `<b>${who}</b> предлагает купить <b>${label}</b> вместе.`,
        `Количество: <b>${qtyInt}</b> (вам <b>${qtyInt / 2}</b>)`,
        `Ваша доля: <b>${half.toFixed(2)} CR</b> (50%)`,
        `Цена сейчас: <b>${unitPrice.toFixed(2)} CR</b>`,
        '',
        'Примите или отклоните ниже. Можно также открыть Активы в приложении.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            { text: '✅ Принять', callback_data: `jb_a:${proposal.id}` },
            { text: '❌ Отклонить', callback_data: `jb_d:${proposal.id}` },
          ],
        ],
      },
    );
    if (msgId != null) {
      await this.prisma.db.jointProposal.update({
        where: { id: proposal.id },
        data: { telegramMsgId: BigInt(msgId) },
      });
    }

    return this.serializeProposal(proposal);
  }

  async proposeSell(initiatorId: string, holdingId: string) {
    const holding = await this.prisma.db.jointHolding.findUnique({
      where: { id: holdingId },
      include: {
        fish: true,
        members: {
          include: {
            user: {
              select: {
                id: true,
                telegramId: true,
                username: true,
                firstName: true,
              },
            },
          },
        },
      },
    });
    if (!holding) throw new NotFoundException('Совместный актив не найден');
    if (holding.fish.isFrozen) {
      throw new BadRequestException('Trading for this fish is frozen');
    }

    const me = holding.members.find((m) => m.userId === initiatorId);
    if (!me) throw new ForbiddenException('Вы не участник этой доли');
    const partner = holding.members.find((m) => m.userId !== initiatorId);
    if (!partner) throw new BadRequestException('Партнёр не найден');

    const pending = await this.prisma.db.jointProposal.findFirst({
      where: { holdingId, status: 'PENDING', kind: 'SELL' },
    });
    if (pending) {
      throw new ConflictException('Уже есть запрос на продажу');
    }

    const unitPrice = holding.fish.currentPrice;
    const totalAmount = unitPrice.mul(holding.quantity);
    const key = `joint-sell:${holdingId}:${randomUUID()}`;

    const proposal = await this.prisma.db.jointProposal.create({
      data: {
        kind: 'SELL',
        status: 'PENDING',
        initiatorId,
        partnerId: partner.userId,
        fishId: holding.fishId,
        holdingId: holding.id,
        quantity: holding.quantity,
        unitPrice,
        totalAmount,
        idempotencyKey: key,
      },
      include: {
        fish: true,
        initiator: {
          select: { id: true, username: true, firstName: true },
        },
      },
    });

    const label = htmlEscape(fishDisplayName(holding.fish.symbol, holding.fish.name));
    const who = htmlEscape(me.user.username || me.user.firstName || 'Друг');
    const half = totalAmount.div(2);
    const msgId = await this.tg.sendMessage(
      partner.user.telegramId,
      [
        `🤝 <b>Совместная продажа</b>`,
        '',
        `<b>${who}</b> предлагает продать <b>${label}</b> вместе.`,
        `Количество: <b>${holding.quantity.toFixed(0)}</b>`,
        `Вам ~<b>${half.toFixed(2)} CR</b> (50%)`,
        '',
        'Оба должны согласиться. Примите или отклоните. Можно также открыть Активы.',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            { text: '✅ Согласен продать', callback_data: `js_a:${proposal.id}` },
            { text: '❌ Отклонить', callback_data: `js_d:${proposal.id}` },
          ],
        ],
      },
    );
    if (msgId != null) {
      await this.prisma.db.jointProposal.update({
        where: { id: proposal.id },
        data: { telegramMsgId: BigInt(msgId) },
      });
    }

    return this.serializeProposal(proposal);
  }

  async respondFromTelegram(
    telegramUserId: number,
    proposalId: string,
    accept: boolean,
  ) {
    const user = await this.prisma.db.user.findUnique({
      where: { telegramId: BigInt(telegramUserId) },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.respond(user.id, proposalId, accept);
  }

  async respond(userId: string, proposalId: string, accept: boolean) {
    const proposal = await this.prisma.db.jointProposal.findUnique({
      where: { id: proposalId },
      include: {
        fish: true,
        initiator: true,
        partner: true,
        holding: { include: { members: true, fish: true } },
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== 'PENDING') {
      throw new ConflictException('Приглашение уже закрыто');
    }
    if (proposal.partnerId !== userId) {
      throw new ForbiddenException('Только партнёр может ответить');
    }

    if (!accept) {
      const updated = await this.prisma.db.jointProposal.update({
        where: { id: proposalId },
        data: { status: 'DECLINED', resolvedAt: new Date() },
        include: {
          fish: true,
          initiator: {
            select: { id: true, username: true, firstName: true },
          },
        },
      });
      await this.tg.sendMessage(
        proposal.initiator.telegramId,
        `❌ Друг отклонил совместн${proposal.kind === 'BUY' ? 'ую покупку' : 'ую продажу'} <b>${htmlEscape(fishDisplayName(proposal.fish.symbol, proposal.fish.name))}</b>.`,
      );
      if (proposal.telegramMsgId) {
        await this.tg.editMessage(
          proposal.partner.telegramId,
          Number(proposal.telegramMsgId),
          `❌ Отклонено: <b>${htmlEscape(fishDisplayName(proposal.fish.symbol, proposal.fish.name))}</b>`,
        );
      }
      return this.serializeProposal(updated);
    }

    if (proposal.kind === 'BUY') {
      return this.executeBuy(proposal);
    }
    return this.executeSell(proposal);
  }

  private async executeBuy(proposal: {
    id: string;
    initiatorId: string;
    partnerId: string;
    fishId: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    idempotencyKey: string;
    telegramMsgId: bigint | null;
    fish: { symbol: string; name: string };
    initiator: { telegramId: bigint };
    partner: { telegramId: bigint };
  }) {
    const qtyInt = Math.floor(Number(proposal.quantity));
    const halfQty = qtyInt / 2;

    try {
      await this.prisma.db.$transaction(async (tx) => {
        const locked = await tx.jointProposal.updateMany({
          where: { id: proposal.id, status: 'PENDING' },
          data: {
            status: 'ACCEPTED',
            partnerAccepted: true,
            resolvedAt: new Date(),
          },
        });
        if (locked.count === 0) {
          throw new ConflictException('Приглашение уже закрыто');
        }

        const fish = await tx.fish.findUnique({ where: { id: proposal.fishId } });
        if (!fish?.isActive || fish.isFrozen) {
          throw new BadRequestException('Рыба недоступна');
        }

        const reserved = await tx.fish.updateMany({
          where: { id: proposal.fishId, availableSupply: { gte: qtyInt } },
          data: { availableSupply: { decrement: qtyInt } },
        });
        if (reserved.count === 0) {
          throw new BadRequestException('Sold out');
        }

        // Use live price for fairness, but charge at proposal snapshot if higher for buyers? Use live.
        const unitPrice = fish.currentPrice;
        const totalAmount = unitPrice.mul(qtyInt);
        const eachPay = totalAmount.div(2);
        const eachQty = new Prisma.Decimal(halfQty);

        await this.ledger.debitInTransaction(tx, {
          userId: proposal.initiatorId,
          type: 'BUY_FISH',
          amount: eachPay,
          idempotencyKey: `ledger:${proposal.idempotencyKey}:a`,
          referenceType: 'joint_proposal',
          referenceId: proposal.id,
          metadata: { side: 'JOINT_BUY', role: 'initiator' },
        });
        await this.ledger.debitInTransaction(tx, {
          userId: proposal.partnerId,
          type: 'BUY_FISH',
          amount: eachPay,
          idempotencyKey: `ledger:${proposal.idempotencyKey}:b`,
          referenceType: 'joint_proposal',
          referenceId: proposal.id,
          metadata: { side: 'JOINT_BUY', role: 'partner' },
        });

        const holding = await tx.jointHolding.create({
          data: {
            fishId: proposal.fishId,
            quantity: qtyInt,
            avgBuyPrice: unitPrice,
            totalInvested: totalAmount,
            members: {
              create: [
                {
                  userId: proposal.initiatorId,
                  quantity: eachQty,
                  totalInvested: eachPay,
                },
                {
                  userId: proposal.partnerId,
                  quantity: eachQty,
                  totalInvested: eachPay,
                },
              ],
            },
          },
        });

        await tx.trade.create({
          data: {
            userId: proposal.initiatorId,
            fishId: proposal.fishId,
            side: 'BUY',
            quantity: eachQty,
            unitPrice,
            totalAmount: eachPay,
            idempotencyKey: `${proposal.idempotencyKey}:trade:a`,
          },
        });
        await tx.trade.create({
          data: {
            userId: proposal.partnerId,
            fishId: proposal.fishId,
            side: 'BUY',
            quantity: eachQty,
            unitPrice,
            totalAmount: eachPay,
            idempotencyKey: `${proposal.idempotencyKey}:trade:b`,
          },
        });

        await tx.jointProposal.update({
          where: { id: proposal.id },
          data: { holdingId: holding.id, unitPrice, totalAmount },
        });
      });
    } catch (e) {
      await this.prisma.db.jointProposal.updateMany({
        where: { id: proposal.id, status: 'ACCEPTED' },
        data: { status: 'CANCELLED' },
      });
      throw e;
    }

    const label = htmlEscape(fishDisplayName(proposal.fish.symbol, proposal.fish.name));
    await this.tg.sendMessage(
      proposal.initiator.telegramId,
      `✅ Друг принял! Совместно купили <b>${label}</b> ×${qtyInt}. Доля каждого: ${halfQty}.`,
    );
    if (proposal.telegramMsgId) {
      await this.tg.editMessage(
        proposal.partner.telegramId,
        Number(proposal.telegramMsgId),
        `✅ Принято: совместная покупка <b>${label}</b> ×${qtyInt}`,
      );
    }

    const done = await this.prisma.db.jointProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: {
        fish: true,
        initiator: {
          select: { id: true, username: true, firstName: true },
        },
      },
    });
    return this.serializeProposal(done);
  }

  private async executeSell(proposal: {
    id: string;
    initiatorId: string;
    partnerId: string;
    fishId: string;
    holdingId: string | null;
    quantity: Prisma.Decimal;
    idempotencyKey: string;
    telegramMsgId: bigint | null;
    fish: { symbol: string; name: string };
    initiator: { telegramId: bigint };
    partner: { telegramId: bigint };
    holding: {
      id: string;
      quantity: Prisma.Decimal;
      avgBuyPrice: Prisma.Decimal;
      members: Array<{
        userId: string;
        quantity: Prisma.Decimal;
        totalInvested: Prisma.Decimal;
      }>;
      fish: { id: string; currentPrice: Prisma.Decimal; isFrozen: boolean };
    } | null;
  }) {
    if (!proposal.holdingId || !proposal.holding) {
      throw new BadRequestException('Нет актива для продажи');
    }
    const holding = proposal.holding;
    if (holding.fish.isFrozen) {
      throw new BadRequestException('Trading for this fish is frozen');
    }

    const unitPrice = holding.fish.currentPrice;
    const totalProceeds = unitPrice.mul(holding.quantity);

    await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.jointProposal.updateMany({
        where: { id: proposal.id, status: 'PENDING' },
        data: {
          status: 'ACCEPTED',
          partnerAccepted: true,
          resolvedAt: new Date(),
          unitPrice,
          totalAmount: totalProceeds,
        },
      });
      if (locked.count === 0) {
        throw new ConflictException('Приглашение уже закрыто');
      }

      for (const m of holding.members) {
        const share = holding.quantity.gt(0)
          ? m.quantity.div(holding.quantity)
          : new Prisma.Decimal(0.5);
        const credit = totalProceeds.mul(share);
        const cost = m.totalInvested;
        const realized = credit.sub(cost);

        await this.ledger.creditInTransaction(tx, {
          userId: m.userId,
          type: 'SELL_FISH',
          amount: credit,
          idempotencyKey: `ledger:${proposal.idempotencyKey}:${m.userId}`,
          referenceType: 'joint_proposal',
          referenceId: proposal.id,
          metadata: { side: 'JOINT_SELL' },
        });

        await tx.trade.create({
          data: {
            userId: m.userId,
            fishId: proposal.fishId,
            side: 'SELL',
            quantity: m.quantity,
            unitPrice,
            totalAmount: credit,
            realizedPnl: realized,
            idempotencyKey: `${proposal.idempotencyKey}:trade:${m.userId}`,
          },
        });
      }

      await tx.fish.update({
        where: { id: proposal.fishId },
        data: {
          availableSupply: { increment: Math.floor(Number(holding.quantity)) },
        },
      });

      await tx.jointHoldingMember.deleteMany({
        where: { holdingId: holding.id },
      });
      await tx.jointHolding.delete({ where: { id: holding.id } });
    });

    const label = htmlEscape(fishDisplayName(proposal.fish.symbol, proposal.fish.name));
    const half = totalProceeds.div(2).toFixed(2);
    await this.tg.sendMessage(
      proposal.initiator.telegramId,
      `✅ Совместная продажа <b>${label}</b> прошла. Вам ~<b>${half} CR</b>.`,
    );
    if (proposal.telegramMsgId) {
      await this.tg.editMessage(
        proposal.partner.telegramId,
        Number(proposal.telegramMsgId),
        `✅ Продано вместе: <b>${label}</b>. Вам ~<b>${half} CR</b>.`,
      );
    }

    const done = await this.prisma.db.jointProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: {
        fish: true,
        initiator: {
          select: { id: true, username: true, firstName: true },
        },
      },
    });
    return this.serializeProposal(done);
  }

  private serializeProposal(p: {
    id: string;
    kind: string;
    status: string;
    initiatorId: string;
    partnerId: string;
    fishId: string;
    holdingId?: string | null;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    createdAt: Date;
    fish: { symbol: string; name: string; imageUrl: string | null; rarity: string };
    initiator?: { id: string; username: string | null; firstName: string | null };
    partner?: { id: string; username: string | null; firstName: string | null };
  }) {
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      initiatorId: p.initiatorId,
      partnerId: p.partnerId,
      fishId: p.fishId,
      holdingId: p.holdingId ?? null,
      quantity: p.quantity.toFixed(4),
      unitPrice: p.unitPrice.toFixed(4),
      totalAmount: p.totalAmount.toFixed(4),
      halfAmount: p.totalAmount.div(2).toFixed(4),
      createdAt: p.createdAt.toISOString(),
      fish: {
        symbol: p.fish.symbol,
        name: fishDisplayName(p.fish.symbol, p.fish.name),
        imageUrl: p.fish.imageUrl || `/fish/${p.fish.symbol}.jpg`,
        rarity: p.fish.rarity,
      },
      initiator: p.initiator ?? null,
      partner: p.partner ?? null,
    };
  }

  private serializeHolding(
    h: {
      id: string;
      quantity: Prisma.Decimal;
      avgBuyPrice: Prisma.Decimal;
      totalInvested: Prisma.Decimal;
      fish: {
        id: string;
        symbol: string;
        name: string;
        rarity: string;
        imageUrl: string | null;
        currentPrice: Prisma.Decimal;
      };
      members: Array<{
        userId: string;
        quantity: Prisma.Decimal;
        totalInvested: Prisma.Decimal;
        user: { id: string; username: string | null; firstName: string | null };
      }>;
    },
    viewerId: string,
  ) {
    const mine = h.members.find((m) => m.userId === viewerId);
    const partner = h.members.find((m) => m.userId !== viewerId);
    const value = h.fish.currentPrice.mul(h.quantity);
    const myValue = h.fish.currentPrice.mul(mine?.quantity ?? 0);
    return {
      id: h.id,
      fishId: h.fish.id,
      symbol: h.fish.symbol,
      name: fishDisplayName(h.fish.symbol, h.fish.name),
      rarity: h.fish.rarity,
      imageUrl: h.fish.imageUrl || `/fish/${h.fish.symbol}.jpg`,
      quantity: h.quantity.toFixed(4),
      myQuantity: (mine?.quantity ?? new Prisma.Decimal(0)).toFixed(4),
      avgBuyPrice: h.avgBuyPrice.toFixed(4),
      totalInvested: h.totalInvested.toFixed(4),
      myInvested: (mine?.totalInvested ?? new Prisma.Decimal(0)).toFixed(4),
      currentPrice: h.fish.currentPrice.toFixed(4),
      currentValue: value.toFixed(4),
      myValue: myValue.toFixed(4),
      partner: partner
        ? {
            id: partner.user.id,
            username: partner.user.username,
            firstName: partner.user.firstName,
          }
        : null,
    };
  }
}
