import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { FishService } from './fish.service';

@Controller('fish')
@UseGuards(TmaAuthGuard)
export class FishController {
  constructor(private readonly fish: FishService) {}

  @Get()
  list() {
    return this.fish.list();
  }

  @Get(':id/history')
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.fish.getHistory(id, limit ? Number(limit) : 100);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.fish.getById(id);
  }
}
