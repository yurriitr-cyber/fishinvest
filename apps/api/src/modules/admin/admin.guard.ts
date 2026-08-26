import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InitData } from '@telegram-apps/init-data-node';
import { PrismaService } from '../prisma/prisma.service';
import { INIT_DATA_KEY, TmaAuthGuard } from '../auth/tma-auth.guard';
import { parseAdminTelegramIds } from './admin-ids';

export const ADMIN_USER_KEY = 'adminUser';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly tma: TmaAuthGuard,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = this.tma.canActivate(context);
    if (!ok) return false;

    const request = context.switchToHttp().getRequest();
    const initData = request[INIT_DATA_KEY] as InitData | undefined;
    const telegramId = initData?.user?.id;
    if (!telegramId) throw new UnauthorizedException('No telegram user');

    let user = await this.prisma.db.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    const adminIds = parseAdminTelegramIds(
      this.config.get<string>('ADMIN_TELEGRAM_IDS'),
    );

    if (user && !user.isAdmin && adminIds.includes(String(telegramId))) {
      user = await this.prisma.db.user.update({
        where: { id: user.id },
        data: { isAdmin: true },
      });
    }

    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    request[ADMIN_USER_KEY] = user;
    return true;
  }
}
