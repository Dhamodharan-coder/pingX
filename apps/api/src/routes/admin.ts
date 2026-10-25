import { prisma, type Prisma } from '@pingx/db';
import { redisKeys, utcDay } from '@pingx/shared';
import { validateTemplateSource } from '@pingx/templates';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { redis } from '../lib/infra';
import { invalidateLimits, invalidateSettings } from '../lib/limits';
import { notFound, parse } from '../lib/validate';
import { requireAdmin, requireUser } from '../middleware/auth';
import { listQuery, messageListSelect, messageWhere } from './messages';
import { assertSlugFree, slug, validateVersion, versionBody } from './templates';

/** Admin never selects provider config: credentials stay encrypted and unreadable here. */
const providerSafeSelect = {
  id: true,
  userId: true,
  name: true,
  type: true,
  priority: true,
  fromEmail: true,
  healthy: true,
  consecutiveAuthFailures: true,
  lastError: true,
  lastUsedAt: true,
  dailyCap: true,
  createdAt: true,
  user: { select: { email: true } },
} satisfies Prisma.ProviderSelect;

const page = z.object({ page: z.coerce.number().int().min(1).default(1), q: z.string().trim().max(200).optional() });
const PAGE_SIZE = 50;

export const adminRouter = Router();
adminRouter.use(requireUser, requireAdmin);

adminRouter.get('/stats', async (_req, res) => {
  const today = new Date(`${utcDay()}T00:00:00Z`);
  const [users, newUsers, activeSubs, todayUsage, queued, failedToday, unhealthy] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.subscription.count({ where: { status: 'active' } }),
    prisma.usageDaily.aggregate({ where: { date: today }, _sum: { sent: true, failed: true } }),
    prisma.message.count({ where: { status: { in: ['queued', 'sending'] } } }),
    prisma.message.count({ where: { status: 'failed', createdAt: { gte: today } } }),
    prisma.provider.count({ where: { healthy: false } }),
  ]);
  res.json({ users, newUsers, activeSubs, sentToday: todayUsage._sum.sent ?? 0, failedToday, queued, unhealthyProviders: unhealthy });
});

const planBody = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1),
  dailyLimit: z.number().int().min(0),
  monthlyLimit: z.number().int().min(0),
  burstPerSecond: z.number().int().min(1),
  aiDailyLimit: z.number().int().min(0),
  priceInr: z.number().int().min(0),
  razorpayPlanId: z.string().nullish(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

adminRouter.get('/plans', async (_req, res) => {
  res.json(await prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { users: true } } } }));
});

adminRouter.post('/plans', async (req, res) => {
  const body = parse(planBody, req.body);
  const plan = await prisma.plan.create({ data: body });
  await audit(req.userId!, 'plan.create', 'plan', plan.id, body);
  res.status(201).json(plan);
});

adminRouter.patch('/plans/:id', async (req, res) => {
  const body = parse(planBody.partial(), req.body);
  const plan = await prisma.plan.update({ where: { id: req.params.id }, data: body });
  invalidateLimits();
  await audit(req.userId!, 'plan.update', 'plan', plan.id, body);
  res.json(plan);
});

adminRouter.get('/users', async (req, res) => {
  const q = parse(page, req.query);
  const where: Prisma.UserWhereInput = q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] } : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, email: true, name: true, role: true, emailVerifiedAt: true, disabledAt: true, dailyLimitOverride: true, createdAt: true, plan: { select: { id: true, code: true, name: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, total, pageSize: PAGE_SIZE });
});

