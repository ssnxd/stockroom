import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { app, createDiscountCode, createProduct, postOrder, postRefund, previewRefund, resetDb } from './helpers';

async function placeOrder(lines: { productId: number; quantity: number }[], discountCode?: string) {
  const res = await postOrder({ customerEmail: 'ava@example.com', items: lines, discountCode });
  expect(res.statusCode).toBe(201);
  return res.json() as {
    id: number;
    total: number;
    items: { id: number; productId: number; quantity: number }[];
  };
}

const stockOf = async (productId: number) =>
  (await pool.query('SELECT stock FROM products WHERE id = $1', [productId])).rows[0].stock as number;

describe('POST /api/orders/:id/refunds', () => {
  beforeEach(resetDb);

  it('refunds one of three units, restocks it and marks the order partially refunded', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }]);

    const res = await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 1 }], reason: 'Too small' });

    expect(res.statusCode).toBe(201);
    const updated = res.json();
    expect(updated.status).toBe('partially_refunded');
    expect(updated.items[0].refundedQuantity).toBe(1);
    expect(updated.refunds).toHaveLength(1);
    expect(updated.refunds[0]).toMatchObject({ amount: 10, reason: 'Too small' });
    expect(updated.refunds[0].items).toEqual([
      expect.objectContaining({ orderItemId: order.items[0].id, quantity: 1, amount: 10 }),
    ]);
    expect(await stockOf(tee.id)).toBe(8);
  });

  it('refunds the discounted price the customer paid, across several refunds', async () => {
    await createDiscountCode('TEN', 10);
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }], 'TEN');
    expect(order.total).toBe(27);

    const first = await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 1 }] });
    expect(first.json().refunds[0].amount).toBe(9);

    const second = await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 2 }] });
    expect(second.json().refunds[0].amount).toBe(18);
    expect(second.json().status).toBe('refunded');
  });

  it('refunds each line its share of a 10% discount: $36 for the $40 item and $54 for the $60 item', async () => {
    await createDiscountCode('TEN', 10);
    const cheap = await createProduct({ price: 40, stock: 10 });
    const dear = await createProduct({ price: 60, stock: 10 });
    const order = await placeOrder(
      [
        { productId: cheap.id, quantity: 1 },
        { productId: dear.id, quantity: 1 },
      ],
      'TEN',
    );
    expect(order.total).toBe(90);

    const cheapLine = order.items.find((i) => i.productId === cheap.id)!;
    const dearLine = order.items.find((i) => i.productId === dear.id)!;

    const first = await postRefund(order.id, { items: [{ orderItemId: cheapLine.id, quantity: 1 }] });
    expect(first.json().refunds[0].amount).toBe(36);
    const second = await postRefund(order.id, { items: [{ orderItemId: dearLine.id, quantity: 1 }] });
    expect(second.json().refunds[0].amount).toBe(54);
  });

  it('refunds exactly the order total across lines when cents do not divide evenly', async () => {
    await createDiscountCode('FIFTEEN', 15);
    const a = await createProduct({ price: 3.33, stock: 10 });
    const b = await createProduct({ price: 0.07, stock: 10 });
    const order = await placeOrder(
      [
        { productId: a.id, quantity: 3 },
        { productId: b.id, quantity: 1 },
      ],
      'FIFTEEN',
    );
    expect(order.total).toBe(8.55);

    let refundedCents = 0;
    const [lineA, lineB] = order.items;
    for (const [orderItemId, times] of [
      [lineA.id, 3],
      [lineB.id, 1],
    ] as const) {
      for (let i = 0; i < times; i++) {
        const res = await postRefund(order.id, { items: [{ orderItemId, quantity: 1 }] });
        expect(res.statusCode).toBe(201);
        refundedCents += Math.round(res.json().refunds[0].amount * 100);
      }
    }

    expect(refundedCents).toBe(855);
  });

  it('rejects more units than were bought, across refunds, without touching stock', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }]);
    const itemId = order.items[0].id;

    expect((await postRefund(order.id, { items: [{ orderItemId: itemId, quantity: 4 }] })).statusCode).toBe(409);
    expect((await postRefund(order.id, { items: [{ orderItemId: itemId, quantity: 2 }] })).statusCode).toBe(201);
    expect((await postRefund(order.id, { items: [{ orderItemId: itemId, quantity: 2 }] })).statusCode).toBe(409);

    expect(await stockOf(tee.id)).toBe(9);
  });

  it.each([
    ['an empty item list', { items: [] }],
    ['a zero quantity', { items: [{ orderItemId: 1, quantity: 0 }] }],
    ['a negative quantity', { items: [{ orderItemId: 1, quantity: -1 }] }],
    ['a fractional quantity', { items: [{ orderItemId: 1, quantity: 1.5 }] }],
  ])('rejects %s', async (_name, body) => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }]);

    const res = await postRefund(order.id, { items: body.items.map((i) => ({ ...i, orderItemId: order.items[0].id })) });

    expect(res.statusCode).toBe(400);
  });

  it('rejects the same line twice in one request', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }]);
    const orderItemId = order.items[0].id;

    const res = await postRefund(order.id, {
      items: [
        { orderItemId, quantity: 1 },
        { orderItemId, quantity: 1 },
      ],
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a line that belongs to another order', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const first = await placeOrder([{ productId: tee.id, quantity: 1 }]);
    const second = await placeOrder([{ productId: tee.id, quantity: 1 }]);

    const res = await postRefund(first.id, { items: [{ orderItemId: second.items[0].id, quantity: 1 }] });

    expect(res.statusCode).toBe(400);
    expect(await stockOf(tee.id)).toBe(8);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await postRefund(9999, { items: [{ orderItemId: 1, quantity: 1 }] });
    expect(res.statusCode).toBe(404);
  });

  it('refuses to refund a cancelled order', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 1 }]);
    await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);

    const res = await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 1 }] });

    expect(res.statusCode).toBe(409);
    expect(await stockOf(tee.id)).toBe(9);
  });

  it('refuses a refund that would pay out nothing', async () => {
    await createDiscountCode('FREE', 100);
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 2 }], 'FREE');

    const res = await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 1 }] });

    expect(res.statusCode).toBe(400);
    expect(await stockOf(tee.id)).toBe(8);
  });

  it('lets only one of several simultaneous refunds of the last unit through', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 1 }]);
    const body = { items: [{ orderItemId: order.items[0].id, quantity: 1 }] };
    // Open the pool's connections first, otherwise the requests queue behind connection setup and never overlap.
    await Promise.all(Array.from({ length: 6 }, () => pool.query('SELECT pg_sleep(0.05)')));

    const results = await Promise.all(Array.from({ length: 6 }, () => postRefund(order.id, body)));

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await stockOf(tee.id)).toBe(10);
  });

  it('lists refund history newest first', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }]);
    const itemId = order.items[0].id;
    await postRefund(order.id, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'first' });
    await postRefund(order.id, { items: [{ orderItemId: itemId, quantity: 2 }], reason: 'second' });

    const detail = (await app.inject({ url: `/api/orders/${order.id}` })).json();

    expect(detail.refunds.map((r: { reason: string }) => r.reason)).toEqual(['second', 'first']);
  });

  it('shows the derived status on the order list', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 2 }]);
    await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 2 }] });

    const { orders } = (await app.inject({ url: '/api/orders' })).json();

    expect(orders[0].status).toBe('refunded');
  });
});

describe('POST /api/orders/:id/refunds/preview', () => {
  beforeEach(resetDb);

  it('returns the amount the real refund will pay, and changes nothing', async () => {
    await createDiscountCode('TEN', 10);
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 3 }], 'TEN');
    const body = { items: [{ orderItemId: order.items[0].id, quantity: 2 }] };

    const preview = await previewRefund(order.id, body);

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      items: [{ orderItemId: order.items[0].id, quantity: 2, amount: 18 }],
      total: 18,
    });
    expect(await stockOf(tee.id)).toBe(7);
    expect((await pool.query('SELECT count(*)::int AS n FROM refunds')).rows[0].n).toBe(0);

    const real = await postRefund(order.id, body);
    expect(real.json().refunds[0].amount).toBe(18);
  });

  it('applies the same rules as a real refund', async () => {
    const tee = await createProduct({ price: 10, stock: 10 });
    const order = await placeOrder([{ productId: tee.id, quantity: 1 }]);

    const res = await previewRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity: 2 }] });

    expect(res.statusCode).toBe(409);
  });
});
