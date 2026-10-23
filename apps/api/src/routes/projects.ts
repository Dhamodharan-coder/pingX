import { prisma } from '@pingx/db';
import { AppError, encrypt, generateApiKey, randomToken, WEBHOOK_EVENTS } from '@pingx/shared';
import { Router } from 'express';
import { z } from 'zod';
import { keyring, webhookQueue } from '../lib/infra';
import { notFound, parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';

export const projectsRouter = Router();
projectsRouter.use(requireUser);

async function ownedProject(userId: string, id: string) {
  const p = await prisma.project.findFirst({ where: { id, userId } });
  if (!p) throw notFound('Project');
  return p;
}

const projectBody = z.object({
  name: z.string().trim().min(1).max(100),
  defaultProviderId: z.string().nullish(),
});

async function assertProvider(userId: string, providerId: string | null | undefined) {
  if (providerId && !(await prisma.provider.findFirst({ where: { id: providerId, userId } }))) throw notFound('Provider');
}

projectsRouter.get('/', async (req, res) => {
  const rows = await prisma.project.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { apiKeys: { where: { revokedAt: null } }, messages: true } } },
  });
  res.json(rows);
});

projectsRouter.post('/', async (req, res) => {
  const body = parse(projectBody, req.body);
  await assertProvider(req.userId!, body.defaultProviderId);
  const count = await prisma.project.count({ where: { userId: req.userId } });
  if (count >= 20) throw new AppError('limit_reached', 400, 'Project limit reached');
  res.status(201).json(await prisma.project.create({ data: { ...body, userId: req.userId! } }));
});

projectsRouter.patch('/:id', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const body = parse(projectBody.partial(), req.body);
  await assertProvider(req.userId!, body.defaultProviderId);
  res.json(await prisma.project.update({ where: { id: p.id }, data: body }));
});

projectsRouter.delete('/:id', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  await prisma.project.delete({ where: { id: p.id } });
  res.status(204).end();
});

projectsRouter.get('/:id/api-keys', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  res.json(
    await prisma.apiKey.findMany({
      where: { projectId: p.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    }),
  );
});

/** The full key is returned only in this response; only its SHA-256 hash is stored. */
projectsRouter.post('/:id/api-keys', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
  const { key, hash, prefix } = generateApiKey();
  const row = await prisma.apiKey.create({ data: { projectId: p.id, name, prefix, keyHash: hash } });
  res.status(201).json({ id: row.id, name: row.name, prefix, key, createdAt: row.createdAt });
});

projectsRouter.delete('/:id/api-keys/:keyId', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const { count } = await prisma.apiKey.updateMany({ where: { id: req.params.keyId, projectId: p.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw notFound('API key');
  res.status(204).end();
});

projectsRouter.get('/:id/webhooks', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  res.json(
    await prisma.webhook.findMany({
      where: { projectId: p.id },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    }),
  );
});

projectsRouter.post('/:id/webhooks', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const body = parse(
    z.object({
      url: z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'Webhook URL must use https'),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).default([...WEBHOOK_EVENTS]),
    }),
    req.body,
  );
  const secret = `whsec_${randomToken(24)}`;
  const { data, keyVersion } = encrypt(keyring, secret);
  const row = await prisma.webhook.create({ data: { projectId: p.id, url: body.url, events: body.events, secretEnc: data, keyVersion } });
  res.status(201).json({ id: row.id, url: row.url, events: row.events, active: row.active, secret });
});

projectsRouter.patch('/:id/webhooks/:wid', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const body = parse(z.object({ active: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional() }), req.body);
  const { count } = await prisma.webhook.updateMany({ where: { id: req.params.wid, projectId: p.id }, data: body });
  if (!count) throw notFound('Webhook');
  res.json({ ok: true });
});

projectsRouter.delete('/:id/webhooks/:wid', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const { count } = await prisma.webhook.deleteMany({ where: { id: req.params.wid, projectId: p.id } });
  if (!count) throw notFound('Webhook');
  res.status(204).end();
});

projectsRouter.post('/:id/webhooks/:wid/test', async (req, res) => {
  const p = await ownedProject(req.userId!, req.params.id!);
  const hook = await prisma.webhook.findFirst({ where: { id: req.params.wid, projectId: p.id } });
  if (!hook) throw notFound('Webhook');
  await webhookQueue.add('deliver', {
    webhookId: hook.id,
    event: 'message.sent',
    payload: { test: true, message: { id: 'msg_test', status: 'sent', to: ['test@example.com'] } },
  });
  res.json({ ok: true });
});
