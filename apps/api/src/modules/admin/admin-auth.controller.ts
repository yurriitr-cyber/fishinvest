import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { IsNumber, IsString, MinLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { parseAdminTelegramIds } from '../admin/admin-ids';
import {
  checkAdminAuthRate,
  clientIp,
  createAdminSession,
  getAdminConfiguredSecret,
  secretsEqual,
} from '../../security/security';

class AdminLoginDto {
  @IsNumber() telegramId!: number;
  @IsString() @MinLength(8) secret!: string;
}

/**
 * Public admin login — exchanges long-lived secret for a short session token.
 * Rate-limited per IP. Does not require TMA auth.
 */
@Controller('admin-auth')
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: AdminLoginDto,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ): Promise<{ token: string; expiresAt: string; telegramId: string }> {
    const ip = clientIp(req);
    const rate = checkAdminAuthRate(ip);
    if (!rate.ok) {
      throw new UnauthorizedException(
        `Too many login attempts. Retry in ${rate.retryAfterSec}s`,
      );
    }

    const configured = getAdminConfiguredSecret();
    if (!configured || configured.length < 8) {
      throw new UnauthorizedException('Admin secret is not configured on API');
    }
    if (!secretsEqual(dto.secret.trim(), configured)) {
      throw new UnauthorizedException('Invalid admin secret');
    }

    const adminIds = parseAdminTelegramIds(
      this.config.get<string>('ADMIN_TELEGRAM_IDS'),
    );
    if (!adminIds.includes(String(dto.telegramId))) {
      throw new ForbiddenException(
        'Telegram ID is not in ADMIN_TELEGRAM_IDS',
      );
    }

    const user = await this.prisma.db.user.findUnique({
      where: { telegramId: BigInt(dto.telegramId) },
    });
    if (user?.status === 'BANNED') {
      throw new ForbiddenException('User is banned');
    }

    const { token, expiresAt } = createAdminSession(dto.telegramId);
    return {
      token,
      expiresAt,
      telegramId: String(dto.telegramId),
    };
  }
}
