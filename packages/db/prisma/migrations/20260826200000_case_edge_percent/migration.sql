-- Case ticket price is derived from live expected value; this stores the target margin.
ALTER TABLE "cases"
  ADD COLUMN "edge_percent" DECIMAL(5,2) NOT NULL DEFAULT 10;
