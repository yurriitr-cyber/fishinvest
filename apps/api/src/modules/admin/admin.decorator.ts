import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@rare-fish/db';
import { ADMIN_USER_KEY } from './admin.guard';

export const AdminUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    return ctx.switchToHttp().getRequest()[ADMIN_USER_KEY];
  },
);
