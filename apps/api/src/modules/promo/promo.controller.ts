import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { PromoService } from './promo.service';

class RedeemDto {
  @IsString()
  code!: string;
}

@Controller('promo')
@UseGuards(TmaAuthGuard)
export class PromoController {
  constructor(
    private readonly promo: PromoService,
    private readonly users: UsersService,
  ) {}

  @Post('redeem')
  async redeem(
    @TelegramInitData() initData: InitData,
    @Body() dto: RedeemDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.promo.redeem(user.id, dto.code);
  }
}
