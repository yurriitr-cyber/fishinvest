-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PROMO_BONUS';

-- CreateEnum
CREATE TYPE "PromoRewardKind" AS ENUM ('BALANCE', 'FISH', 'CASE');

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoRewardKind" NOT NULL,
    "amount" DECIMAL(20,4),
    "fish_id" UUID,
    "case_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "max_uses" INTEGER,
    "uses_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_case_credits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "remaining" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_case_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_is_active_idx" ON "promo_codes"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_promo_code_id_user_id_key" ON "promo_redemptions"("promo_code_id", "user_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_user_id_created_at_idx" ON "promo_redemptions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_case_credits_user_id_case_id_key" ON "user_case_credits"("user_id", "case_id");

-- CreateIndex
CREATE INDEX "user_case_credits_user_id_idx" ON "user_case_credits"("user_id");

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_case_credits" ADD CONSTRAINT "user_case_credits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_case_credits" ADD CONSTRAINT "user_case_credits_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
