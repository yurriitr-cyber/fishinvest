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
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { InitData } from '@telegram-apps/init-data-node';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { TelegramInitData } from '../auth/telegram-init-data.decorator';
import { UsersService } from '../users/users.service';
import { JointService } from './joint.service';

class ProposeBuyDto {
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsString()
  partnerUsername?: string;

  @IsString()
  fishId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class ProposeSellDto {
  @IsString()
  holdingId!: string;
}

class RespondDto {
  @IsBoolean()
  accept!: boolean;
}

class InternalRespondDto {
  @IsString()
  proposalId!: string;

  @IsInt()
  telegramUserId!: number;

  @IsBoolean()
  accept!: boolean;
}

@Controller('joint')
export class JointController {
  constructor(
    private readonly joint: JointService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  private assertInternal(secret?: string) {
    const expected = this.config.get<string>('INTERNAL_API_SECRET') || '';
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }

  @Get('friends')
  @UseGuards(TmaAuthGuard)
  async friends(@TelegramInitData() initData: InitData) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.joint.listFriends(user.id);
  }

  @Get('mine')
  @UseGuards(TmaAuthGuard)
  async mine(@TelegramInitData() initData: InitData) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.joint.listMine(user.id);
  }

  @Post('buy')
  @UseGuards(TmaAuthGuard)
  async buy(
    @TelegramInitData() initData: InitData,
    @Body() dto: ProposeBuyDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.joint.proposeBuy(
      user.id,
      dto.fishId,
      dto.quantity,
      dto.partnerId,
      dto.partnerUsername,
    );
  }

  @Post('sell')
  @UseGuards(TmaAuthGuard)
  async sell(
    @TelegramInitData() initData: InitData,
    @Body() dto: ProposeSellDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.joint.proposeSell(user.id, dto.holdingId);
  }

  @Post('internal/respond')
  async internalRespond(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: InternalRespondDto,
  ) {
    this.assertInternal(secret);
    return this.joint.respondFromTelegram(
      dto.telegramUserId,
      dto.proposalId,
      dto.accept,
    );
  }

  @Post(':id/respond')
  @UseGuards(TmaAuthGuard)
  async respond(
    @TelegramInitData() initData: InitData,
    @Param('id') id: string,
    @Body() dto: RespondDto,
  ) {
    const { user } = await this.users.getOrCreateFromInitData(initData);
    return this.joint.respond(user.id, id, dto.accept);
  }
}
