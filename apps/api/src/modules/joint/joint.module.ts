import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { JointController } from './joint.controller';
import { JointService } from './joint.service';
import { TelegramNotifyService } from './telegram-notify.service';

@Module({
  imports: [UsersModule, LedgerModule],
  controllers: [JointController],
  providers: [JointService, TelegramNotifyService],
  exports: [JointService],
})
export class JointModule {}
