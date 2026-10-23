import { ProviderError, type OutboundMessage } from '@pingx/channels';
import { prisma } from '@pingx/db';
import { encryptJson, keyringFromEnv, redisKeys, type ProviderConfig } from '@pingx/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_FAILURE_LIMIT, processSend, RetryableSendError, type SendDeps } from './send';

const redis = new Redis(process.env.REDIS_URL!);
const keyring = keyringFromEnv();
type Behaviour = (config: ProviderConfig, msg: OutboundMessage) => Promise<{ providerMessageId?: string }>;

let behaviours: Record<string, Behaviour>;
const sent: { provider: string; msg: OutboundMessage }[] = [];
const webhookJobs: unknown[] = [];
const dlq: unknown[] = [];

const deps: SendDeps = {
  redis,
  keyring,
  channels: {
    send: async (provider, msg) => {
      const key = (provider.config as { apiKey: string }).apiKey;
      const result = await behaviours[key]!(provider, msg);
      sent.push({ provider: key, msg });
      return result;
    },
  },
  webhookQueue: { addBulk: vi.fn(async (jobs) => void webhookJobs.push(...jobs)) as never },
  dlqQueue: { add: vi.fn(async (_n, data) => void dlq.push(data)) as never },
};

let seq = 0;
async function fixture(providerKeys: string[], opts: { dailyCap?: number; webhook?: boolean } = {}) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'free' } });
  const user = await prisma.user.create({ data: { email: `w${Date.now()}${seq++}@t.dev`, planId: plan.id, emailVerifiedAt: new Date() } });
  const project = await prisma.project.create({ data: { userId: user.id, name: 'p' } });
  const providers = [];
  for (const [i, apiKey] of providerKeys.entries()) {
    const { data, keyVersion } = encryptJson(keyring, { apiKey });
    providers.push(
      await prisma.provider.create({
        data: { userId: user.id, name: apiKey, type: 'resend', priority: i + 1, fromEmail: `${apiKey}@x.dev`, fromName: 'Acme', configEnc: data, keyVersion, dailyCap: opts.dailyCap },
      }),
    );
  }
  if (opts.webhook) {
    const { data, keyVersion } = encryptJson(keyring, 'whsec');
    await prisma.webhook.create({ data: { projectId: project.id, url: 'https://hook.dev', secretEnc: data, keyVersion, events: ['message.sent', 'message.failed'] } });
  }
  const message = await prisma.message.create({
    data: { userId: user.id, projectId: project.id, to: ['r@x.dev'], subject: 's', html: '<p>h</p>', status: 'queued' },
  });
  return { user, project, providers, message };
}

