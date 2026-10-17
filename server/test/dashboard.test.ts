import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { getDashboard } from '../src/services/dashboard';
import { app, createOrderRow, createProduct, postOrder, resetDb } from './helpers';

describe('GET /api/dashboard', () => {
  beforeEach(resetDb);

  it('reports revenue, order count and AOV for paid orders', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    await postOrder({ customerEmail: 'a@example.com', items: [{ productId: product.id, quantity: 1 }] });
    await postOrder({ customerEmail: 'b@example.com', items: [{ productId: product.id, quantity: 2 }] });

    const res = await app.inject({ url: '/api/dashboard?days=7' });

    expect(res.statusCode).toBe(200);
    const { kpis, revenueByDay } = res.json();
    expect(kpis.revenue).toBe(60);
    expect(kpis.orders).toBe(2);
    expect(kpis.averageOrderValue).toBe(30);
    expect(revenueByDay).toHaveLength(7);
  });

  it('excludes cancelled orders', async () => {
    const product = await createProduct({ price: 20, stock: 100 });
    const res = await postOrder({ customerEmail: 'a@example.com', items: [{ productId: product.id, quantity: 1 }] });
    await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [res.json().id]);

    const { kpis } = (await app.inject({ url: '/api/dashboard?days=7' })).json();

    expect(kpis.revenue).toBe(0);
    expect(kpis.orders).toBe(0);
  });

  it('counts low-stock products', async () => {
    await createProduct({ stock: 2 });
    await createProduct({ stock: 50 });

    const { kpis } = (await app.inject({ url: '/api/dashboard' })).json();

    expect(kpis.lowStockProducts).toBe(1);
  });

  it('weights average order value by orders, not by days', async () => {
    const day = 24 * 60 * 60 * 1000;
    await createOrderRow(100, new Date(Date.now() - 2 * day));
    for (let i = 0; i < 3; i++) await createOrderRow(10, new Date(Date.now() - day));

    const { kpis } = await getDashboard(7);

    expect(kpis.averageOrderValue).toBe(32.5);
  });

  it('reports zero average order value with no orders', async () => {
    const { kpis } = await getDashboard(7);
    expect(kpis.averageOrderValue).toBe(0);
  });

  describe('daily series', () => {
    const NOW = new Date('2026-06-15T16:00:00Z');

    it('includes days with no orders as zero entries', async () => {
      await createOrderRow(10, new Date('2026-06-10T16:00:00Z'));
      await createOrderRow(20, new Date('2026-06-13T16:00:00Z'));

      const { revenueByDay } = await getDashboard(7, NOW);

      expect(revenueByDay.map((d) => d.day)).toEqual([
        '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15',
      ]);
      for (const day of ['2026-06-11', '2026-06-12']) {
        expect(revenueByDay.find((d) => d.day === day)).toMatchObject({ revenue: 0, orders: 0, aov: 0 });
      }
      expect(revenueByDay.find((d) => d.day === '2026-06-10')).toMatchObject({ revenue: 10, orders: 1, aov: 10 });
    });

    it('returns a full zero series when there are no orders', async () => {
      const { revenueByDay, kpis } = await getDashboard(30, NOW);
      expect(revenueByDay).toHaveLength(30);
      expect(revenueByDay.every((d) => d.revenue === 0 && d.orders === 0 && d.aov === 0)).toBe(true);
      expect(kpis.orders).toBe(0);
    });

    it('returns exactly one entry for a one-day range', async () => {
      const { revenueByDay } = await getDashboard(1, NOW);
      expect(revenueByDay.map((d) => d.day)).toEqual(['2026-06-15']);
    });
  });

  describe('store timezone', () => {
    const daysWithRevenue = (rows: { day: string; revenue: number }[]) =>
      rows.filter((d) => d.revenue > 0).map((d) => d.day);

    it('puts a late-evening order on the store-local day', async () => {
      await createOrderRow(10, new Date('2026-06-14T01:30:00Z'));
      const { revenueByDay } = await getDashboard(7, new Date('2026-06-15T16:00:00Z'));
      expect(daysWithRevenue(revenueByDay)).toEqual(['2026-06-13']);
    });

    it('uses the winter offset', async () => {
      await createOrderRow(10, new Date('2026-01-14T04:30:00Z'));
      const { revenueByDay } = await getDashboard(7, new Date('2026-01-15T17:00:00Z'));
      expect(daysWithRevenue(revenueByDay)).toEqual(['2026-01-13']);
    });

    it('splits days at local midnight', async () => {
      await createOrderRow(10, new Date('2026-06-14T03:59:00Z'));
      await createOrderRow(20, new Date('2026-06-14T04:00:00Z'));
      const { revenueByDay } = await getDashboard(7, new Date('2026-06-15T16:00:00Z'));
      expect(revenueByDay.find((d) => d.day === '2026-06-13')?.revenue).toBe(10);
      expect(revenueByDay.find((d) => d.day === '2026-06-14')?.revenue).toBe(20);
    });

    it('keeps day boundaries across the spring DST change', async () => {
      await createOrderRow(10, new Date('2026-03-04T04:30:00Z'));
      await createOrderRow(20, new Date('2026-03-04T05:30:00Z'));
      const { revenueByDay, kpis } = await getDashboard(7, new Date('2026-03-10T16:00:00Z'));
      expect(revenueByDay[0].day).toBe('2026-03-04');
      expect(daysWithRevenue(revenueByDay)).toEqual(['2026-03-04']);
      expect(kpis.revenue).toBe(20);
    });
  });
});
