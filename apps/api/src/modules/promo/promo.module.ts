import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({
  imports: [UsersModule, LedgerModule],
  controllers: [PromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
