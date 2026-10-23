import { formatFrom, ProviderError } from '@pingx/channels';
import { prisma, type Provider } from '@pingx/db';
import {
  AppError,
  decryptJson,
  encryptJson,
  maskConfig,
  providerConfigSchema,
  type ProviderConfig,
} from '@pingx/shared';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env';
import { channels } from '../lib/channels';
import { keyring } from '../lib/infra';
import { signState, verifyState } from '../lib/jwt';
import { notFound, parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';

const MASK = '••••';
const GMAIL_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send';
const gmailRedirectUri = () => `${env.API_URL}/providers/gmail/callback`;

const meta = z.object({
  name: z.string().trim().min(1).max(100),
  fromEmail: z.string().trim().toLowerCase().email(),
  fromName: z.string().trim().max(100).nullish(),
  dailyCap: z.number().int().positive().nullish(),
  ratePerSecond: z.number().int().positive().nullish(),
});

/** Never returns secrets: decrypted config is masked before leaving the API. */
function serialize(p: Provider) {
  const config = decryptJson<Record<string, unknown>>(keyring, p.configEnc, p.keyVersion);
  const { configEnc: _c, keyVersion: _k, ...rest } = p;
  return { ...rest, config: maskConfig(config) };
}

/** Fills masked secret fields from the stored config so an edited form can be tested or saved. */
function mergeSecrets(incoming: Record<string, unknown>, stored: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v === MASK ? stored[k] : v]));
}

async function ownedProvider(userId: string, id: string) {
  const p = await prisma.provider.findFirst({ where: { id, userId } });
  if (!p) throw notFound('Provider');
  return p;
}

async function resolveConfig(userId: string, body: { type: string; config: Record<string, unknown>; providerId?: string }) {
  let config = body.config;
  if (body.providerId) {
    const stored = await ownedProvider(userId, body.providerId);
    config = mergeSecrets(config, decryptJson(keyring, stored.configEnc, stored.keyVersion));
  }
  return parse(providerConfigSchema, { type: body.type, config });
}

export const providersRouter = Router();
providersRouter.use(requireUser);

providersRouter.get('/', async (req, res) => {
  const rows = await prisma.provider.findMany({ where: { userId: req.userId }, orderBy: { priority: 'asc' } });
  res.json(rows.map(serialize));
});

providersRouter.get('/presets', async (_req, res) => {
  res.json(await prisma.providerPreset.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }));
});

const testSchema = z.object({
  type: z.enum(['smtp', 'gmail_oauth', 'resend', 'ses']),
  config: z.record(z.unknown()),
  providerId: z.string().optional(),
  fromEmail: z.string().email(),
  fromName: z.string().max(100).nullish(),
  to: z.string().email().optional(),
});

/** Sends a real test email using the unsaved config. Nothing is persisted. */
providersRouter.post('/test', async (req, res) => {
  const body = parse(testSchema, req.body);
  const provider = await resolveConfig(req.userId!, body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { email: true } });
  const started = Date.now();
  try {
    const result = await channels.send(provider, {
      from: formatFrom(body.fromEmail, body.fromName),
      to: [body.to ?? user.email],
      subject: 'PingX test email',
      html: '<p>Your provider is connected to <b>PingX</b>. 🎉</p>',
      text: 'Your provider is connected to PingX.',
    });
    res.json({ ok: true, durationMs: Date.now() - started, providerMessageId: result.providerMessageId });
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError('provider', (err as Error).message);
    res.json({ ok: false, durationMs: Date.now() - started, error: e.message, side: e.side, auth: e.isAuth });
  }
});

providersRouter.post('/', async (req, res) => {
  const body = parse(meta.extend({ type: z.enum(['smtp', 'resend', 'ses']), config: z.record(z.unknown()) }), req.body);
  const provider = parse(providerConfigSchema, { type: body.type, config: body.config });
  const created = await createProvider(req.userId!, body, provider);
  res.status(201).json(serialize(created));
});

