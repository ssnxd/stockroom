import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { createDiscountCode, createProduct, postOrder, resetDb } from './helpers';

describe('POST /api/orders', () => {
  beforeEach(resetDb);

  it('creates an order and decrements stock', async () => {
    const product = await createProduct({ price: 10, stock: 5 });

    const res = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: product.id, quantity: 2 }],
    });

    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order.total).toBe(20);
    expect(order.items).toHaveLength(1);

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [product.id]);
    expect(rows[0].stock).toBe(3);
  });

  it('rejects an order when there is not enough stock', async () => {
    const product = await createProduct({ stock: 1 });

    const res = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: product.id, quantity: 2 }],
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for an unknown product', async () => {
    const res = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: 999, quantity: 1 }],
    });

    expect(res.statusCode).toBe(404);
  });

  it('validates the request body', async () => {
    const res = await postOrder({ customerEmail: 'not-an-email', items: [] });
    expect(res.statusCode).toBe(400);
  });
});

describe('discount codes', () => {
  beforeEach(resetDb);

  it('applies a percentage discount', async () => {
    const product = await createProduct({ price: 25 });
    await createDiscountCode('TENOFF', 10);

    const res = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: product.id, quantity: 2 }],
      discountCode: 'tenoff',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subtotal: 50, discountAmount: 5, total: 45, discountCode: 'TENOFF' });
  });

  it('accepts a single-use code on its first use', async () => {
    const product = await createProduct();
    await createDiscountCode('ONCE', 10, 1);

    const res = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: product.id, quantity: 1 }],
      discountCode: 'ONCE',
    });

    expect(res.statusCode).toBe(201);
  });

  it('rejects an unknown code', async () => {
    const product = await createProduct();

    const res = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: product.id, quantity: 1 }],
      discountCode: 'NOPE',
    });

    expect(res.statusCode).toBe(400);
  });

  const usedCount = async (code: string) =>
    (await pool.query('SELECT used_count FROM discount_codes WHERE code = $1', [code])).rows[0]
      .used_count as number;
  const orderWith = (productId: number, discountCode: string, quantity = 1) =>
    postOrder({ customerEmail: 'ava@example.com', items: [{ productId, quantity }], discountCode });

  it('rejects a second use of a single-use code', async () => {
    const p = await createProduct();
    await createDiscountCode('ONCE', 10, 1);
    expect((await orderWith(p.id, 'ONCE')).statusCode).toBe(201);
    const second = await orderWith(p.id, 'ONCE');
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toMatch(/already been used/);
    expect(await usedCount('ONCE')).toBe(1);
  });

  it('counts a lower-case code against the upper-case single-use code', async () => {
    const p = await createProduct();
    await createDiscountCode('ONCE', 10, 1);
    expect((await orderWith(p.id, 'once')).statusCode).toBe(201);
    expect((await orderWith(p.id, 'ONCE')).statusCode).toBe(400);
  });

  it('lets only one concurrent order use a single-use code', async () => {
    const p = await createProduct({ stock: 100 });
    await createDiscountCode('ONCE', 10, 1);
    const results = await Promise.all(Array.from({ length: 5 }, () => orderWith(p.id, 'ONCE')));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(4);
    expect(await usedCount('ONCE')).toBe(1);
  });

  it('does not consume a code when the order fails on stock', async () => {
    const p = await createProduct({ stock: 1 });
    await createDiscountCode('ONCE', 10, 1);
    expect((await orderWith(p.id, 'ONCE', 2)).statusCode).toBe(409);
    expect(await usedCount('ONCE')).toBe(0);
  });

  it('rejects an expired code and leaves its use count unchanged', async () => {
    const p = await createProduct();
    await createDiscountCode('OLD', 20, null, new Date(Date.now() - 86_400_000));
    const res = await orderWith(p.id, 'OLD');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/expired/);
    expect(await usedCount('OLD')).toBe(0);
  });
});

describe('stock handling', () => {
  beforeEach(resetDb);

  const order = (items: { productId: number; quantity: number }[]) =>
    postOrder({ customerEmail: 'ava@example.com', items });
  const stockOf = async (id: number) =>
    (await pool.query('SELECT stock FROM products WHERE id = $1', [id])).rows[0].stock as number;

  it('never sells more than the stock under concurrent orders', async () => {
    const p = await createProduct({ stock: 5 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => order([{ productId: p.id, quantity: 1 }])),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(15);
    expect(await stockOf(p.id)).toBe(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM orders');
    expect(rows[0].n).toBe(5);
  });

  it('accepts an order for exactly the remaining stock', async () => {
    const p = await createProduct({ stock: 3 });
    const res = await order([{ productId: p.id, quantity: 3 }]);
    expect(res.statusCode).toBe(201);
    expect(await stockOf(p.id)).toBe(0);
  });

  it('rejects duplicate lines whose sum exceeds stock', async () => {
    const p = await createProduct({ stock: 5 });
    const res = await order([
      { productId: p.id, quantity: 3 },
      { productId: p.id, quantity: 3 },
    ]);
    expect(res.statusCode).toBe(409);
    expect(await stockOf(p.id)).toBe(5);
  });

  it('merges duplicate lines for the same product', async () => {
    const p = await createProduct({ stock: 10 });
    const res = await order([
      { productId: p.id, quantity: 2 },
      { productId: p.id, quantity: 3 },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].quantity).toBe(5);
    expect(await stockOf(p.id)).toBe(5);
  });

  it('rolls back earlier stock claims when a later line fails', async () => {
    const a = await createProduct({ stock: 5 });
    const b = await createProduct({ stock: 1 });
    const res = await order([
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 2 },
    ]);
    expect(res.statusCode).toBe(409);
    expect(await stockOf(a.id)).toBe(5);
  });

  it('rolls back stock claims when a later line is an unknown product', async () => {
    const a = await createProduct({ stock: 5 });
    const res = await order([
      { productId: a.id, quantity: 1 },
      { productId: 999999, quantity: 1 },
    ]);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(a.id)).toBe(5);
  });

  it('does not deadlock when concurrent orders list products in opposite order', async () => {
    const a = await createProduct({ stock: 50 });
    const b = await createProduct({ stock: 50 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const lines = [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ];
        return order(i % 2 === 0 ? lines : lines.reverse());
      }),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
  });

  it('rejects negative stock at the database level', async () => {
    const p = await createProduct({ stock: 1 });
    await expect(pool.query('UPDATE products SET stock = -1 WHERE id = $1', [p.id])).rejects.toThrow();
  });
});
