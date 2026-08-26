import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { InitData } from '@telegram-apps/init-data-node';
import { INIT_DATA_KEY } from './tma-auth.guard';

export const TelegramInitData = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): InitData => {
    const request = ctx.switchToHttp().getRequest();
    return request[INIT_DATA_KEY];
  },
);
