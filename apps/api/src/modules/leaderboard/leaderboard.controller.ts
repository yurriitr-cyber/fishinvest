import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
@UseGuards(TmaAuthGuard)
export class LeaderboardController {
  constructor(
    private readonly leaderboard: LeaderboardService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async get(
    @TelegramInitData() initData: InitData,
    @Query('limit') limit?: string,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.leaderboard.getTop(limit ? Number(limit) : 50, user.id);
  }
}
