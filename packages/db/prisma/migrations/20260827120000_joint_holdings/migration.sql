-- CreateEnum
CREATE TYPE "JointProposalKind" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "JointProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "joint_holdings" (
    "id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "avg_buy_price" DECIMAL(20,4) NOT NULL,
    "total_invested" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "joint_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joint_holding_members" (
    "id" UUID NOT NULL,
    "holding_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "total_invested" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "joint_holding_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joint_proposals" (
    "id" UUID NOT NULL,
    "kind" "JointProposalKind" NOT NULL,
    "status" "JointProposalStatus" NOT NULL DEFAULT 'PENDING',
    "initiator_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "fish_id" UUID NOT NULL,
    "holding_id" UUID,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit_price" DECIMAL(20,4) NOT NULL,
    "total_amount" DECIMAL(20,4) NOT NULL,
    "partner_accepted" BOOLEAN NOT NULL DEFAULT false,
    "telegram_msg_id" BIGINT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "joint_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "joint_holdings_fish_id_idx" ON "joint_holdings"("fish_id");

-- CreateIndex
CREATE INDEX "joint_holding_members_user_id_idx" ON "joint_holding_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "joint_holding_members_holding_id_user_id_key" ON "joint_holding_members"("holding_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "joint_proposals_idempotency_key_key" ON "joint_proposals"("idempotency_key");

-- CreateIndex
CREATE INDEX "joint_proposals_partner_id_status_idx" ON "joint_proposals"("partner_id", "status");

-- CreateIndex
CREATE INDEX "joint_proposals_initiator_id_status_idx" ON "joint_proposals"("initiator_id", "status");

-- AddForeignKey
ALTER TABLE "joint_holdings" ADD CONSTRAINT "joint_holdings_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_holding_members" ADD CONSTRAINT "joint_holding_members_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "joint_holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_holding_members" ADD CONSTRAINT "joint_holding_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_proposals" ADD CONSTRAINT "joint_proposals_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_proposals" ADD CONSTRAINT "joint_proposals_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_proposals" ADD CONSTRAINT "joint_proposals_fish_id_fkey" FOREIGN KEY ("fish_id") REFERENCES "fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joint_proposals" ADD CONSTRAINT "joint_proposals_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "joint_holdings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
