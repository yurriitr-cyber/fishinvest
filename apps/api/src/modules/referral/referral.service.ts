import { Injectable } from '@nestjs/common';
import { Prisma } from '@rare-fish/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

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
}