adminRouter.get('/users/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, email: true, name: true, role: true, emailVerifiedAt: true, disabledAt: true, dailyLimitOverride: true, createdAt: true, googleId: true,
      plan: true,
      projects: { select: { id: true, name: true, createdAt: true } },
      providers: { select: providerSafeSelect, orderBy: { priority: 'asc' } },
      subscriptions: { orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true } } } },
      usage: { orderBy: { date: 'desc' }, take: 30 },
    },
  });
  if (!user) throw notFound('User');
  const today = await redis.get(redisKeys.quotaDay(user.id));
  res.json({ ...user, today: Number(today ?? 0) });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const body = parse(
    z.object({
      planId: z.string().optional(),
      dailyLimitOverride: z.number().int().min(0).nullable().optional(),
      role: z.enum(['user', 'admin']).optional(),
      disabled: z.boolean().optional(),
      emailVerified: z.boolean().optional(),
    }),
    req.body,
  );
  const { disabled, emailVerified, ...rest } = body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      ...(disabled !== undefined ? { disabledAt: disabled ? new Date() : null } : {}),
      ...(emailVerified !== undefined ? { emailVerifiedAt: emailVerified ? new Date() : null } : {}),
    },
  });
  if (disabled) await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  invalidateLimits(user.id);
  await audit(req.userId!, 'user.update', 'user', user.id, body);
  res.json({ ok: true });
});

adminRouter.get('/subscriptions', async (req, res) => {
  const q = parse(page, req.query);
  res.json(
    await prisma.subscription.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { email: true } }, plan: { select: { name: true, priceInr: true } } },
    }),
  );
});

adminRouter.get('/usage', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), req.query);
  const since = new Date(`${utcDay(new Date(Date.now() - (days - 1) * 86_400_000))}T00:00:00Z`);
  const [series, top] = await Promise.all([
    prisma.usageDaily.groupBy({ by: ['date'], where: { date: { gte: since } }, _sum: { sent: true, failed: true }, orderBy: { date: 'asc' } }),
    prisma.usageDaily.groupBy({ by: ['userId'], where: { date: { gte: since } }, _sum: { sent: true }, orderBy: { _sum: { sent: 'desc' } }, take: 10 }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.userId) } }, select: { id: true, email: true } });
  const emails = new Map(users.map((u) => [u.id, u.email]));
  res.json({
    series: series.map((s) => ({ date: s.date.toISOString().slice(0, 10), sent: s._sum.sent ?? 0, failed: s._sum.failed ?? 0 })),
    topUsers: top.map((t) => ({ userId: t.userId, email: emails.get(t.userId), sent: t._sum.sent ?? 0 })),
  });
});

adminRouter.get('/providers', async (req, res) => {
  const q = parse(page.extend({ unhealthy: z.coerce.boolean().optional() }), req.query);
  res.json(
    await prisma.provider.findMany({
      where: q.unhealthy ? { healthy: false } : {},
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: providerSafeSelect,
    }),
  );
});

