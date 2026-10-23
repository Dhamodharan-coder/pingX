import { prisma, type Prisma } from '@pingx/db';
import { AppError } from '@pingx/shared';
import { validateTemplateSource } from '@pingx/templates';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';
import { draftTemplate } from '../services/ai';
import { createMessages } from '../services/send';
import { assertLayoutAccess, renderVersion } from '../services/templates';

export const versionBody = z.object({
  subject: z.string().min(1).max(998),
  format: z.enum(['mjml', 'html']),
  body: z.string().min(1).max(512_000),
  text: z.string().max(256_000).nullish(),
  sampleData: z.record(z.unknown()).nullish(),
});

export const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes');

export function validateVersion(v: z.infer<typeof versionBody>) {
  validateTemplateSource(v.subject);
  validateTemplateSource(v.body);
  if (v.text) validateTemplateSource(v.text);
}

const versionData = (v: z.infer<typeof versionBody>) => ({
  subject: v.subject,
  format: v.format,
  body: v.body,
  text: v.text ?? null,
  sampleData: (v.sampleData ?? undefined) as Prisma.InputJsonValue | undefined,
});

export const templatesRouter = Router();
templatesRouter.use(requireUser);

async function ownedTemplate(userId: string, id: string) {
  const t = await prisma.template.findFirst({ where: { id, userId } });
  if (!t) throw notFound('Template');
  return t;
}

const withCurrent = { versions: { orderBy: { version: 'desc' as const }, take: 1 } };

templatesRouter.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  res.json(
    await prisma.template.findMany({
      where: { userId: req.userId, ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}) },
      orderBy: { updatedAt: 'desc' },
      include: withCurrent,
    }),
  );
});

templatesRouter.get('/gallery', async (_req, res) => {
  res.json(await prisma.template.findMany({ where: { isGallery: true }, orderBy: { name: 'asc' }, include: withCurrent }));
});

templatesRouter.get('/:id', async (req, res) => {
  const t = await prisma.template.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  if (!t) throw notFound('Template');
  res.json(t);
});

templatesRouter.post('/', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100),
      slug,
      description: z.string().max(500).nullish(),
      projectId: z.string().nullish(),
      layoutId: z.string().nullish(),
      fromGalleryId: z.string().optional(),
      version: versionBody.optional(),
    }),
    req.body,
  );
  let version = body.version;
  let layoutId = body.layoutId;
  if (body.fromGalleryId) {
    const g = await prisma.template.findFirst({ where: { id: body.fromGalleryId, isGallery: true }, include: withCurrent });
    const v = g?.versions[0];
    if (!g || !v) throw notFound('Gallery template');
    version = { subject: v.subject, format: v.format, body: v.body, text: v.text, sampleData: v.sampleData as Record<string, unknown> | null };
    layoutId ??= g.layoutId;
  }
  if (!version) throw new AppError('validation_error', 400, 'version or fromGalleryId is required');
  validateVersion(version);
  await assertLayoutAccess(req.userId!, layoutId);
  if (body.projectId && !(await prisma.project.findFirst({ where: { id: body.projectId, userId: req.userId } }))) throw notFound('Project');
  if (await prisma.template.findFirst({ where: { userId: req.userId, slug: body.slug } })) {
    throw new AppError('slug_taken', 409, `A template with slug "${body.slug}" already exists`);
  }
  const t = await prisma.template.create({
    data: {
      userId: req.userId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      projectId: body.projectId,
      layoutId,
      versions: { create: { version: 1, ...versionData(version) } },
    },
    include: withCurrent,
  });
  res.status(201).json(t);
});

/** Saving content always creates a new version; older versions stay for rollback. */
templatesRouter.put('/:id', async (req, res) => {
  const t = await ownedTemplate(req.userId!, req.params.id!);
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(500).nullish(),
      layoutId: z.string().nullish(),
      projectId: z.string().nullish(),
      version: versionBody.optional(),
    }),
    req.body,
  );
  if (body.version) validateVersion(body.version);
  await assertLayoutAccess(req.userId!, body.layoutId);
  const next = t.currentVersion + 1;
  const updated = await prisma.template.update({
    where: { id: t.id },
    data: {
      name: body.name,
      description: body.description,
      layoutId: body.layoutId,
      projectId: body.projectId,
      ...(body.version ? { currentVersion: next, versions: { create: { version: next, ...versionData(body.version) } } } : {}),
    },
    include: withCurrent,
  });
  res.json(updated);
});

