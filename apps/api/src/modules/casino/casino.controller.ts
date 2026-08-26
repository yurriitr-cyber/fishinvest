import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { CasinoService } from './casino.service';

class OpenCaseDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  /** Price the client displayed — guards against paying more after a price tick. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxPrice?: number;
}

@Controller('casino')
@UseGuards(TmaAuthGuard)
export class CasinoController {
  constructor(
    private readonly casino: CasinoService,
    private readonly users: UsersService,
  ) {}

  @Get('cases')
  list() {
    return this.casino.listCases();
  }

  @Get('cases/:id')
  one(@Param('id') id: string) {
    return this.casino.getCase(id);
  }

  @Post('cases/:id/open')
  async open(
    @TelegramInitData() initData: InitData,
    @Param('id') id: string,
    @Body() dto: OpenCaseDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.casino.openCase(user.id, id, dto.idempotencyKey, dto.maxPrice);
  }

  @Get('openings')
  async openings(
    @TelegramInitData() initData: InitData,
    @Query('limit') limit?: string,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.casino.recentOpenings(user.id, Number(limit) || 20);
  }
}
