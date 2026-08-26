import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate, parse, InitData } from '@telegram-apps/init-data-node';

export const INIT_DATA_KEY = 'initData';

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
    const adminSecret = this.config.get<string>('ADMIN_API_SECRET');
    const providedSecret =
      (request.headers['x-admin-secret'] as string | undefined) || '';

    // Desktop admin console: shared secret + telegram id allowlist
    if (
      adminSecret &&
      adminSecret.length >= 8 &&
      providedSecret &&
      providedSecret === adminSecret
    ) {
      const tgRaw =
        (request.headers['x-admin-telegram-id'] as string | undefined) ||
        (request.headers['x-dev-telegram-id'] as string | undefined);
      if (!tgRaw) {
        throw new UnauthorizedException('Missing x-admin-telegram-id');
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
      // Dev bypass when no token configured
      if (process.env.NODE_ENV === 'development') {
        const devUserId = request.headers['x-dev-telegram-id'];
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
