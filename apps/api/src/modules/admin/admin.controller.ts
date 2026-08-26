import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { User } from '@rare-fish/db';
import { AdminUser } from './admin.decorator';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

class CreateFishDto {
  @IsString() symbol!: string;
  @IsString() name!: string;
  @IsString() rarity!: string;
  @IsNumber() @Min(0.0001) currentPrice!: number;
  @IsOptional() @IsNumber() volatility?: number;
  @IsOptional() @IsNumber() trend?: number;
  @IsOptional() @IsString() description?: string;
}

class SetPriceDto {
  @IsNumber() @Min(0.0001) price!: number;
  @IsOptional() @IsString() reason?: string;
}

class PercentDto {
  @IsNumber() percent!: number;
}

class EventDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() fishId?: string;
  @IsNumber() priceMultiplier!: number;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
}

class PaymentPatchDto {
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsNumber() feePercent?: number;
  @IsOptional() @IsNumber() minDeposit?: number | null;
  @IsOptional() @IsNumber() maxDeposit?: number | null;
}

class AdjustDto {
  @IsNumber() amount!: number;
  @IsString() reason!: string;
}

class SetBalanceDto {
  @IsNumber() @Min(0) balance!: number;
  @IsString() reason!: string;
}

class BanDto {
  @IsOptional() @IsString() reason?: string;
}

class DailyTargetItemDto {
  @IsUUID() fishId!: string;
  @IsNumber() percent!: number;
}

class DailyTargetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyTargetItemDto)
  targets!: DailyTargetItemDto[];

  @IsOptional()
  @IsNumber()
  durationHours?: number;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard(): Promise<any> {
    return this.admin.dashboard();
  }

  @Get('fish')
  listFish(): Promise<any> {
    return this.admin.listFish();
  }

  @Post('fish/daily-targets')
  setDailyTargets(
    @AdminUser() admin: User,
    @Body() dto: DailyTargetsDto,
  ): Promise<any> {
    const targets = Array.isArray(dto.targets) ? dto.targets : [];
    return this.admin.setDailyTargets(
      admin,
      targets.map((t) => ({
        fishId: t.fishId,
        percent: Number(t.percent),
      })),
      dto.durationHours != null ? Number(dto.durationHours) : 24,
    );
  }

  @Post('fish')
  createFish(@AdminUser() admin: User, @Body() dto: CreateFishDto): Promise<any> {
    return this.admin.createFish(admin, dto);
  }

  @Patch('fish/:id')
  updateFish(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<any> {
    return this.admin.updateFish(admin, id, body);
  }

  @Post('fish/:id/set-price')
  setPrice(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() dto: SetPriceDto,
  ): Promise<any> {
    return this.admin.setPrice(admin, id, dto.price, dto.reason);
  }

  @Post('fish/:id/adjust-percent')
  adjustPercent(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() dto: PercentDto,
  ): Promise<any> {
    return this.admin.adjustPricePercent(admin, id, dto.percent);
  }

  @Post('fish/:id/freeze')
  freeze(@AdminUser() admin: User, @Param('id') id: string): Promise<any> {
    return this.admin.freeze(admin, id, true);
  }

  @Post('fish/:id/unfreeze')
  unfreeze(@AdminUser() admin: User, @Param('id') id: string): Promise<any> {
    return this.admin.freeze(admin, id, false);
  }

  @Post('events')
  createEvent(@AdminUser() admin: User, @Body() dto: EventDto): Promise<any> {
    return this.admin.createEvent(admin, dto);
  }

  @Get('deposits')
  deposits(@Query('limit') limit?: string): Promise<any> {
    return this.admin.listDeposits(limit ? Number(limit) : 50);
  }

  @Get('oracles')
  oracles(): Promise<any> {
    return this.admin.oracleStatus();
  }

  @Get('payment-settings')
  paymentSettings(): Promise<any> {
    return this.admin.listPaymentSettings();
  }

  @Patch('payment-settings/:code')
  patchPayment(
    @AdminUser() admin: User,
    @Param('code') code: string,
    @Body() dto: PaymentPatchDto,
  ): Promise<any> {
    return this.admin.updatePaymentSettings(admin, code, dto);
  }

  @Get('users')
  users(@Query('q') q?: string, @Query('limit') limit?: string): Promise<any> {
    return this.admin.searchUsers(q, limit ? Number(limit) : 50);
  }

  @Get('users/:id')
  user(@Param('id') id: string): Promise<any> {
    return this.admin.getUser(id);
  }

  @Post('users/:id/adjust-balance')
  adjust(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() dto: AdjustDto,
  ): Promise<any> {
    return this.admin.adjustBalance(admin, id, dto.amount, dto.reason);
  }

  @Post('users/:id/set-balance')
  setBalance(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() dto: SetBalanceDto,
  ): Promise<any> {
    return this.admin.setBalance(admin, id, dto.balance, dto.reason);
  }

  @Post('users/:id/ban')
  ban(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() dto: BanDto,
  ): Promise<any> {
    return this.admin.setBan(admin, id, true, dto.reason);
  }

  @Post('users/:id/unban')
  unban(
    @AdminUser() admin: User,
    @Param('id') id: string,
    @Body() dto: BanDto,
  ): Promise<any> {
    return this.admin.setBan(admin, id, false, dto.reason);
  }

  @Get('audit')
  audit(
    @Query('limit') limit?: string,
    @Query('actionType') actionType?: string,
  ): Promise<any> {
    return this.admin.listAudit(
      limit ? Number(limit) : 50,
      actionType || undefined,
    );
  }

  @Get('events')
  events(@Query('limit') limit?: string): Promise<any> {
    return this.admin.listEvents(limit ? Number(limit) : 30);
  }

  @Post('events/:id/activate')
  activateEvent(
    @AdminUser() admin: User,
    @Param('id') id: string,
  ): Promise<any> {
    return this.admin.setEventActive(admin, id, true);
  }

  @Post('events/:id/deactivate')
  deactivateEvent(
    @AdminUser() admin: User,
    @Param('id') id: string,
  ): Promise<any> {
    return this.admin.setEventActive(admin, id, false);
  }

  @Get('casino')
  casino(): Promise<any> {
    return this.admin.casinoStats();
  }

  @Get('security')
  security(): Promise<any> {
    return this.admin.securityOverview();
  }
}
