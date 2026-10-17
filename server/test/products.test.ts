import { beforeEach, describe, expect, it } from 'vitest';
import { app, createProduct, resetDb } from './helpers';

describe('GET /api/products', () => {
  beforeEach(resetDb);

  it('paginates through the catalog with a cursor', async () => {
    await createProduct({ name: 'A', createdAt: new Date('2025-01-01T10:00:00Z') });
    await createProduct({ name: 'B', createdAt: new Date('2025-01-02T10:00:00Z') });
    await createProduct({ name: 'C', createdAt: new Date('2025-01-03T10:00:00Z') });

    const first = (await app.inject({ url: '/api/products?limit=2' })).json();
    expect(first.products.map((p: { name: string }) => p.name)).toEqual(['A', 'B']);
    expect(first.total).toBe(3);
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await app.inject({ url: `/api/products?limit=2&cursor=${encodeURIComponent(first.nextCursor)}` })
    ).json();
    expect(second.products.map((p: { name: string }) => p.name)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
  });

  type Page = { products: { name: string }[]; nextCursor: string | null; total: number };
  const getPage = async (query: string) => (await app.inject({ url: `/api/products?${query}` })).json() as Page;
  const collectAll = async (limit: number) => {
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Page = await getPage(`limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
      names.push(...page.products.map((p) => p.name));
      cursor = page.nextCursor;
    } while (cursor);
    return names;
  };

  it('returns every product exactly once when many share a created_at', async () => {
    const createdAt = new Date('2025-01-01T10:00:00Z');
    for (let i = 1; i <= 7; i++) await createProduct({ name: `P${i}`, createdAt });

    expect(await collectAll(3)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    expect((await getPage('limit=3')).total).toBe(7);
  });

  it('returns a null cursor when the last page is exactly full', async () => {
    for (let i = 1; i <= 4; i++) await createProduct({ name: `P${i}` });

    const first = await getPage('limit=2');
    const second = await getPage(`limit=2&cursor=${first.nextCursor}`);
    expect(second.products).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it('returns an empty page for a cursor past the last product', async () => {
    await createProduct();
    const page = await getPage('cursor=999999');
    expect(page.products).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    const res = await app.inject({ url: '/api/products?cursor=abc' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a cursor larger than the id column can hold', async () => {
    const res = await app.inject({ url: '/api/products?cursor=99999999999' });
    expect(res.statusCode).toBe(400);
  });
});
