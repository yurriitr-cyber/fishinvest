import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TelegramNotifyService } from '../joint/telegram-notify.service';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';

@Module({
  imports: [UsersModule],
  controllers: [ReferralController],
  providers: [ReferralService, TelegramNotifyService],
  exports: [ReferralService],
})
export class ReferralModule {}
