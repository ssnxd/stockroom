import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { app, createProduct, postOrder, postRefund, resetDb } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

async function orderOf(productId: number, quantity: number) {
  const res = await postOrder({ customerEmail: 'a@example.com', items: [{ productId, quantity }] });
  return res.json() as { id: number; items: { id: number }[] };
}

async function refundUnits(order: { id: number; items: { id: number }[] }, quantity: number) {
  const res = await postRefund(order.id, { items: [{ orderItemId: order.items[0].id, quantity }] });
  expect(res.statusCode).toBe(201);
}

const ageOrder = (orderId: number, days: number) =>
  pool.query('UPDATE orders SET created_at = $2 WHERE id = $1', [orderId, new Date(Date.now() - days * DAY)]);

const ageRefunds = (orderId: number, days: number) =>
  pool.query('UPDATE refunds SET created_at = $2 WHERE order_id = $1', [orderId, new Date(Date.now() - days * DAY)]);

const dashboard = async (days = 7) => (await app.inject({ url: `/api/dashboard?days=${days}` })).json();

describe('GET /api/dashboard with refunds', () => {
  beforeEach(resetDb);

  it('reports revenue net of refunds, and the refund amount, count and rate', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    await orderOf(product.id, 1);
    const second = await orderOf(product.id, 2);
    await refundUnits(second, 1);

    const { kpis } = await dashboard();

    expect(kpis.revenue).toBe(40);
    expect(kpis.refunds).toBe(20);
    expect(kpis.refundCount).toBe(1);
    expect(kpis.refundRate).toBeCloseTo(33.33, 2);
    expect(kpis.orders).toBe(2);
    expect(kpis.averageOrderValue).toBe(20);
  });

  it('puts a refund on the day it was issued, not the day of the order', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    const order = await orderOf(product.id, 1);
    await ageOrder(order.id, 3);
    await refundUnits(order, 1);

    const { revenueByDay } = await dashboard();

    const today = revenueByDay.at(-1);
    const orderDay = revenueByDay.at(-4);
    expect(today).toMatchObject({ grossRevenue: 0, refunds: 20, revenue: -20 });
    expect(orderDay).toMatchObject({ grossRevenue: 20, refunds: 0, revenue: 20 });
  });

  it('ignores refunds issued before the range', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    const order = await orderOf(product.id, 1);
    await refundUnits(order, 1);
    await ageOrder(order.id, 10);
    await ageRefunds(order.id, 10);

    const { kpis } = await dashboard(7);

    expect(kpis).toMatchObject({ revenue: 0, refunds: 0, refundCount: 0 });
  });

  it('does not subtract refunds of an order that was cancelled afterwards', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    const order = await orderOf(product.id, 2);
    await refundUnits(order, 1);
    await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);

    const { kpis } = await dashboard();

    expect(kpis).toMatchObject({ revenue: 0, refunds: 0, refundCount: 0 });
  });

  it('has no refund rate when nothing was sold in the range, but still reports the refund', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    const order = await orderOf(product.id, 1);
    await ageOrder(order.id, 10);
    await refundUnits(order, 1);

    const { kpis } = await dashboard(7);

    expect(kpis.refundRate).toBeNull();
    expect(kpis.refunds).toBe(20);
    expect(kpis.revenue).toBe(-20);
  });

  it('takes refunded units and money off the top products', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    const order = await orderOf(product.id, 3);
    await refundUnits(order, 1);

    const { topProducts } = await dashboard();

    expect(topProducts).toEqual([{ productId: product.id, name: product.name, units: 2, revenue: 40 }]);
  });

  it('leaves a product off the top products when it only appears through a refund of an older sale', async () => {
    const sold = await createProduct({ price: 20, stock: 100 });
    const refundedOnly = await createProduct({ price: 20, stock: 100 });
    await orderOf(sold.id, 1);
    const old = await orderOf(refundedOnly.id, 1);
    await ageOrder(old.id, 10);
    await refundUnits(old, 1);

    const { topProducts } = await dashboard(7);

    expect(topProducts.map((p: { productId: number }) => p.productId)).toEqual([sold.id]);
  });
});