const presetBody = z.object({
  name: z.string().trim().min(1),
  type: z.enum(['smtp', 'gmail_oauth', 'resend', 'ses']),
  host: z.string().nullish(),
  port: z.number().int().nullish(),
  secure: z.boolean().nullish(),
  dailyCap: z.number().int().nullish(),
  helpUrl: z.string().url().nullish(),
  notes: z.string().nullish(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

adminRouter.get('/presets', async (_req, res) => {
  res.json(await prisma.providerPreset.findMany({ orderBy: { sortOrder: 'asc' } }));
});

adminRouter.post('/presets', async (req, res) => {
  const body = parse(presetBody, req.body);
  const preset = await prisma.providerPreset.create({ data: body });
  await audit(req.userId!, 'preset.create', 'preset', preset.id, body);
  res.status(201).json(preset);
});

adminRouter.patch('/presets/:id', async (req, res) => {
  const body = parse(presetBody.partial(), req.body);
  const preset = await prisma.providerPreset.update({ where: { id: req.params.id }, data: body });
  await audit(req.userId!, 'preset.update', 'preset', preset.id, body);
  res.json(preset);
});

adminRouter.delete('/presets/:id', async (req, res) => {
  await prisma.providerPreset.delete({ where: { id: req.params.id } });
  await audit(req.userId!, 'preset.delete', 'preset', req.params.id);
  res.status(204).end();
});

adminRouter.get('/templates', async (_req, res) => {
  res.json(
    await prisma.template.findMany({
      where: { userId: null },
      orderBy: { name: 'asc' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    }),
  );
});

adminRouter.post('/templates', async (req, res) => {
  const body = parse(
    z.object({ name: z.string().trim().min(1), slug, description: z.string().nullish(), isGallery: z.boolean().default(true), layoutId: z.string().nullish(), version: versionBody }),
    req.body,
  );
  validateVersion(body.version);
  await assertSlugFree(null, body.slug);
  const t = await prisma.template.create({
    data: {
      name: body.name,
      slug: body.slug,
      description: body.description,
      isSystem: true,
      isGallery: body.isGallery,
      layoutId: body.layoutId,
      versions: { create: { version: 1, ...body.version, text: body.version.text ?? null, sampleData: (body.version.sampleData ?? undefined) as Prisma.InputJsonValue | undefined } },
    },
  });
  await audit(req.userId!, 'template.create', 'template', t.id, { slug: body.slug });
  res.status(201).json(t);
});

adminRouter.put('/templates/:id', async (req, res) => {
  const t = await prisma.template.findFirst({ where: { id: req.params.id, userId: null } });
  if (!t) throw notFound('Template');
  const body = parse(z.object({ name: z.string().trim().min(1).optional(), description: z.string().nullish(), isGallery: z.boolean().optional(), version: versionBody.optional() }), req.body);
  if (body.version) validateVersion(body.version);
  const next = t.currentVersion + 1;
  const { version, ...fields } = body;
  const updated = await prisma.template.update({
    where: { id: t.id },
    data: {
      ...fields,
      ...(version
        ? { currentVersion: next, versions: { create: { version: next, ...version, text: version.text ?? null, sampleData: (version.sampleData ?? undefined) as Prisma.InputJsonValue | undefined } } }
        : {}),
    },
  });
  await audit(req.userId!, 'template.update', 'template', t.id);
  res.json(updated);
});

adminRouter.delete('/templates/:id', async (req, res) => {
  const { count } = await prisma.template.deleteMany({ where: { id: req.params.id, userId: null } });
  if (!count) throw notFound('Template');
  await audit(req.userId!, 'template.delete', 'template', req.params.id);
  res.status(204).end();
});

adminRouter.get('/layouts', async (_req, res) => {
  res.json(await prisma.layout.findMany({ where: { isSystem: true } }));
});

adminRouter.put('/layouts/:id', async (req, res) => {
  const body = parse(z.object({ name: z.string().min(1).optional(), body: z.string().min(1).optional() }), req.body);
  if (body.body) validateTemplateSource(body.body, { layout: true });
  const { count } = await prisma.layout.updateMany({ where: { id: req.params.id, isSystem: true }, data: body });
  if (!count) throw notFound('Layout');
  await audit(req.userId!, 'layout.update', 'layout', req.params.id);
  res.json({ ok: true });
});

adminRouter.get('/messages', async (req, res) => {
  const q = parse(listQuery.extend({ userId: z.string().optional() }), req.query);
  const rows = await prisma.message.findMany({
    where: { ...messageWhere(q), ...(q.userId ? { userId: q.userId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    select: { ...messageListSelect, user: { select: { email: true } } },
  });
  res.json({ items: rows.slice(0, q.limit), nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null });
});

adminRouter.get('/messages/:id', async (req, res) => {
  const m = await prisma.message.findUnique({
    where: { id: req.params.id },
    include: { events: { orderBy: { createdAt: 'asc' } }, user: { select: { email: true } }, provider: { select: { name: true, type: true } } },
  });
  if (!m) throw notFound('Message');
  res.json(m);
});

adminRouter.get('/settings', async (_req, res) => {
  res.json(await prisma.setting.findMany({ orderBy: { key: 'asc' } }));
});

adminRouter.put('/settings/:key', async (req, res) => {
  const { value } = parse(z.object({ value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }), req.body);
  const key = parse(z.string().regex(/^[a-z0-9_]{1,64}$/), req.params.key);
  const row = await prisma.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
  invalidateSettings();
  await audit(req.userId!, 'setting.update', 'setting', key, { value });
  res.json(row);
});

adminRouter.get('/audit', async (req, res) => {
  const q = parse(page, req.query);
  res.json(
    await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { admin: { select: { email: true } } },
    }),
  );
});

