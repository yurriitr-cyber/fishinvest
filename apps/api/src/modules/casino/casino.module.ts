import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { CasinoController } from './casino.controller';
import { CasinoService } from './casino.service';

@Module({
  imports: [LedgerModule, UsersModule],
  controllers: [CasinoController],
  providers: [CasinoService],
})
export class CasinoModule {}
