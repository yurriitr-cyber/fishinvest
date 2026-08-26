import { Module } from '@nestjs/common';
import { FishController } from './fish.controller';
import { FishService } from './fish.service';

@Module({
  controllers: [FishController],
  providers: [FishService],
  exports: [FishService],
})
export class FishModule {}
