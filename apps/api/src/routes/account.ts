import { prisma } from '@pingx/db';
import { AppError, encrypt } from '@pingx/shared';
import { Router } from 'express';
import { z } from 'zod';
import { keyring } from '../lib/infra';
import { parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';
import { assertSafeBaseUrl, DEFAULT_MODELS, loadAiConfig, runAi, type AiConfig } from '../services/ai';

const MASK = '••••';

const aiBody = z.object({
  provider: z.enum(['anthropic', 'openai', 'gemini', 'openai_compatible']),
  model: z.string().trim().max(200).optional(),
  baseUrl: z.string().trim().url().nullish(),
  /** Omit or send •••• to keep the saved key. */
  apiKey: z.string().trim().max(500).optional(),
});

/** Merges the request with the saved key so users can change model/provider settings without re-typing it. */
async function resolve(userId: string, body: z.infer<typeof aiBody>): Promise<AiConfig> {
  const model = body.model || DEFAULT_MODELS[body.provider];
  if (!model) throw new AppError('validation_error', 400, 'Model is required for this provider');
  if (body.provider === 'openai_compatible' && !body.baseUrl) throw new AppError('validation_error', 400, 'Base URL is required');
  if (body.baseUrl) await assertSafeBaseUrl(body.baseUrl);
  let apiKey = body.apiKey && body.apiKey !== MASK ? body.apiKey : undefined;
  if (!apiKey) apiKey = (await loadAiConfig(userId))?.apiKey;
  if (!apiKey) throw new AppError('validation_error', 400, 'API key is required');
  return { provider: body.provider, model, baseUrl: body.provider === 'openai_compatible' ? body.baseUrl : null, apiKey };
}

export const accountRouter = Router();
accountRouter.use(requireUser);

accountRouter.get('/ai', async (req, res) => {
  const row = await prisma.aiSetting.findUnique({ where: { userId: req.userId } });
  res.json(row ? { provider: row.provider, model: row.model, baseUrl: row.baseUrl, apiKey: MASK, updatedAt: row.updatedAt } : null);
});

accountRouter.put('/ai', async (req, res) => {
  const cfg = await resolve(req.userId!, parse(aiBody, req.body));
  const { data, keyVersion } = encrypt(keyring, cfg.apiKey);
  const fields = { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl ?? null, apiKeyEnc: data, keyVersion };
  const row = await prisma.aiSetting.upsert({ where: { userId: req.userId }, update: fields, create: { ...fields, userId: req.userId! } });
  res.json({ provider: row.provider, model: row.model, baseUrl: row.baseUrl, apiKey: MASK, updatedAt: row.updatedAt });
});

/** Runs a tiny real request with the (unsaved) settings. Nothing is stored. */
accountRouter.post('/ai/test', async (req, res) => {
  const cfg = await resolve(req.userId!, parse(aiBody, req.body));
  const started = Date.now();
  try {
    const draft = await runAi(cfg, 'A one-line test email that says hello to {{name}}.');
    res.json({ ok: true, durationMs: Date.now() - started, subject: draft.subject });
  } catch (err) {
    res.json({ ok: false, durationMs: Date.now() - started, error: err instanceof Error ? err.message : 'Request failed' });
  }
});

accountRouter.delete('/ai', async (req, res) => {
  await prisma.aiSetting.deleteMany({ where: { userId: req.userId } });
  res.status(204).end();
});
