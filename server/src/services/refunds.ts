import { withTransaction, type DbClient } from '../db';
import { HttpError } from '../errors';
import { toDollars } from '../money';
import { allocateDiscount, linePaid, refundAmountForLine } from '../refund-math';
import { getOrder, type OrderDetail } from './orders';

export interface RefundInput {
  items: { orderItemId: number; quantity: number }[];
  reason?: string;
}

export interface RefundPreview {
  items: { orderItemId: number; quantity: number; amount: number }[];
  total: number;
}

interface RefundLine {
  orderItemId: number;
  productId: number;
  quantity: number;
  amount: number;
}

// The one place a refund amount is decided, so the preview and the real refund cannot disagree.
async function computeRefund(
  client: DbClient,
  orderId: number,
  input: RefundInput,
  lock: boolean,
): Promise<{ lines: RefundLine[]; total: number }> {
  const { rows: orders } = await client.query(
    `SELECT status, discount_amount FROM orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [orderId],
  );
  if (!orders[0]) throw new HttpError(404, 'Order not found');
  if (orders[0].status !== 'paid') throw new HttpError(409, 'Only paid orders can be refunded');

  const { rows: items } = await client.query(
    `SELECT oi.id, oi.product_id, oi.quantity, oi.line_total,
            COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri WHERE ri.order_item_id = oi.id), 0)::int AS refunded
       FROM order_items oi
      WHERE oi.order_id = $1
      ORDER BY oi.id`,
    [orderId],
  );

  const shares = allocateDiscount(
    items.map((item) => item.line_total as number),
    orders[0].discount_amount,
  );

  const seen = new Set<number>();
  const lines: RefundLine[] = input.items.map(({ orderItemId, quantity }) => {
    if (seen.has(orderItemId)) throw new HttpError(400, `Item ${orderItemId} is listed more than once`);
    seen.add(orderItemId);

    const index = items.findIndex((item) => item.id === orderItemId);
    if (index === -1) throw new HttpError(400, `Item ${orderItemId} is not part of this order`);
    const item = items[index];
    if (quantity > item.quantity - item.refunded) {
      throw new HttpError(409, `Only ${item.quantity - item.refunded} unit(s) of item ${orderItemId} can still be refunded`);
    }

    const paid = linePaid(item.line_total, shares[index]);
    return {
      orderItemId,
      productId: item.product_id,
      quantity,
      amount: refundAmountForLine(paid, item.quantity, item.refunded, quantity),
    };
  });

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  if (total === 0) throw new HttpError(400, 'Nothing to refund: these units were fully discounted');
  return { lines, total };
}

export async function previewRefund(orderId: number, input: RefundInput): Promise<RefundPreview> {
  const { lines, total } = await withTransaction((client) => computeRefund(client, orderId, input, false));
  return {
    items: lines.map(({ orderItemId, quantity, amount }) => ({ orderItemId, quantity, amount: toDollars(amount) })),
    total: toDollars(total),
  };
}

export async function createRefund(orderId: number, input: RefundInput): Promise<OrderDetail> {
  await withTransaction(async (client) => {
    const { lines, total } = await computeRefund(client, orderId, input, true);

    const { rows } = await client.query(
      'INSERT INTO refunds (order_id, amount, reason) VALUES ($1, $2, $3) RETURNING id',
      [orderId, total, input.reason || null],
    );
    const refundId: number = rows[0].id;

    for (const line of lines) {
      await client.query(
        'INSERT INTO refund_items (refund_id, order_item_id, quantity, amount) VALUES ($1, $2, $3, $4)',
        [refundId, line.orderItemId, line.quantity, line.amount],
      );
    }

    const restock = new Map<number, number>();
    for (const line of lines) restock.set(line.productId, (restock.get(line.productId) ?? 0) + line.quantity);
    // Stable product order, like createOrder, so concurrent writers cannot deadlock.
    for (const [productId, quantity] of [...restock.entries()].sort(([a], [b]) => a - b)) {
      await client.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [productId, quantity]);
    }
  });

  return (await getOrder(orderId))!;
}
