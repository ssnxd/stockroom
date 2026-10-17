import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createRefund, previewRefund } from '../services/refunds';

const idParams = z.object({
  id: z.coerce.number().int().positive(),
});

const refundBody = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  reason: z.string().trim().max(500).optional(),
});

export const refundRoutes: FastifyPluginAsync = async (app) => {
  app.post('/preview', async (request) => {
    const { id } = idParams.parse(request.params);
    return previewRefund(id, refundBody.parse(request.body));
  });

  app.post('/', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const order = await createRefund(id, refundBody.parse(request.body));
    return reply.status(201).send(order);
  });
};
