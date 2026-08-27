import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

type Tx = Prisma.TransactionClient;

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
    const resolvedStart = startParam ?? initData.startParam ?? null;

    let existing = await this.prisma.db.user.findUnique({
      where: { telegramId },
      include: { gameBalance: true },
    });

    if (existing) {
      if (existing.status === 'BANNED') {
        throw new ForbiddenException('Account is banned');
      }

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

      // Friend opened the invite after already creating an account — still
      // attach the referrer once, as long as they were never referred before.
      if (!existing.referredById && resolvedStart) {
        await this.tryAttachReferral(existing, telegramId, resolvedStart);
      }

      const me = await this.buildMeResponse(existing.id, false);
      return { user: existing, me, isNewUser: false };
    }

    const referrer = await this.findReferrer(resolvedStart, telegramId);
    const initialBonus = Number(
      this.config.get('INITIAL_BONUS_AMOUNT') ?? DEFAULT_INITIAL_BONUS,
    );

    const user = await this.prisma.db.$transaction(async (tx) => {
      let referralCode = generateReferralCode();
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

      await this.ledger.creditInTransaction(tx, {
        userId: newUser.id,
        type: 'INITIAL_BONUS',
        amount: initialBonus,
        idempotencyKey: `initial:bonus:${newUser.id}`,
        referenceType: 'user',
        referenceId: newUser.id,
        metadata: { source: 'registration' },
      });

      if (referrer) {
        await this.creditReferralPair(tx, {
          referrer,
          referred: newUser,
          referralCode: referrer.referralCode,
        });
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

  private async findReferrer(
    startParam: string | null | undefined,
    inviteeTelegramId: bigint,
  ): Promise<User | null> {
    const refCode = parseReferralCode(startParam);
    if (!refCode) return null;

    const referrer = await this.prisma.db.user.findUnique({
      where: { referralCode: refCode },
    });
    if (!referrer) return null;
    if (referrer.telegramId === inviteeTelegramId) return null; // self-referral
    return referrer;
  }

  /**
   * Late binding for users who opened the app once without the invite, then
   * came back through a friend's link. Idempotent — only runs if referredById
   * is still null and no Referral row exists.
   */
  private async tryAttachReferral(
    user: User,
    telegramId: bigint,
    startParam: string,
  ): Promise<boolean> {
    if (this.config.get<string>('REFERRAL_ENABLED') === 'false') return false;

    const referrer = await this.findReferrer(startParam, telegramId);
    if (!referrer) return false;

    const already = await this.prisma.db.referral.findUnique({
      where: { referredId: user.id },
    });
    if (already) return false;

    try {
      await this.prisma.db.$transaction(async (tx) => {
        const claimed = await tx.user.updateMany({
          where: { id: user.id, referredById: null },
          data: { referredById: referrer.id, referredAt: new Date() },
        });
        if (claimed.count === 0) return;

        await this.creditReferralPair(tx, {
          referrer,
          referred: user,
          referralCode: referrer.referralCode,
        });
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }
  }

  private async creditReferralPair(
    tx: Tx,
    args: { referrer: User; referred: User; referralCode: string },
  ) {
    if (this.config.get<string>('REFERRAL_ENABLED') === 'false') return;

    const referralJoinBonus = Number(
      this.config.get('REFERRAL_JOIN_BONUS_AMOUNT') ?? DEFAULT_REFERRAL_JOIN_BONUS,
    );
    const referralBonus = Number(
      this.config.get('REFERRAL_BONUS_AMOUNT') ?? DEFAULT_REFERRAL_BONUS,
    );

    let joinLedgerId: string | undefined;
    try {
      const joinLedger = await this.ledger.creditInTransaction(tx, {
        userId: args.referred.id,
        type: 'REFERRAL_JOIN_BONUS',
        amount: referralJoinBonus,
        idempotencyKey: `referral:join:${args.referred.id}`,
        referenceType: 'referral',
        referenceId: args.referred.id,
        metadata: {
          referrerId: args.referrer.id,
          referralCode: args.referralCode,
        },
      });
      joinLedgerId = joinLedger.id;
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;
    }

    try {
      const referral = await tx.referral.create({
        data: {
          referrerId: args.referrer.id,
          referredId: args.referred.id,
          referralCode: args.referralCode,
          referrerBonusAmount: referralBonus,
          referredJoinBonusAmount: referralJoinBonus,
          status: 'COMPLETED',
          referredJoinLedgerId: joinLedgerId,
        },
      });

      const referrerLedger = await this.ledger.creditInTransaction(tx, {
        userId: args.referrer.id,
        type: 'REFERRAL_BONUS',
        amount: referralBonus,
        idempotencyKey: `referral:bonus:${args.referred.id}`,
        referenceType: 'referral',
        referenceId: referral.id,
        metadata: { referredUserId: args.referred.id },
      });

      await tx.referral.update({
        where: { id: referral.id },
        data: { referrerLedgerId: referrerLedger.id },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return;
      }
      throw e;
    }
  }

  /** Prefer https Mini App invite page (OG banner preview). Fallback: bot deep-link. */
  private buildReferralLink(referralCode: string): string {
    const web = (
      this.config.get<string>('WEBAPP_URL') ||
      this.config.get<string>('PUBLIC_WEB_URL') ||
      ''
    ).replace(/\/$/, '');
    if (web.startsWith('https://')) {
      return `${web}/invite/${referralCode}`;
    }
    const botUsername =
      this.config.get<string>('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '') ??
      'rarefishinvestment_bot';
    return `https://t.me/${botUsername}?start=ref_${referralCode}`;
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
      referralLink: this.buildReferralLink(user.referralCode),
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
