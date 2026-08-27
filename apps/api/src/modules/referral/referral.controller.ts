import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { ReferralService } from './referral.service';

@Controller('referrals')
@UseGuards(TmaAuthGuard)
export class ReferralController {
  constructor(
    private readonly referrals: ReferralService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(@TelegramInitData() initData: InitData) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.referrals.getStats(user.id);
  }

  @Post('share-card')
  async shareCard(@TelegramInitData() initData: InitData) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.referrals.sendShareCard(user.id);
  }
}
