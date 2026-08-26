import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InitData } from '@telegram-apps/init-data-node';
import { Prisma, User } from '@rare-fish/db';
import {
  DEFAULT_INITIAL_BONUS,
  DEFAULT_REFERRAL_BONUS,
  DEFAULT_REFERRAL_JOIN_BONUS,
  generateReferralCode,
  parseReferralCode,
} from '@rare-fish/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { parseAdminTelegramIds } from '../admin/admin-ids';

export interface MeResponse {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  balance: string;
  referralCode: string;
  referralLink: string;
  isNewUser: boolean;
  isAdmin: boolean;
  welcomeBonus: string;
  referralJoinBonus: string | null;
  portfolioValue: string;
  referredBy: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
  ) {}

  async getOrCreateFromInitData(
    initData: InitData,
    startParam?: string | null,
  ): Promise<{ user: User; me: MeResponse; isNewUser: boolean }> {
    const tgUser = initData.user;
    if (!tgUser?.id) {
      throw new BadRequestException('Telegram user not found in init data');
    }

    const telegramId = BigInt(tgUser.id);
    const adminIds = parseAdminTelegramIds(
      this.config.get<string>('ADMIN_TELEGRAM_IDS'),
    );
    const shouldBeAdmin = adminIds.includes(String(tgUser.id));

    let existing = await this.prisma.db.user.findUnique({
      where: { telegramId },
      include: { gameBalance: true },
    });

    if (existing) {
      await this.prisma.db.user.update({
        where: { id: existing.id },
        data: {
          username: tgUser.username ?? null,
          firstName: tgUser.firstName ?? null,
          lastName: tgUser.lastName ?? null,
          languageCode: tgUser.languageCode ?? null,
          photoUrl: tgUser.photoUrl ?? null,
          lastSeenAt: new Date(),
          ...(shouldBeAdmin && !existing.isAdmin ? { isAdmin: true } : {}),
        },
      });

      const me = await this.buildMeResponse(existing.id, false);
      return { user: existing, me, isNewUser: false };
    }

    const refCode = parseReferralCode(startParam ?? initData.startParam);
    let referrer: User | null = null;

    if (refCode) {
      referrer = await this.prisma.db.user.findUnique({
        where: { referralCode: refCode },
      });
      if (referrer && referrer.telegramId === telegramId) {
        referrer = null; // self-referral blocked
      }
    }

    const initialBonus = Number(
      this.config.get('INITIAL_BONUS_AMOUNT') ?? DEFAULT_INITIAL_BONUS,
    );
    const referralJoinBonus = Number(
      this.config.get('REFERRAL_JOIN_BONUS_AMOUNT') ?? DEFAULT_REFERRAL_JOIN_BONUS,
    );
    const referralBonus = Number(
      this.config.get('REFERRAL_BONUS_AMOUNT') ?? DEFAULT_REFERRAL_BONUS,
    );
    const referralEnabled = this.config.get<string>('REFERRAL_ENABLED') !== 'false';

    const user = await this.prisma.db.$transaction(async (tx) => {
      let referralCode = generateReferralCode();
      // Ensure unique referral code
      while (await tx.user.findUnique({ where: { referralCode } })) {
        referralCode = generateReferralCode();
      }

      const newUser = await tx.user.create({
        data: {
          telegramId,
          username: tgUser.username ?? null,
          firstName: tgUser.firstName ?? null,
          lastName: tgUser.lastName ?? null,
          languageCode: tgUser.languageCode ?? null,
          photoUrl: tgUser.photoUrl ?? null,
          referralCode,
          referredById: referrer?.id ?? null,
          referredAt: referrer ? new Date() : null,
          lastSeenAt: new Date(),
          isAdmin: shouldBeAdmin,
          gameBalance: { create: { available: 0 } },
        },
      });

      // Initial bonus +200
      await this.ledger.creditInTransaction(tx, {
        userId: newUser.id,
        type: 'INITIAL_BONUS',
        amount: initialBonus,
        idempotencyKey: `initial:bonus:${newUser.id}`,
        referenceType: 'user',
        referenceId: newUser.id,
        metadata: { source: 'registration' },
      });

      let joinLedgerId: string | undefined;

      // Referral join bonus +50 for referred user
      if (referrer && referralEnabled) {
        try {
          const joinLedger = await this.ledger.creditInTransaction(tx, {
            userId: newUser.id,
            type: 'REFERRAL_JOIN_BONUS',
            amount: referralJoinBonus,
            idempotencyKey: `referral:join:${newUser.id}`,
            referenceType: 'referral',
            referenceId: newUser.id,
            metadata: { referrerId: referrer.id, referralCode: refCode },
          });
          joinLedgerId = joinLedger.id;
        } catch (e) {
          if (!(e instanceof ConflictException)) throw e;
        }

        // Create referral record + referrer bonus +300
        try {
          const referral = await tx.referral.create({
            data: {
              referrerId: referrer.id,
              referredId: newUser.id,
              referralCode: refCode!,
              referrerBonusAmount: referralBonus,
              referredJoinBonusAmount: referralJoinBonus,
              status: 'COMPLETED',
              referredJoinLedgerId: joinLedgerId,
            },
          });

          const referrerLedger = await this.ledger.creditInTransaction(tx, {
            userId: referrer.id,
            type: 'REFERRAL_BONUS',
            amount: referralBonus,
            idempotencyKey: `referral:bonus:${newUser.id}`,
            referenceType: 'referral',
            referenceId: referral.id,
            metadata: { referredUserId: newUser.id },
          });

          await tx.referral.update({
            where: { id: referral.id },
            data: { referrerLedgerId: referrerLedger.id },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            // duplicate referral — skip
          } else {
            throw e;
          }
        }
      }

      await tx.user.update({
        where: { id: newUser.id },
        data: { initialBonusGrantedAt: new Date() },
      });

      return newUser;
    });

    const me = await this.buildMeResponse(user.id, true);
    return { user, me, isNewUser: true };
  }

  async buildMeResponse(
    userId: string,
    isNewUser = false,
  ): Promise<MeResponse> {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        gameBalance: true,
        referredBy: { select: { username: true, firstName: true } },
      },
    });

    const balance = user.gameBalance?.available ?? new Prisma.Decimal(0);
    const botUsername =
      this.config.get<string>('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '') ??
      'rarefishinvestment_bot';
    const miniAppName =
      this.config.get<string>('TELEGRAM_MINI_APP_NAME') ?? 'app';

    const [joinBonusEntry, positions] = await Promise.all([
      this.prisma.db.gameBalanceLedger.findUnique({
        where: { idempotencyKey: `referral:join:${userId}` },
      }),
      this.prisma.db.portfolioPosition.findMany({
        where: { userId },
        include: { fish: { select: { currentPrice: true } } },
      }),
    ]);

    const portfolioValue = positions.reduce(
      (sum, p) => sum.add(p.fish.currentPrice.mul(p.quantity)),
      new Prisma.Decimal(0),
    );

    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      username: user.username,
      firstName: user.firstName,
      balance: balance.toFixed(4),
      referralCode: user.referralCode,
      referralLink: `https://t.me/${botUsername}/${miniAppName}?startapp=ref_${user.referralCode}`,
      isNewUser,
      isAdmin: user.isAdmin,
      welcomeBonus: Number(
        this.config.get('INITIAL_BONUS_AMOUNT') ?? DEFAULT_INITIAL_BONUS,
      ).toString(),
      referralJoinBonus: joinBonusEntry
        ? joinBonusEntry.amount.toFixed(4)
        : null,
      portfolioValue: portfolioValue.toFixed(4),
      referredBy:
        user.referredBy?.username ?? user.referredBy?.firstName ?? null,
    };
  }
}
