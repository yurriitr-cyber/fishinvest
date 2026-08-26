import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { DepositService } from './deposit.service';

class StarsQuoteDto {
  @IsInt()
  @Min(1)
  @Max(50_000)
  starAmount!: number;
}

class StarsCreateDto {
  @IsInt()
  @Min(1)
  @Max(50_000)
  starAmount!: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

class StarsConfirmDto {
  @IsString()
  depositId!: string;

  @IsString()
  telegramPaymentChargeId!: string;

  @IsOptional()
  @IsString()
  providerPaymentChargeId?: string;

  @IsNumber()
  totalAmount!: number;

  @IsString()
  currency!: string;

  @IsNumber()
  telegramUserId!: number;
}

class StarsPreCheckoutDto {
  @IsString()
  depositId!: string;

  @IsNumber()
  telegramUserId!: number;
}

class TonAmountDto {
  @IsNumber()
  @Min(0.05)
  @Max(500)
  tonAmount!: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

@Controller('deposit')
export class DepositController {
  constructor(
    private readonly deposits: DepositService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('methods')
  @UseGuards(TmaAuthGuard)
  methods() {
    return this.deposits.getMethods();
  }

  @Post('stars/quote')
  @UseGuards(TmaAuthGuard)
  quoteStars(@Body() dto: StarsQuoteDto) {
    return this.deposits.quoteStars(dto.starAmount);
  }

  @Post('stars')
  @UseGuards(TmaAuthGuard)
  async createStars(
    @TelegramInitData() initData: InitData,
    @Body() dto: StarsCreateDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.deposits.createStarsDeposit(
      user.id,
      dto.starAmount,
      dto.idempotencyKey,
    );
  }

  @Post('ton/quote')
  @UseGuards(TmaAuthGuard)
  quoteTon(@Body() dto: TonAmountDto) {
    return this.deposits.quoteTon(dto.tonAmount);
  }

  @Post('ton')
  @UseGuards(TmaAuthGuard)
  async createTon(
    @TelegramInitData() initData: InitData,
    @Body() dto: TonAmountDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.deposits.createTonDeposit(
      user.id,
      dto.tonAmount,
      dto.idempotencyKey,
    );
  }

  @Post('ton/:id/check')
  @UseGuards(TmaAuthGuard)
  async checkTon(
    @TelegramInitData() initData: InitData,
    @Param('id') id: string,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.deposits.checkTonDeposit(user.id, id);
  }

  @Get(':id')
  @UseGuards(TmaAuthGuard)
  async getOne(
    @TelegramInitData() initData: InitData,
    @Param('id') id: string,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.deposits.getDeposit(user.id, id);
  }

  /** Called by the bot after Telegram payment events. */
  @Post('internal/stars/pre-checkout')
  async preCheckout(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: StarsPreCheckoutDto,
  ) {
    this.assertInternal(secret);
    const ok = await this.deposits.assertPendingStarsDeposit(
      dto.depositId,
      dto.telegramUserId,
    );
    return { ok };
  }

  @Post('internal/stars/confirm')
  async confirm(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: StarsConfirmDto,
  ) {
    this.assertInternal(secret);
    return this.deposits.confirmStarsPayment(dto);
  }

  private assertInternal(secret?: string) {
    const expected = this.config.get<string>('INTERNAL_API_SECRET');
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
