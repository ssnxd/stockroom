import { describe, expect, it } from 'vitest';
import { app, createDiscountCode, createProduct, expectWholeCents, postOrder, resetDb } from './helpers';
import { beforeEach } from 'vitest';
import { percentOfCents, toCents, toDollars } from '../src/money';

describe('money helpers', () => {
  it('converts dollars to whole cents', () => {
    expect(toCents(19.99)).toBe(1999);
  });

  it('converts cents to dollars', () => {
    expect(toDollars(4034)).toBe(40.34);
  });

  it('takes a percentage of cents, rounding half up', () => {
    expect(percentOfCents(4746, 15)).toBe(712);
    expect(percentOfCents(1, 50)).toBe(1);
  });

  it('gives the whole amount for a 100% discount', () => {
    expect(percentOfCents(5000, 100)).toBe(5000);
  });
});

describe('money across endpoints', () => {
  beforeEach(resetDb);

  it('returns whole-cent amounts from every endpoint', async () => {
    const product = await createProduct({ price: 19.99, stock: 10 });
    await createDiscountCode('FIFTEEN', 15);

    const created = await postOrder({
      customerEmail: 'ava@example.com',
      items: [{ productId: product.id, quantity: 3 }],
      discountCode: 'FIFTEEN',
    });
    expect(created.statusCode).toBe(201);
    const order = created.json();
    expect(order).toMatchObject({ subtotal: 59.97, discountAmount: 9, total: 50.97 });

    const orderMoney = (o: { subtotal: number; discountAmount: number; total: number }) =>
      [o.subtotal, o.discountAmount, o.total];
    orderMoney(order).forEach(expectWholeCents);
    order.items.forEach((i: { unitPrice: number; lineTotal: number }) => {
      expectWholeCents(i.unitPrice);
      expectWholeCents(i.lineTotal);
    });

    const list = (await app.inject({ url: '/api/orders' })).json();
    const listed = Array.isArray(list) ? list : list.orders;
    listed.forEach((o: { subtotal: number; discountAmount: number; total: number }) =>
      orderMoney(o).forEach(expectWholeCents),
    );

    const detail = (await app.inject({ url: `/api/orders/${order.id}` })).json();
    orderMoney(detail).forEach(expectWholeCents);
    detail.items.forEach((i: { unitPrice: number; lineTotal: number }) => {
      expectWholeCents(i.unitPrice);
      expectWholeCents(i.lineTotal);
    });

    const dash = (await app.inject({ url: '/api/dashboard?days=7' })).json();
    expectWholeCents(dash.kpis.revenue);
    expectWholeCents(dash.kpis.averageOrderValue);
    dash.revenueByDay.forEach((d: { revenue: number; aov: number }) => {
      expectWholeCents(d.revenue);
      expectWholeCents(d.aov);
    });
    expect(dash.topProducts.length).toBeGreaterThan(0);
    dash.topProducts.forEach((t: { revenue: number }) => expectWholeCents(t.revenue));

    const products = (await app.inject({ url: '/api/products' })).json();
    products.products.forEach((p: { price: number }) => expectWholeCents(p.price));
    expect(products.products[0].price).toBe(19.99);
  });
});
