-- Raise the fish ladder: mythics / anything ≥600 CR ×3, everything else ×1.7.
-- Uses the pre-update current_price for the threshold (Postgres evaluates RHS from old row).
UPDATE "fish"
SET
  "previous_price" = "current_price",
  "current_price" = CASE
    WHEN "current_price" >= 600 THEN ROUND("current_price" * 3, 4)
    ELSE ROUND("current_price" * 1.7, 4)
  END,
  "all_time_high" = GREATEST(
    "all_time_high",
    CASE
      WHEN "current_price" >= 600 THEN ROUND("current_price" * 3, 4)
      ELSE ROUND("current_price" * 1.7, 4)
    END
  ),
  "min_price" = GREATEST(
    0.001,
    ROUND(
      CASE
        WHEN "current_price" >= 600 THEN "current_price" * 3
        ELSE "current_price" * 1.7
      END * 0.2,
      4
    )
  ),
  "max_price" = ROUND(
    CASE
      WHEN "current_price" >= 600 THEN "current_price" * 3
      ELSE "current_price" * 1.7
    END * 4,
    4
  ),
  "updated_at" = NOW();