const events = async (messageId: string) =>
  (await prisma.messageEvent.findMany({ where: { messageId }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);

const ok: Behaviour = async () => ({ providerMessageId: 'pm_1' });
const authFail: Behaviour = async () => { throw new ProviderError('provider', '535 auth failed', { auth: true }); };
const down: Behaviour = async () => { throw new ProviderError('provider', 'ETIMEDOUT'); };
const badRecipient: Behaviour = async () => { throw new ProviderError('recipient', '550 5.1.1 no such user'); };

beforeEach(() => {
  sent.length = 0;
  webhookJobs.length = 0;
  dlq.length = 0;
});

afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

describe('processSend', () => {
  it('sends via the first provider and records usage + webhook', async () => {
    behaviours = { a: ok, b: ok };
    const { message, providers, user } = await fixture(['a', 'b'], { webhook: true });
    await processSend(deps, message.id, { number: 1, max: 4 });
    const m = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(m).toMatchObject({ status: 'sent', providerId: providers[0]!.id, providerMessageId: 'pm_1', attempts: 1 });
    expect(sent[0]!.msg.from).toBe('"Acme" <a@x.dev>');
    expect(await events(message.id)).toEqual(['attempt', 'sent']);
    const usage = await prisma.usageDaily.findFirstOrThrow({ where: { userId: user.id } });
    expect(usage.sent).toBe(1);
    expect(webhookJobs).toMatchObject([{ data: { event: 'message.sent' } }]);
  });

  it('falls back to the next provider on provider-side errors', async () => {
    behaviours = { a: down, b: ok };
    const { message, providers } = await fixture(['a', 'b']);
    await processSend(deps, message.id, { number: 1, max: 4 });
    const m = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(m.providerId).toBe(providers[1]!.id);
    expect(await events(message.id)).toEqual(['attempt', 'fallback', 'attempt', 'sent']);
  });

  it('prefers the project default provider', async () => {
    behaviours = { a: ok, b: ok };
    const { message, providers, project } = await fixture(['a', 'b']);
    await prisma.project.update({ where: { id: project.id }, data: { defaultProviderId: providers[1]!.id } });
    await processSend(deps, message.id, { number: 1, max: 4 });
    expect(sent.map((s) => s.provider)).toEqual(['b']);
  });

  it('fails without fallback on recipient errors', async () => {
    behaviours = { a: badRecipient, b: ok };
    const { message, user } = await fixture(['a', 'b'], { webhook: true });
    await processSend(deps, message.id, { number: 1, max: 4 });
    const m = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(m.status).toBe('failed');
    expect(m.error).toContain('5.1.1');
    expect(sent).toHaveLength(0);
    expect((await prisma.usageDaily.findFirstOrThrow({ where: { userId: user.id } })).failed).toBe(1);
    expect(webhookJobs).toMatchObject([{ data: { event: 'message.failed' } }]);
  });

  it('retries when every provider fails, then fails into the DLQ on the last attempt', async () => {
    behaviours = { a: down };
    const { message } = await fixture(['a']);
    await expect(processSend(deps, message.id, { number: 1, max: 2 })).rejects.toBeInstanceOf(RetryableSendError);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('queued');
    await processSend(deps, message.id, { number: 2, max: 2 });
    const m = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(m).toMatchObject({ status: 'failed', attempts: 2 });
    expect(dlq).toEqual([expect.objectContaining({ messageId: message.id })]);
  });

  it(`marks a provider unhealthy after ${AUTH_FAILURE_LIMIT} consecutive auth failures and resets on success`, async () => {
    behaviours = { a: authFail, b: ok };
    const { providers, user, project } = await fixture(['a', 'b']);
    for (let i = 0; i < AUTH_FAILURE_LIMIT; i++) {
      const m = await prisma.message.create({ data: { userId: user.id, projectId: project.id, to: ['r@x.dev'], subject: 's', html: 'h', status: 'queued' } });
      await processSend(deps, m.id, { number: 1, max: 4 });
    }
    const a = await prisma.provider.findUniqueOrThrow({ where: { id: providers[0]!.id } });
    expect(a).toMatchObject({ healthy: false, consecutiveAuthFailures: AUTH_FAILURE_LIMIT });

    sent.length = 0;
    const m = await prisma.message.create({ data: { userId: user.id, projectId: project.id, to: ['r@x.dev'], subject: 's', html: 'h', status: 'queued' } });
    await processSend(deps, m.id, { number: 1, max: 4 });
    expect(sent.map((s) => s.provider)).toEqual(['b']);
  });

  it('skips a provider over its daily cap', async () => {
    behaviours = { a: ok, b: ok };
    const { message, providers } = await fixture(['a', 'b'], { dailyCap: 1 });
    await redis.set(redisKeys.providerDay(providers[0]!.id), '1');
    await processSend(deps, message.id, { number: 1, max: 4 });
    expect(sent.map((s) => s.provider)).toEqual(['b']);
    expect(await events(message.id)).toEqual(['fallback', 'attempt', 'sent']);
  });

  it('fails immediately when no healthy provider exists', async () => {
    const { message } = await fixture([]);
    await processSend(deps, message.id, { number: 1, max: 4 });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('failed');
  });

  it('is idempotent for already-sent messages', async () => {
    behaviours = { a: ok };
    const { message } = await fixture(['a']);
    await processSend(deps, message.id, { number: 1, max: 4 });
    await processSend(deps, message.id, { number: 1, max: 4 });
    expect(sent).toHaveLength(1);
  });
});
