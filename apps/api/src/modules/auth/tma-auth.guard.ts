import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate, parse, InitData } from '@telegram-apps/init-data-node';
import { timingSafeEqual } from 'crypto';

export const INIT_DATA_KEY = 'initData';

function headerValue(headers: Record<string, unknown>, name: string): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  if (raw == null) return '';
  return String(raw).trim();
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class TmaAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization || '';
    const [authType, authData] = authHeader.split(' ');

    if (authType !== 'tma' || !authData) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const configuredSecret = (
      process.env.ADMIN_API_SECRET ||
      this.config.get<string>('ADMIN_API_SECRET') ||
      process.env.INTERNAL_API_SECRET ||
      this.config.get<string>('INTERNAL_API_SECRET') ||
      ''
    ).trim();

    const providedSecret = headerValue(request.headers, 'x-admin-secret');
    const tgRaw =
      headerValue(request.headers, 'x-admin-telegram-id') ||
      headerValue(request.headers, 'x-dev-telegram-id');

    // Desktop admin console path — never fall through to Telegram validate
    // when a secret header is present (avoids opaque "Invalid Telegram init data").
    if (providedSecret) {
      if (!configuredSecret || configuredSecret.length < 8) {
        throw new UnauthorizedException(
          'Admin secret is not configured on API (set ADMIN_API_SECRET or INTERNAL_API_SECRET)',
        );
      }
      if (!secretsEqual(providedSecret, configuredSecret)) {
        throw new UnauthorizedException(
          'Invalid admin secret (use INTERNAL_API_SECRET or ADMIN_API_SECRET from Railway → @rare-fish/api)',
        );
      }
      if (!tgRaw) {
        throw new UnauthorizedException('Missing Telegram id');
      }
      request[INIT_DATA_KEY] = {
        authDate: new Date(),
        hash: 'admin-secret',
        signature: 'admin-secret',
        user: {
          id: Number(tgRaw),
          firstName: 'Admin',
          username: 'admin',
        },
      } as unknown as InitData;
      return true;
    }

    if (!botToken || botToken === 'your_bot_token_here') {
      if (process.env.NODE_ENV === 'development') {
        const devUserId = headerValue(request.headers, 'x-dev-telegram-id');
        if (devUserId) {
          request[INIT_DATA_KEY] = {
            authDate: new Date(),
            hash: 'dev',
            signature: 'dev',
            user: {
              id: Number(devUserId),
              firstName: 'Dev',
              username: 'dev_user',
            },
          } as unknown as InitData;
          return true;
        }
      }
      throw new UnauthorizedException('Telegram bot token not configured');
    }

    try {
      validate(authData, botToken, { expiresIn: 3600 });
      const initData = parse(authData);
      request[INIT_DATA_KEY] = initData;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid Telegram init data');
    }
  }
}
