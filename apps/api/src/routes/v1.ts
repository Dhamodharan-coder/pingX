import { prisma } from '@pingx/db';
import { AppError } from '@pingx/shared';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../lib/validate';
import { requireApiKey } from '../middleware/auth';
import { createMessages, publicMessage, sendInputSchema } from '../services/send';
import { randomUUID } from 'node:crypto';

export const v1Router = Router();
v1Router.use(requireApiKey);

const idempotencyKey = (h: unknown) => {
  if (h === undefined) return undefined;
  if (typeof h !== 'string' || h.length < 1 || h.length > 255) throw new AppError('validation_error', 400, 'Idempotency-Key must be 1-255 characters');
  return h;
};

v1Router.post('/send', async (req, res) => {
  const input = parse(sendInputSchema, req.body);
  const ctx = { userId: req.userId!, projectId: req.apiKey!.projectId, apiKeyId: req.apiKey!.id };
  const { messages, replayed } = await createMessages(ctx, [input], { idempotencyKey: idempotencyKey(req.headers['idempotency-key']), res });
  if (replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(replayed ? 200 : 202).json(publicMessage(messages[0]!));
});

v1Router.post('/send/batch', async (req, res) => {
  const { messages: inputs } = parse(z.object({ messages: z.array(sendInputSchema).min(1).max(100) }), req.body);
  const ctx = { userId: req.userId!, projectId: req.apiKey!.projectId, apiKeyId: req.apiKey!.id };
  const batchId = randomUUID();
  const { messages } = await createMessages(ctx, inputs, { batchId, res });
  res.status(202).json({ batchId, messages: messages.map(publicMessage) });
});

v1Router.get('/messages/:id', async (req, res) => {
  const m = await prisma.message.findFirst({
    where: { id: req.params.id, projectId: req.apiKey!.projectId },
    include: { events: { orderBy: { createdAt: 'asc' }, select: { type: true, detail: true, createdAt: true } } },
  });
  if (!m) throw notFound('Message');
  res.json({
    ...publicMessage(m),
    to: m.to,
    subject: m.subject,
    attempts: m.attempts,
    error: m.error,
    sentAt: m.sentAt,
    tags: m.tags,
    events: m.events,
  });
});
