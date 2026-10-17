import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().positive().max(2_147_483_647).optional(),
});

export const productRoutes: FastifyPluginAsync = async (app) => {
  // Keyset pagination on id, which is creation order. The cursor is the last returned id.
  app.get('/', async (request) => {
    const { limit, cursor } = listQuery.parse(request.query);

    const params: unknown[] = [limit + 1];
    let where = '';
    if (cursor) {
      params.push(cursor);
      where = 'WHERE id > $2';
    }

    const { rows: fetched } = await pool.query(
      `SELECT id, sku, name, price, stock, created_at
         FROM products
         ${where}
        ORDER BY id ASC
        LIMIT $1`,
      params,
    );
    const { rows: countRows } = await pool.query('SELECT count(*)::int AS total FROM products');

    const rows = fetched.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      products: rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        price: row.price,
        stock: row.stock,
        createdAt: row.created_at.toISOString(),
      })),
      total: countRows[0].total,
      nextCursor: fetched.length > limit ? String(last.id) : null,
    };
  });
};
