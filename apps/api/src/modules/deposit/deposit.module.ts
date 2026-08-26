import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OracleModule } from '../oracle/oracle.module';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';

@Module({
  imports: [UsersModule, OracleModule],
  controllers: [DepositController],
  providers: [DepositService],
  exports: [DepositService],
})
export class DepositModule {}
