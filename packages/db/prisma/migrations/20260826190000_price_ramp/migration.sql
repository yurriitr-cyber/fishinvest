-- AlterTable
ALTER TABLE "fish" ADD COLUMN "ramp_from_price" DECIMAL(20,4);
ALTER TABLE "fish" ADD COLUMN "ramp_to_price" DECIMAL(20,4);
ALTER TABLE "fish" ADD COLUMN "ramp_start_at" TIMESTAMP(3);
ALTER TABLE "fish" ADD COLUMN "ramp_end_at" TIMESTAMP(3);
