import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { toCents } from '../src/money';

export const app = buildApp();

export async function resetDb() {
  await pool.query('TRUNCATE refund_items, refunds, order_items, orders, discount_codes, products RESTART IDENTITY CASCADE');
}

let skuCounter = 0;

export async function createProduct(
  overrides: { name?: string; price?: number; stock?: number; createdAt?: Date } = {},
) {
  skuCounter++;
  const { rows } = await pool.query(
    'INSERT INTO products (sku, name, price, stock, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [
      `TEST-${skuCounter}`,
      overrides.name ?? `Product ${skuCounter}`,
      toCents(overrides.price ?? 10),
      overrides.stock ?? 10,
      overrides.createdAt ?? new Date(),
    ],
  );
  return { ...rows[0], price: overrides.price ?? 10 } as { id: number; name: string; price: number; stock: number };
}

export async function createDiscountCode(
  code: string,
  percentOff: number,
  maxUses: number | null = null,
  expiresAt: Date | null = null,
) {
  await pool.query(
    'INSERT INTO discount_codes (code, percent_off, max_uses, expires_at) VALUES ($1, $2, $3, $4)',
    [code, percentOff, maxUses, expiresAt],
  );
}

export function postOrder(body: unknown) {
  return app.inject({ method: 'POST', url: '/api/orders', payload: body as object });
}

export async function createOrderRow(
  total: number,
  createdAt: Date,
  status: 'paid' | 'cancelled' = 'paid',
) {
  await pool.query(
    `INSERT INTO orders (customer_email, status, subtotal, discount_amount, total, created_at)
     VALUES ('seed@example.com', $1, $2, 0, $2, $3)`,
    [status, toCents(total), createdAt],
  );
}

export function expectWholeCents(value: number): void {
  if (Math.round(value * 100) / 100 !== value) {
    throw new Error(`Expected a whole number of cents, got ${value}`);
  }
}

export function postRefund(orderId: number, body: unknown) {
  return app.inject({ method: 'POST', url: `/api/orders/${orderId}/refunds`, payload: body as object });
}

export function previewRefund(orderId: number, body: unknown) {
  return app.inject({ method: 'POST', url: `/api/orders/${orderId}/refunds/preview`, payload: body as object });
}
