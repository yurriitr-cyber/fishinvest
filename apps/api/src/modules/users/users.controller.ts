import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from './users.service';

@Controller()
@UseGuards(TmaAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(
    @TelegramInitData() initData: InitData,
    @Headers('x-start-param') startParam?: string,
  ) {
    const { me } = await this.users.getOrCreateFromInitData(
      initData,
      startParam ?? initData.startParam,
    );
    return me;
  }
}
