import { prisma, type MessageStatus, type Prisma } from '@pingx/db';
import { redisKeys, utcDay } from '@pingx/shared';
import { Router } from 'express';
import { z } from 'zod';
import { redis } from '../lib/infra';
import { getUserLimits } from '../lib/limits';
import { notFound, parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';

export const listQuery = z.object({
  projectId: z.string().optional(),
  status: z.enum(['scheduled', 'queued', 'sending', 'sent', 'failed']).optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function messageWhere(q: z.infer<typeof listQuery>): Prisma.MessageWhereInput {
  return {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.status ? { status: q.status as MessageStatus } : {}),
    ...(q.q ? { OR: [{ to: { has: q.q.toLowerCase() } }, { subject: { contains: q.q, mode: 'insensitive' } }, { id: q.q }] } : {}),
  };
}

export const messageListSelect = {
  id: true,
  projectId: true,
  to: true,
  subject: true,
  status: true,
  attempts: true,
  error: true,
  tags: true,
  scheduledAt: true,
  sentAt: true,
  createdAt: true,
  provider: { select: { id: true, name: true, type: true } },
} satisfies Prisma.MessageSelect;

export const messagesRouter = Router();
messagesRouter.use(requireUser);

messagesRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const rows = await prisma.message.findMany({
    where: { userId: req.userId, ...messageWhere(q) },
    orderBy: { createdAt: 'desc' },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    select: messageListSelect,
  });
  res.json({ items: rows.slice(0, q.limit), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null });
});

messagesRouter.get('/:id', async (req, res) => {
  const m = await prisma.message.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: {
      events: { orderBy: { createdAt: 'asc' }, include: { provider: { select: { name: true, type: true } } } },
      provider: { select: { id: true, name: true, type: true } },
      template: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!m) throw notFound('Message');
  res.json(m);
});

export const usageRouter = Router();
usageRouter.use(requireUser);

usageRouter.get('/', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), req.query);
  const since = new Date(`${utcDay(new Date(Date.now() - (days - 1) * 86_400_000))}T00:00:00Z`);
  const [rows, limits, today, month, ai] = await Promise.all([
    prisma.usageDaily.findMany({ where: { userId: req.userId, date: { gte: since } }, orderBy: { date: 'asc' } }),
    getUserLimits(req.userId!),
    redis.get(redisKeys.quotaDay(req.userId!)),
    redis.get(redisKeys.quotaMonth(req.userId!)),
    redis.get(redisKeys.aiDay(req.userId!)),
  ]);
  const byDay = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const series = Array.from({ length: days }, (_, i) => {
    const day = utcDay(new Date(since.getTime() + i * 86_400_000));
    const r = byDay.get(day);
    return { date: day, sent: r?.sent ?? 0, failed: r?.failed ?? 0 };
  });
  res.json({
    series,
    today: Number(today ?? 0),
    month: Number(month ?? 0),
    aiToday: Number(ai ?? 0),
    limits: { daily: limits.daily, monthly: limits.monthly, burst: limits.burst, aiDaily: limits.aiDaily },
    plan: { code: limits.plan.code, name: limits.plan.name },
  });
});
