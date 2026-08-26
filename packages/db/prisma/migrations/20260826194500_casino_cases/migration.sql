-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'CASE_OPEN';

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_credits" DECIMAL(20,4) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_rewards" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "weight" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "case_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_openings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_paid" DECIMAL(20,4) NOT NULL,
    "fish_unit_price" DECIMAL(20,4) NOT NULL,
    "fish_market_value" DECIMAL(20,4) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_openings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cases_code_key" ON "cases"("code");

-- CreateIndex
CREATE INDEX "case_rewards_case_id_idx" ON "case_rewards"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_rewards_case_id_fish_id_key" ON "case_rewards"("case_id", "fish_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_openings_idempotency_key_key" ON "case_openings"("idempotency_key");

-- CreateIndex
CREATE INDEX "case_openings_user_id_created_at_idx" ON "case_openings"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "case_openings_case_id_created_at_idx" ON "case_openings"("case_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "case_rewards" ADD CONSTRAINT "case_rewards_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_rewards" ADD CONSTRAINT "case_rewards_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
