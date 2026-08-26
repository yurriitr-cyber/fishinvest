-- Rebalance fish total/available supply. Available = max(0, new_total - held).
WITH targets(symbol, total) AS (
  VALUES
    ('GLDFSH', 50000000),
    ('NEON', 40000000),
    ('CATFSH', 25000000),
    ('CLOWN', 10000000),
    ('HORSE', 8000000),
    ('DGUPPY', 5000000),
    ('PIRANA', 4500000),
    ('CBETTA', 2000000),
    ('BARRA', 1500000),
    ('QKOI', 1250000),
    ('ANGEL', 1000000),
    ('AROWANA', 900000),
    ('EPUFFER', 800000),
    ('ASHARK', 50000),
    ('BDRAGON', 10000),
    ('STING', 5000),
    ('MANTA', 1000),
    ('MWHALE', 1000)
),
held AS (
  SELECT f.symbol, COALESCE(FLOOR(SUM(p.quantity))::int, 0) AS qty
  FROM fish f
  LEFT JOIN portfolio_positions p ON p.fish_id = f.id
  GROUP BY f.symbol
)
UPDATE fish AS f
SET
  total_supply = t.total,
  available_supply = GREATEST(0, t.total - COALESCE(h.qty, 0)),
  updated_at = NOW()
FROM targets t
LEFT JOIN held h ON h.symbol = t.symbol
WHERE f.symbol = t.symbol;
