-- Money moves from DOUBLE PRECISION dollars to INTEGER cents. Irreversible. ROUND on numeric rounds half up.
ALTER TABLE order_items
  ALTER COLUMN unit_price TYPE INTEGER USING ROUND(unit_price::numeric * 100),
  ALTER COLUMN line_total TYPE INTEGER USING ROUND(unit_price::numeric * 100)::int * quantity;

ALTER TABLE products
  ALTER COLUMN price TYPE INTEGER USING ROUND(price::numeric * 100);

ALTER TABLE orders
  ALTER COLUMN subtotal TYPE INTEGER USING ROUND(subtotal::numeric * 100),
  ALTER COLUMN discount_amount DROP DEFAULT,
  ALTER COLUMN discount_amount TYPE INTEGER USING ROUND(discount_amount::numeric * 100),
  ALTER COLUMN discount_amount SET DEFAULT 0,
  ALTER COLUMN total TYPE INTEGER USING ROUND(total::numeric * 100);

UPDATE orders o SET subtotal = s.sum
  FROM (SELECT order_id, SUM(line_total) AS sum FROM order_items GROUP BY order_id) s
 WHERE s.order_id = o.id;

UPDATE orders SET total = subtotal - discount_amount;