templatesRouter.post('/:id/rollback', async (req, res) => {
  const t = await ownedTemplate(req.userId!, req.params.id!);
  const { version } = parse(z.object({ version: z.number().int().positive() }), req.body);
  const old = await prisma.templateVersion.findUnique({ where: { templateId_version: { templateId: t.id, version } } });
  if (!old) throw notFound('Version');
  const next = t.currentVersion + 1;
  const updated = await prisma.template.update({
    where: { id: t.id },
    data: {
      currentVersion: next,
      versions: { create: { version: next, subject: old.subject, format: old.format, body: old.body, text: old.text, sampleData: old.sampleData ?? undefined } },
    },
    include: withCurrent,
  });
  res.json(updated);
});

templatesRouter.delete('/:id', async (req, res) => {
  const t = await ownedTemplate(req.userId!, req.params.id!);
  await prisma.template.delete({ where: { id: t.id } });
  res.status(204).end();
});

templatesRouter.post('/preview', async (req, res) => {
  const body = parse(versionBody.extend({ layoutId: z.string().nullish(), data: z.record(z.unknown()).default({}) }), req.body);
  validateVersion(body);
  await assertLayoutAccess(req.userId!, body.layoutId);
  const layout = body.layoutId ? await prisma.layout.findUnique({ where: { id: body.layoutId } }) : null;
  res.json(await renderVersion({ ...body, text: body.text ?? null }, layout, body.data));
});

templatesRouter.post('/:id/test-send', async (req, res) => {
  const t = await ownedTemplate(req.userId!, req.params.id!);
  const body = parse(z.object({ projectId: z.string(), to: z.string().email().optional(), data: z.record(z.unknown()).optional() }), req.body);
  if (!(await prisma.project.findFirst({ where: { id: body.projectId, userId: req.userId } }))) throw notFound('Project');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  const current = await prisma.templateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: t.id, version: t.currentVersion } } });
  const { messages } = await createMessages(
    { userId: req.userId!, projectId: body.projectId },
    [{ to: [body.to ?? user.email], template: t.id, data: body.data ?? (current.sampleData as Record<string, unknown>) ?? {}, tags: ['test'] }],
    { res },
  );
  res.status(202).json({ id: messages[0]!.id });
});

templatesRouter.post('/ai', async (req, res) => {
  const body = parse(
    z.object({
      prompt: z.string().trim().min(3).max(4000),
      current: z.object({ subject: z.string().max(998), body: z.string().max(100_000) }).optional(),
    }),
    req.body,
  );
  const draft = await draftTemplate(req.userId!, body.prompt, body.current);
  validateVersion({ subject: draft.subject, body: draft.body, format: 'mjml' });
  res.json(draft);
});

export const layoutsRouter = Router();
layoutsRouter.use(requireUser);

const layoutBody = z.object({ name: z.string().trim().min(1).max(100), format: z.enum(['mjml', 'html']), body: z.string().min(1).max(256_000) });

layoutsRouter.get('/', async (req, res) => {
  res.json(await prisma.layout.findMany({ where: { OR: [{ userId: req.userId }, { isSystem: true }] }, orderBy: { createdAt: 'asc' } }));
});

layoutsRouter.post('/', async (req, res) => {
  const body = parse(layoutBody, req.body);
  validateTemplateSource(body.body, { layout: true });
  res.status(201).json(await prisma.layout.create({ data: { ...body, userId: req.userId } }));
});

layoutsRouter.put('/:id', async (req, res) => {
  const body = parse(layoutBody.partial(), req.body);
  if (body.body) validateTemplateSource(body.body, { layout: true });
  const { count } = await prisma.layout.updateMany({ where: { id: req.params.id, userId: req.userId }, data: body });
  if (!count) throw notFound('Layout');
  res.json(await prisma.layout.findUnique({ where: { id: req.params.id } }));
});

layoutsRouter.delete('/:id', async (req, res) => {
  const { count } = await prisma.layout.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!count) throw notFound('Layout');
  res.status(204).end();
});
