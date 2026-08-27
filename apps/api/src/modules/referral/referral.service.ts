import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifyService } from '../joint/telegram-notify.service';

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tg: TelegramNotifyService,
  ) {}

  async getStats(userId: string) {
    const [referrals, totalBonus] = await Promise.all([
      this.prisma.db.referral.findMany({
        where: { referrerId: userId, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        include: {
          referred: {
            select: {
              username: true,
              firstName: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.db.referral.aggregate({
        where: { referrerId: userId, status: 'COMPLETED' },
        _sum: { referrerBonusAmount: true },
        _count: true,
      }),
    ]);

    return {
      count: totalBonus._count,
      totalBonusEarned: (
        totalBonus._sum.referrerBonusAmount ?? new Prisma.Decimal(0)
      ).toFixed(4),
      referrals: referrals.map((r) => ({
        id: r.id,
        username: r.referred.username,
        firstName: r.referred.firstName,
        bonus: r.referrerBonusAmount.toFixed(4),
        joinedAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Builds a prepared inline photo message so the Mini App can open Telegram's
   * native share picker (WebApp.shareMessage) and send to chosen chats.
   */
  async prepareShareCard(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const botUsername = (
      this.config.get<string>('TELEGRAM_BOT_USERNAME') ||
      'rarefishinvestment_bot'
    ).replace(/^@/, '');
    const web = (
      this.config.get<string>('WEBAPP_URL') ||
      this.config.get<string>('PUBLIC_WEB_URL') ||
      ''
    ).replace(/\/$/, '');
    if (!web.startsWith('https://')) {
      throw new BadRequestException(
        'WEBAPP_URL must be https for invite photo',
      );
    }

    const deepLink = `https://t.me/${botUsername}?start=ref_${user.referralCode}`;
    const photoUrl = `${web}/og/invite.jpg?v=2`;
    const caption = [
      '<b>Инвестируй в редких рыб со мной</b>',
      '',
      'Получай <b>50 CR</b> по моей ссылке!',
      '',
      deepLink,
    ].join('\n');

    const preparedId = await this.tg.savePreparedInlineMessage(
      user.telegramId,
      {
        type: 'photo',
        id: `rf-invite-${user.referralCode}-${Date.now()}`,
        photo_url: photoUrl,
        thumbnail_url: photoUrl,
        photo_width: 1024,
        photo_height: 481,
        title: 'Rare Fish',
        description: 'Получай 50 CR по моей ссылке!',
        caption,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🐟 Открыть Rare Fish', url: deepLink }],
          ],
        },
      },
      {
        allowUserChats: true,
        allowGroupChats: true,
        allowChannelChats: true,
        allowBotChats: false,
      },
    );

    if (!preparedId) {
      throw new BadRequestException(
        'Не удалось подготовить сообщение. Обнови Telegram и попробуй снова.',
      );
    }

    return {
      ok: true as const,
      preparedMessageId: preparedId,
      deepLink,
      inviteUrl: `${web}/invite/${user.referralCode}`,
    };
  }
}
