import { Module } from '@nestjs/common';
import { TmaAuthGuard } from './tma-auth.guard';

@Module({
  providers: [TmaAuthGuard],
  exports: [TmaAuthGuard],
})
export class AuthModule {}
