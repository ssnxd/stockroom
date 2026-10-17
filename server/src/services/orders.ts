import { pool, withTransaction, type DbClient } from '../db';
import { HttpError } from '../errors';
import { percentOfCents, toDollars } from '../money';

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
    subtotal: toDollars(row.subtotal),
    discountCode: row.discount_code,
    discountAmount: toDollars(row.discount_amount),
    total: toDollars(row.total),
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
      unitPrice: toDollars(item.unit_price),
      lineTotal: toDollars(item.line_total),
    })),
  };
}

async function getValidDiscount(client: DbClient, code: string) {
  const { rows } = await client.query('SELECT * FROM discount_codes WHERE code = $1', [
    code.toUpperCase(),
  ]);
  const discount = rows[0];
  if (!discount) {
    throw new HttpError(400, 'Invalid discount code');
  }
  if (discount.expires_at && discount.expires_at < new Date()) {
    throw new HttpError(400, 'Discount code has expired');
  }
  if (discount.max_uses !== null && discount.used_count > discount.max_uses) {
    throw new HttpError(400, 'Discount code has already been used');
  }
  return discount as { code: string; percent_off: number };
}

export async function createOrder(input: CreateOrderInput): Promise<OrderDetail> {
  const orderId = await withTransaction(async (client) => {
    let subtotal = 0;
    const lines = [];

    for (const item of input.items) {
      const { rows } = await client.query(
        'SELECT id, name, price, stock FROM products WHERE id = $1',
        [item.productId],
      );
      const product = rows[0];
      if (!product) {
        throw new HttpError(404, `Product ${item.productId} not found`);
      }
      if (product.stock < item.quantity) {
        throw new HttpError(409, `Not enough stock for ${product.name}`);
      }
      const lineTotal = product.price * item.quantity;
      subtotal += lineTotal;
      lines.push({ product, quantity: item.quantity, lineTotal });
    }

    let discountCode: string | null = null;
    let discountAmount = 0;
    if (input.discountCode) {
      const discount = await getValidDiscount(client, input.discountCode);
      discountCode = discount.code;
      discountAmount = percentOfCents(subtotal, discount.percent_off);
      await client.query('UPDATE discount_codes SET used_count = used_count + 1 WHERE code = $1', [
        discount.code,
      ]);
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
      await client.query('UPDATE products SET stock = $1 WHERE id = $2', [
        line.product.stock - line.quantity,
        line.product.id,
      ]);
    }

    return id;
  });

  return (await getOrder(orderId))!;
}
