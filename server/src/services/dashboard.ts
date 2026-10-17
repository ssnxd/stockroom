import { config } from '../config';
import { pool } from '../db';

export interface DailyRevenue {
  day: string; // YYYY-MM-DD
  revenue: number;
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

  const { rows: daily } = await pool.query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(o.total), 0) AS revenue,
            COUNT(o.id)::int AS orders
       FROM generate_series(
              ($3::timestamptz AT TIME ZONE $2)::date - ($4::int - 1),
              ($3::timestamptz AT TIME ZONE $2)::date,
              interval '1 day'
            ) AS d(day)
       LEFT JOIN orders o
         ON (o.created_at AT TIME ZONE $2)::date = d.day::date
        AND o.status <> 'cancelled'
        AND o.created_at >= $1
      GROUP BY d.day
      ORDER BY d.day`,
    [since, tz, now, days],
  );

  const revenueByDay: DailyRevenue[] = daily.map((row) => ({
    day: row.day,
    revenue: row.revenue,
    orders: row.orders,
    aov: row.orders === 0 ? 0 : row.revenue / row.orders,
  }));

  const revenue = revenueByDay.reduce((sum, d) => sum + d.revenue, 0);
  const orders = revenueByDay.reduce((sum, d) => sum + d.orders, 0);
  const averageOrderValue = orders === 0 ? 0 : revenue / orders;

  const { rows: stockRows } = await pool.query(
    'SELECT count(*)::int AS count FROM products WHERE stock <= $1',
    [config.lowStockThreshold],
  );

  const { rows: top } = await pool.query(
    `SELECT p.id, p.name, SUM(oi.quantity)::int AS units, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
      WHERE o.status <> 'cancelled'
        AND o.created_at >= $1
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 5`,
    [since],
  );

  return {
    range: { days, since: since.toISOString() },
    kpis: {
      revenue,
      orders,
      averageOrderValue,
      lowStockProducts: stockRows[0].count,
    },
    revenueByDay,
    topProducts: top.map((row) => ({
      productId: row.id,
      name: row.name,
      units: row.units,
      revenue: row.revenue,
    })),
  };
}
