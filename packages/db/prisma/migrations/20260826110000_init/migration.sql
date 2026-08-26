-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('INITIAL_BONUS', 'REFERRAL_JOIN_BONUS', 'REFERRAL_BONUS', 'DEPOSIT_STARS', 'DEPOSIT_TON', 'DEPOSIT_GIFT', 'DEPOSIT_CRYPTO', 'BUY_FISH', 'SELL_FISH', 'ADMIN_ADJUSTMENT', 'FEE');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepositProvider" AS ENUM ('TELEGRAM_STARS', 'TON', 'TELEGRAM_GIFT', 'CRYPTO');

-- CreateEnum
CREATE TYPE "FishRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('AUTOMATIC', 'ADMIN', 'EVENT');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OracleAsset" AS ENUM ('TON', 'BTC', 'ETH', 'USDT', 'TELEGRAM_STAR');

-- CreateEnum
CREATE TYPE "OracleSource" AS ENUM ('COINGECKO', 'TONAPI', 'TELEGRAM_CONFIG', 'TELEGRAM_TOPUP_OPTIONS', 'MANUAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "language_code" TEXT,
    "photo_url" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "referral_code" TEXT NOT NULL,
    "referred_by_id" UUID,
    "referred_at" TIMESTAMP(3),
    "initial_bonus_granted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_balances" (
    "user_id" UUID NOT NULL,
    "available" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_balances_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "game_balance_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "balance_after" DECIMAL(20,4) NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_balance_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referred_id" UUID NOT NULL,
    "referral_code" TEXT NOT NULL,
    "referrer_bonus_amount" DECIMAL(20,4) NOT NULL DEFAULT 300,
    "referred_join_bonus_amount" DECIMAL(20,4) NOT NULL DEFAULT 50,
    "referrer_ledger_id" UUID,
    "referred_join_ledger_id" UUID,
    "status" "ReferralStatus" NOT NULL DEFAULT 'COMPLETED',
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fish" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rarity" "FishRarity" NOT NULL,
    "current_price" DECIMAL(20,4) NOT NULL,
    "previous_price" DECIMAL(20,4) NOT NULL,
    "daily_change_percent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "all_time_high" DECIMAL(20,4) NOT NULL,
    "all_time_low" DECIMAL(20,4) NOT NULL,
    "volatility" DECIMAL(10,6) NOT NULL,
    "trend" DECIMAL(10,6) NOT NULL,
    "momentum" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "min_price" DECIMAL(20,4) NOT NULL,
    "max_price" DECIMAL(20,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "price" DECIMAL(20,4) NOT NULL,
    "previous_price" DECIMAL(20,4) NOT NULL,
    "change_percent" DECIMAL(10,4) NOT NULL,
    "source" "PriceSource" NOT NULL,
    "market_event_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_positions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "avg_buy_price" DECIMAL(20,4) NOT NULL,
    "total_invested" DECIMAL(20,4) NOT NULL,
    "realized_pnl" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "side" "TradeSide" NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit_price" DECIMAL(20,4) NOT NULL,
    "total_amount" DECIMAL(20,4) NOT NULL,
    "realized_pnl" DECIMAL(20,4),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_events" (
    "id" UUID NOT NULL,
    "fish_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_multiplier" DECIMAL(10,4) NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "DepositProvider" NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_amount" DECIMAL(20,8) NOT NULL,
    "asset_usd_value" DECIMAL(20,8),
    "star_value_usd" DECIMAL(20,8),
    "star_value_source" "OracleSource",
    "star_value_timestamp" TIMESTAMP(3),
    "exchange_rate" DECIMAL(20,8),
    "gross_game_credits" DECIMAL(20,4),
    "fee_percent" DECIMAL(10,4),
    "fee_amount" DECIMAL(20,4),
    "game_credit_amount" DECIMAL(20,4),
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "external_transaction_id" TEXT,
    "oracle_source" TEXT,
    "quote_expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "deposit_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_providers" (
    "id" UUID NOT NULL,
    "code" "DepositProvider" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "fee_percent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "min_deposit" DECIMAL(20,8),
    "max_deposit" DECIMAL(20,8),
    "config" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "from_asset" TEXT NOT NULL,
    "to_asset" TEXT NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_by_id" UUID,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_oracle_snapshots" (
    "id" UUID NOT NULL,
    "asset" "OracleAsset" NOT NULL,
    "usd_price" DECIMAL(20,8) NOT NULL,
    "source" "OracleSource" NOT NULL,
    "source_priority" INTEGER NOT NULL,
    "raw_payload" JSONB,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "price_oracle_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_gifts" (
    "id" UUID NOT NULL,
    "deposit_id" UUID NOT NULL,
    "gift_id" TEXT NOT NULL,
    "gift_type" TEXT,
    "estimated_real_value" DECIMAL(20,8),
    "valuation_source" TEXT,
    "valuation_timestamp" TIMESTAMP(3),
    "game_credit_amount" DECIMAL(20,4),
    "status" "DepositStatus" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "game_balance_ledger_idempotency_key_key" ON "game_balance_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "game_balance_ledger_user_id_created_at_idx" ON "game_balance_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "game_balance_ledger_reference_type_reference_id_idx" ON "game_balance_ledger"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_id_key" ON "referrals"("referred_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referrer_ledger_id_key" ON "referrals"("referrer_ledger_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_join_ledger_id_key" ON "referrals"("referred_join_ledger_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referrer_id_referred_id_key" ON "referrals"("referrer_id", "referred_id");

-- CreateIndex
CREATE UNIQUE INDEX "fish_symbol_key" ON "fish"("symbol");

-- CreateIndex
CREATE INDEX "price_history_fish_id_created_at_idx" ON "price_history"("fish_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_positions_user_id_fish_id_key" ON "portfolio_positions"("user_id", "fish_id");

-- CreateIndex
CREATE UNIQUE INDEX "trades_idempotency_key_key" ON "trades"("idempotency_key");

-- CreateIndex
CREATE INDEX "trades_user_id_created_at_idx" ON "trades"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "trades_fish_id_created_at_idx" ON "trades"("fish_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "deposits_external_transaction_id_key" ON "deposits"("external_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_idempotency_key_key" ON "deposits"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_providers_code_key" ON "payment_providers"("code");

-- CreateIndex
CREATE INDEX "price_oracle_snapshots_asset_fetched_at_idx" ON "price_oracle_snapshots"("asset", "fetched_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_gifts_deposit_id_key" ON "telegram_gifts"("deposit_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_gifts_gift_id_key" ON "telegram_gifts"("gift_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_balances" ADD CONSTRAINT "game_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_balance_ledger" ADD CONSTRAINT "game_balance_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_market_event_id_fkey" FOREIGN KEY ("market_event_id") REFERENCES "market_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_gifts" ADD CONSTRAINT "telegram_gifts_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

