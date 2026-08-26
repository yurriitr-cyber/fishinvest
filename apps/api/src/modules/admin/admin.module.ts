import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OracleModule } from '../oracle/oracle.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, OracleModule],
  controllers: [AdminController, AdminAuthController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
