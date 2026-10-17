-- Refunds. Amounts are integer cents. A refund's amount equals the sum of its items' amounts.
CREATE TABLE refunds (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refunds_order_id_idx ON refunds (order_id);
CREATE INDEX refunds_created_at_idx ON refunds (created_at);

CREATE TABLE refund_items (
  id SERIAL PRIMARY KEY,
  refund_id INTEGER NOT NULL REFERENCES refunds (id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0)
);

CREATE INDEX refund_items_refund_id_idx ON refund_items (refund_id);
CREATE INDEX refund_items_order_item_id_idx ON refund_items (order_item_id);
