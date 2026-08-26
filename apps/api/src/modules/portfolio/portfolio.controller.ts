import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
@UseGuards(TmaAuthGuard)
export class PortfolioController {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async get(@TelegramInitData() initData: InitData) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.portfolio.getPortfolio(user.id);
  }

  @Get(':fishId')
  async getOne(
    @TelegramInitData() initData: InitData,
    @Param('fishId') fishId: string,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.portfolio.getPosition(user.id, fishId);
  }
}
