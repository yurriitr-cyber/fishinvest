import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate, parse, InitData } from '@telegram-apps/init-data-node';
import {
  getAdminConfiguredSecret,
  headerValue,
  secretsEqual,
  verifyAdminSession,
} from '../../security/security';

export const INIT_DATA_KEY = 'initData';

@Injectable()
export class TmaAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization || '';
    const [authType, authData] = String(authHeader).split(' ');

    if (authType !== 'tma' || !authData) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const configuredSecret = getAdminConfiguredSecret();

    const providedSecret = headerValue(request.headers, 'x-admin-secret');
    const sessionToken = headerValue(request.headers, 'x-admin-session');
    const tgRaw =
      headerValue(request.headers, 'x-admin-telegram-id') ||
      headerValue(request.headers, 'x-dev-telegram-id');

    // Preferred: short-lived signed session (no raw secret on every request)
    if (sessionToken) {
      const session = verifyAdminSession(sessionToken);
      if (!session) {
        throw new UnauthorizedException('Admin session expired or invalid');
      }
      request[INIT_DATA_KEY] = {
        authDate: new Date(),
        hash: 'admin-session',
        signature: 'admin-session',
        user: {
          id: session.tgId,
          firstName: 'Admin',
          username: 'admin',
        },
      } as unknown as InitData;
      return true;
    }

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
