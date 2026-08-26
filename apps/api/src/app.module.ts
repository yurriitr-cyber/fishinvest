import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { ReferralModule } from './modules/referral/referral.module';
import { FishModule } from './modules/fish/fish.module';
import { TradeModule } from './modules/trade/trade.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { PriceEngineModule } from './modules/price-engine/price-engine.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { EventsModule } from './modules/events/events.module';
import { DepositModule } from './modules/deposit/deposit.module';
import { OracleModule } from './modules/oracle/oracle.module';
import { AdminModule } from './modules/admin/admin.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    LedgerModule,
    UsersModule,
    ReferralModule,
    FishModule,
    TradeModule,
    PortfolioModule,
    PriceEngineModule,
    LeaderboardModule,
    EventsModule,
    DepositModule,
    OracleModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
