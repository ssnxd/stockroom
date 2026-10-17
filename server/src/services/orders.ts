import { pool, withTransaction, type DbClient } from '../db';
import { HttpError } from '../errors';

export interface CreateOrderInput {
  customerEmail: string;
  items: { productId: number; quantity: number }[];
  discountCode?: string;
}

export interface OrderSummary {
  id: number;
  customerEmail: string;
  status: string;
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  total: number;
  itemCount: number;
  createdAt: string;
}

export interface OrderItem {
  id: number;
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderDetail extends Omit<OrderSummary, 'itemCount'> {
  items: OrderItem[];
}

interface OrderRow {
  id: number;
  customer_email: string;
  status: string;
  subtotal: number;
  discount_code: string | null;
  discount_amount: number;
  total: number;
  created_at: Date;
}

function toOrder(row: OrderRow) {
  return {
    id: row.id,
    customerEmail: row.customer_email,
    status: row.status,
    subtotal: row.subtotal,
    discountCode: row.discount_code,
    discountAmount: row.discount_amount,
    total: row.total,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listOrders(limit: number): Promise<OrderSummary[]> {
  const { rows } = await pool.query(
    `SELECT o.*, COALESCE(SUM(oi.quantity), 0)::int AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({ ...toOrder(row), itemCount: row.item_count }));
}

export async function getOrder(id: number): Promise<OrderDetail | null> {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (rows.length === 0) return null;

  const { rows: items } = await pool.query(
    `SELECT oi.id, oi.product_id, p.sku, p.name, oi.quantity, oi.unit_price, oi.line_total
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.id`,
    [id],
  );

  return {
    ...toOrder(rows[0]),
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    })),
  };
}

async function claimDiscount(client: DbClient, code: string) {
  const normalized = code.toUpperCase();
  const { rows } = await client.query(
    `UPDATE discount_codes SET used_count = used_count + 1
      WHERE code = $1
        AND (max_uses IS NULL OR used_count < max_uses)
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING code, percent_off`,
    [normalized],
  );
  if (rows[0]) return rows[0] as { code: string; percent_off: number };

  const { rows: existing } = await client.query(
    'SELECT max_uses, used_count, expires_at FROM discount_codes WHERE code = $1',
    [normalized],
  );
  const discount = existing[0];
  if (!discount) {
    throw new HttpError(400, 'Invalid discount code');
  }
  if (discount.expires_at && discount.expires_at <= new Date()) {
    throw new HttpError(400, 'Discount code has expired');
  }
  throw new HttpError(400, 'Discount code has already been used');
}

async function claimStock(client: DbClient, productId: number, quantity: number) {
  const { rows } = await client.query(
    `UPDATE products SET stock = stock - $2
      WHERE id = $1 AND stock >= $2
      RETURNING id, name, price`,
    [productId, quantity],
  );
  if (rows[0]) return rows[0] as { id: number; name: string; price: number };

  const { rows: existing } = await client.query('SELECT name FROM products WHERE id = $1', [productId]);
  if (!existing[0]) {
    throw new HttpError(404, `Product ${productId} not found`);
  }
  throw new HttpError(409, `Not enough stock for ${existing[0].name}`);
}

export async function createOrder(input: CreateOrderInput): Promise<OrderDetail> {
  const orderId = await withTransaction(async (client) => {
    const quantities = new Map<number, number>();
    for (const item of input.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    // Claim in a stable order so concurrent multi-product orders cannot deadlock.
    const merged = [...quantities.entries()].sort(([a], [b]) => a - b);

    let subtotal = 0;
    const lines = [];

    for (const [productId, quantity] of merged) {
      const product = await claimStock(client, productId, quantity);
      const lineTotal = product.price * quantity;
      subtotal += lineTotal;
      lines.push({ product, quantity, lineTotal });
    }

    let discountCode: string | null = null;
    let discountAmount = 0;
    if (input.discountCode) {
      const discount = await claimDiscount(client, input.discountCode);
      discountCode = discount.code;
      discountAmount = subtotal * (discount.percent_off / 100);
    }

    const total = subtotal - discountAmount;

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (customer_email, subtotal, discount_code, discount_amount, total)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.customerEmail, subtotal, discountCode, discountAmount, total],
    );
    const id: number = orderRows[0].id;

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, line.product.id, line.quantity, line.product.price, line.lineTotal],
      );
    }

    return id;
  });

  return (await getOrder(orderId))!;
}
