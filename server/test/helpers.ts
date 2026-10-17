import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { toCents } from '../src/money';

export const app = buildApp();

export async function resetDb() {
  await pool.query('TRUNCATE order_items, orders, discount_codes, products RESTART IDENTITY CASCADE');
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

export async function createDiscountCode(code: string, percentOff: number, maxUses: number | null = null) {
  await pool.query('INSERT INTO discount_codes (code, percent_off, max_uses) VALUES ($1, $2, $3)', [
    code,
    percentOff,
    maxUses,
  ]);
}

export function postOrder(body: unknown) {
  return app.inject({ method: 'POST', url: '/api/orders', payload: body as object });
}

export function expectWholeCents(value: number): void {
  if (Math.round(value * 100) / 100 !== value) {
    throw new Error(`Expected a whole number of cents, got ${value}`);
  }
}
