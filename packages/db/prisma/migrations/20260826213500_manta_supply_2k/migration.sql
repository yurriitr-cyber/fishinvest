-- Bump MANTA total supply to 2k; keep held positions intact.
WITH held AS (
  SELECT COALESCE(FLOOR(SUM(p.quantity))::int, 0) AS qty
  FROM fish f
  LEFT JOIN portfolio_positions p ON p.fish_id = f.id
  WHERE f.symbol = 'MANTA'
)
UPDATE fish AS f
SET
  total_supply = 2000,
  available_supply = GREATEST(0, 2000 - (SELECT qty FROM held)),
  updated_at = NOW()
WHERE f.symbol = 'MANTA';
