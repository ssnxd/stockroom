import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import { toDollars } from '../money';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.iso.datetime().optional(),
});

export const productRoutes: FastifyPluginAsync = async (app) => {
  // Cursor pagination, oldest first.
  app.get('/', async (request) => {
    const { limit, cursor } = listQuery.parse(request.query);

    const params: unknown[] = [limit];
    let where = '';
    if (cursor) {
      params.push(cursor);
      where = 'WHERE created_at > $2';
    }

    const { rows } = await pool.query(
      `SELECT id, sku, name, price, stock, created_at
         FROM products
         ${where}
        ORDER BY created_at ASC
        LIMIT $1`,
      params,
    );
    const { rows: countRows } = await pool.query('SELECT count(*)::int AS total FROM products');

    const last = rows[rows.length - 1];
    return {
      products: rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        price: toDollars(row.price),
        stock: row.stock,
        createdAt: row.created_at.toISOString(),
      })),
      total: countRows[0].total,
      nextCursor: rows.length === limit ? last.created_at.toISOString() : null,
    };
  });
};
