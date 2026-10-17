import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../errors';
import { createOrder, getOrder, listOrders } from '../services/orders';
import { refundRoutes } from './refunds';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const idParams = z.object({
  id: z.coerce.number().int().positive(),
});

const createOrderBody = z.object({
  customerEmail: z.email(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  discountCode: z.string().trim().min(1).optional(),
});

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.register(refundRoutes, { prefix: '/:id/refunds' });

  app.get('/', async (request) => {
    const { limit } = listQuery.parse(request.query);
    return { orders: await listOrders(limit) };
  });

  app.get('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const order = await getOrder(id);
    if (!order) throw new HttpError(404, 'Order not found');
    return order;
  });

  app.post('/', async (request, reply) => {
    const body = createOrderBody.parse(request.body);
    const order = await createOrder(body);
    return reply.status(201).send(order);
  });
};
