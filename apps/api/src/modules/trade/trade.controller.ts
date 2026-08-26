import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { BuyDto, SellDto } from './trade.dto';
import { TradeService } from './trade.service';

@Controller('trade')
@UseGuards(TmaAuthGuard)
export class TradeController {
  constructor(
    private readonly trade: TradeService,
    private readonly users: UsersService,
  ) {}

  @Post('buy')
  async buy(@TelegramInitData() initData: InitData, @Body() dto: BuyDto) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.trade.buy(
      user.id,
      dto.fishId,
      dto.quantity,
      dto.idempotencyKey,
    );
  }

  @Post('sell')
  async sell(@TelegramInitData() initData: InitData, @Body() dto: SellDto) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.trade.sell(
      user.id,
      dto.fishId,
      dto.quantity,
      dto.idempotencyKey,
    );
  }
}
