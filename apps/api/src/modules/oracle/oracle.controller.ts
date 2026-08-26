import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { OracleService } from './oracle.service';

@Controller('oracle')
@UseGuards(TmaAuthGuard)
export class OracleController {
  constructor(private readonly oracle: OracleService) {}

  @Get('ton')
  async ton() {
    try {
      return await this.oracle.getTonUsd();
    } catch (e) {
      throw new ServiceUnavailableException(
        e instanceof Error ? e.message : 'Oracle unavailable',
      );
    }
  }
}
