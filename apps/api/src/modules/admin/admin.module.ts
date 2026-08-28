import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OracleModule } from '../oracle/oracle.module';
import { TelegramNotifyService } from '../joint/telegram-notify.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, OracleModule],
  controllers: [AdminController, AdminAuthController],
  providers: [AdminService, AdminGuard, TelegramNotifyService],
})
export class AdminModule {}