async function createProvider(userId: string, m: z.infer<typeof meta>, provider: ProviderConfig) {
  const { data, keyVersion } = encryptJson(keyring, provider.config);
  const last = await prisma.provider.aggregate({ where: { userId }, _max: { priority: true } });
  return prisma.provider.create({
    data: {
      userId,
      name: m.name,
      type: provider.type,
      fromEmail: m.fromEmail,
      fromName: m.fromName ?? null,
      dailyCap: m.dailyCap ?? null,
      ratePerSecond: m.ratePerSecond ?? null,
      priority: (last._max.priority ?? 0) + 1,
      configEnc: data,
      keyVersion,
    },
  });
}

providersRouter.patch('/:id', async (req, res) => {
  const existing = await ownedProvider(req.userId!, req.params.id!);
  const body = parse(meta.partial().extend({ config: z.record(z.unknown()).optional() }), req.body);
  let encrypted = {};
  if (body.config) {
    const config = mergeSecrets(body.config, decryptJson(keyring, existing.configEnc, existing.keyVersion));
    const provider = parse(providerConfigSchema, { type: existing.type, config });
    const { data, keyVersion } = encryptJson(keyring, provider.config);
    encrypted = { configEnc: data, keyVersion, healthy: true, consecutiveAuthFailures: 0, lastError: null };
  }
  const { config: _c, ...fields } = body;
  const updated = await prisma.provider.update({ where: { id: existing.id }, data: { ...fields, ...encrypted } });
  res.json(serialize(updated));
});

providersRouter.post('/:id/reset-health', async (req, res) => {
  const p = await ownedProvider(req.userId!, req.params.id!);
  const updated = await prisma.provider.update({ where: { id: p.id }, data: { healthy: true, consecutiveAuthFailures: 0, lastError: null } });
  res.json(serialize(updated));
});

providersRouter.put('/order', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string()).min(1) }), req.body);
  const owned = await prisma.provider.findMany({ where: { userId: req.userId }, select: { id: true } });
  const ownedIds = new Set(owned.map((p) => p.id));
  if (ids.length !== ownedIds.size || new Set(ids).size !== ids.length || !ids.every((id) => ownedIds.has(id))) {
    throw new AppError('validation_error', 400, 'ids must list every provider exactly once');
  }
  await prisma.$transaction(ids.map((id, i) => prisma.provider.update({ where: { id }, data: { priority: i + 1 } })));
  res.json({ ok: true });
});

providersRouter.delete('/:id', async (req, res) => {
  const p = await ownedProvider(req.userId!, req.params.id!);
  await prisma.provider.delete({ where: { id: p.id } });
  const rest = await prisma.provider.findMany({ where: { userId: req.userId }, orderBy: { priority: 'asc' } });
  await prisma.$transaction(rest.map((r, i) => prisma.provider.update({ where: { id: r.id }, data: { priority: i + 1 } })));
  res.status(204).end();
});

providersRouter.post('/gmail/authorize', async (req, res) => {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError('google_disabled', 400, 'Google OAuth is not configured on this server');
  const body = parse(meta.pick({ name: true, fromName: true, dailyCap: true }), req.body);
  const state = await signState({ userId: req.userId!, name: body.name, fromName: body.fromName ?? '', dailyCap: String(body.dailyCap ?? '') });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: gmailRedirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  res.json({ url: url.toString() });
});

export const gmailCallbackRouter = Router();

gmailCallbackRouter.get('/providers/gmail/callback', async (req, res) => {
  const done = (q: string) => res.redirect(`${env.APP_URL}/providers?${q}`);
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error || !code || !state) return done(`gmail_error=${encodeURIComponent(error ?? 'missing_code')}`);
  let s: Record<string, unknown>;
  try {
    s = await verifyState(state);
  } catch {
    return done('gmail_error=invalid_state');
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: gmailRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const tokens = (await tokenRes.json()) as { refresh_token?: string; id_token?: string };
  if (!tokenRes.ok || !tokens.refresh_token || !tokens.id_token) return done('gmail_error=token_exchange_failed');
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1]!, 'base64url').toString()) as { email?: string };
  if (!claims.email) return done('gmail_error=no_email');

  await createProvider(
    String(s.userId),
    { name: String(s.name), fromEmail: claims.email.toLowerCase(), fromName: String(s.fromName) || null, dailyCap: Number(s.dailyCap) || 500 },
    { type: 'gmail_oauth', config: { email: claims.email, refreshToken: tokens.refresh_token } },
  );
  done('gmail_connected=1');
});
