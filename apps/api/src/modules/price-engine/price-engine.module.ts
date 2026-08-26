import { Module } from '@nestjs/common';
import { PriceEngineService } from './price-engine.service';

@Module({
  providers: [PriceEngineService],
  exports: [PriceEngineService],
})
export class PriceEngineModule {}
