import { config } from '../config';
import { pool } from '../db';
import { toDollars } from '../money';

export interface DailyRevenue {
  day: string; // YYYY-MM-DD
  revenue: number; // net of refunds issued that day
  grossRevenue: number;
  refunds: number;
  orders: number;
  aov: number;
}

export interface Dashboard {
  range: { days: number; since: string };
  kpis: {
    revenue: number;
    orders: number;
    averageOrderValue: number;
    lowStockProducts: number;
    refunds: number;
    refundCount: number;
    // Refunds issued in the range as a percentage of gross revenue in the range; null when there was none.
    refundRate: number | null;
  };
  revenueByDay: DailyRevenue[];
  topProducts: { productId: number; name: string; units: number; revenue: number }[];
}

export async function getDashboard(days: number, now: Date = new Date()): Promise<Dashboard> {
  const tz = config.storeTimezone;

  // Day arithmetic happens on the zoneless local timestamp so day boundaries survive DST changes.
  const { rows: startRows } = await pool.query(
    `SELECT (date_trunc('day', $1::timestamptz AT TIME ZONE $2) - ($3::int - 1) * interval '1 day') AT TIME ZONE $2 AS since`,
    [now, tz, days],
  );
  const since: Date = startRows[0].since;

  const daySeries = `generate_series(
              ($3::timestamptz AT TIME ZONE $2)::date - ($4::int - 1),
              ($3::timestamptz AT TIME ZONE $2)::date,
              interval '1 day'
            ) AS d(day)`;

  const { rows: daily } = await pool.query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(o.total), 0)::float8 AS revenue,
            COUNT(o.id)::int AS orders
       FROM ${daySeries}
       LEFT JOIN orders o
         ON (o.created_at AT TIME ZONE $2)::date = d.day::date
        AND o.status <> 'cancelled'
        AND o.created_at >= $1
      GROUP BY d.day
      ORDER BY d.day`,
    [since, tz, now, days],
  );

  // Refunds belong to the day they were issued. Refunds of cancelled orders are skipped: cancelling already
  // removes the whole order from revenue.
  const { rows: refundDaily } = await pool.query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(r.amount), 0)::float8 AS refunds,
            COUNT(r.id)::int AS refund_count
       FROM ${daySeries}
       LEFT JOIN (
              SELECT r.id, r.amount, r.created_at
                FROM refunds r
                JOIN orders o ON o.id = r.order_id
               WHERE o.status <> 'cancelled'
            ) r
         ON (r.created_at AT TIME ZONE $2)::date = d.day::date
        AND r.created_at >= $1
      GROUP BY d.day
      ORDER BY d.day`,
    [since, tz, now, days],
  );

  // Arithmetic stays in integer cents; dollars appear only in the returned values.
  const dailyCents = daily.map((row, i) => {
    const gross = Number(row.revenue);
    const refunds = Number(refundDaily[i].refunds);
    const net = gross - refunds;
    return {
      day: row.day as string,
      gross,
      refunds,
      revenue: net,
      orders: row.orders as number,
      aov: row.orders === 0 ? 0 : Math.round(net / row.orders),
    };
  });

  const revenueByDay: DailyRevenue[] = dailyCents.map((d) => ({
    day: d.day,
    revenue: toDollars(d.revenue),
    grossRevenue: toDollars(d.gross),
    refunds: toDollars(d.refunds),
    orders: d.orders,
    aov: toDollars(d.aov),
  }));

  const grossCents = dailyCents.reduce((sum, d) => sum + d.gross, 0);
  const refundCents = dailyCents.reduce((sum, d) => sum + d.refunds, 0);
  const revenueCents = grossCents - refundCents;
  const orders = dailyCents.reduce((sum, d) => sum + d.orders, 0);
  const refundCount = refundDaily.reduce((sum, row) => sum + (row.refund_count as number), 0);
  const revenue = toDollars(revenueCents);
  const averageOrderValue = orders === 0 ? 0 : toDollars(Math.round(revenueCents / orders));
  const refundRate = grossCents === 0 ? null : Math.round((refundCents / grossCents) * 10000) / 100;

  const { rows: stockRows } = await pool.query(
    'SELECT count(*)::int AS count FROM products WHERE stock <= $1',
    [config.lowStockThreshold],
  );

  const { rows: top } = await pool.query(
    `SELECT p.id, p.name, SUM(oi.quantity)::int AS units, SUM(oi.line_total)::float8 AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
      WHERE o.status <> 'cancelled'
        AND o.created_at >= $1
      GROUP BY p.id, p.name`,
    [since],
  );

  const { rows: refundedProducts } = await pool.query(
    `SELECT p.id, p.name, SUM(ri.quantity)::int AS units, SUM(ri.amount)::float8 AS revenue
       FROM refund_items ri
       JOIN refunds r ON r.id = ri.refund_id
       JOIN orders o ON o.id = r.order_id
       JOIN order_items oi ON oi.id = ri.order_item_id
       JOIN products p ON p.id = oi.product_id
      WHERE o.status <> 'cancelled'
        AND r.created_at >= $1
      GROUP BY p.id, p.name`,
    [since],
  );

  // Net per product here, not in SQL, so the top five is chosen after refunds are taken off.
  const net = new Map<number, { productId: number; name: string; units: number; revenue: number }>();
  for (const row of top) {
    net.set(row.id, { productId: row.id, name: row.name, units: row.units, revenue: Number(row.revenue) });
  }
  // Only products that sold in the range are ranked; a refund of an older sale must not add a negative entry.
  for (const row of refundedProducts) {
    const entry = net.get(row.id);
    if (!entry) continue;
    entry.units -= row.units;
    entry.revenue -= Number(row.revenue);
  }
  const topProducts = [...net.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({ ...p, revenue: toDollars(p.revenue) }));

  return {
    range: { days, since: since.toISOString() },
    kpis: {
      revenue,
      orders,
      averageOrderValue,
      lowStockProducts: stockRows[0].count,
      refunds: toDollars(refundCents),
      refundCount,
      refundRate,
    },
    revenueByDay,
    topProducts,
  };
}
