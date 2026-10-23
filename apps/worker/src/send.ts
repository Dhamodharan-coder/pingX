import { formatFrom, type Channels } from '@pingx/channels';
import { prisma, type MessageEventType, type Provider } from '@pingx/db';
import { decryptJson, redisKeys, utcDay, type Keyring, type ProviderConfig, type WebhookEvent, type WebhookJob } from '@pingx/shared';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { orderChain, runChain } from './chain';

export const AUTH_FAILURE_LIMIT = 5;
const CAP_BLOCK_SECONDS = 15 * 60;
const blockKey = (providerId: string) => `prov:block:${providerId}`;

export interface SendDeps {
  redis: Redis;
  keyring: Keyring;
  channels: Pick<Channels, 'send'>;
  webhookQueue: Pick<Queue<WebhookJob>, 'addBulk'>;
  dlqQueue: Pick<Queue, 'add'>;
}

export class RetryableSendError extends Error {}

const event = (messageId: string, type: MessageEventType, detail?: string, providerId?: string) =>
  prisma.messageEvent.create({ data: { messageId, type, detail: detail?.slice(0, 2000), providerId } });

async function bumpUsage(userId: string, field: 'sent' | 'failed') {
  const date = new Date(`${utcDay()}T00:00:00Z`);
  await prisma.usageDaily.upsert({
    where: { userId_date: { userId, date } },
    update: { [field]: { increment: 1 } },
    create: { userId, date, [field]: 1 },
  });
}

async function notifyWebhooks(deps: SendDeps, projectId: string, evt: WebhookEvent, payload: Record<string, unknown>) {
  const hooks = await prisma.webhook.findMany({ where: { projectId, active: true, events: { has: evt } }, select: { id: true } });
  if (hooks.length) {
    await deps.webhookQueue.addBulk(hooks.map((h) => ({ name: 'deliver', data: { webhookId: h.id, event: evt, payload } })));
  }
}

async function skipReason(deps: SendDeps, p: Provider): Promise<string | null> {
  if (await deps.redis.exists(blockKey(p.id))) return 'provider temporarily blocked after a cap/rate-limit error';
  if (p.ratePerSecond) {
    const key = redisKeys.providerSecond(p.id, Math.floor(Date.now() / 1000));
    const n = await deps.redis.incr(key);
    if (n === 1) await deps.redis.expire(key, 2);
    if (n > p.ratePerSecond) return `rate limit of ${p.ratePerSecond}/s reached`;
  }
  if (p.dailyCap) {
    const key = redisKeys.providerDay(p.id);
    const n = await deps.redis.incr(key);
    if (n === 1) await deps.redis.expire(key, 60 * 60 * 48);
    if (n > p.dailyCap) {
      await deps.redis.decr(key);
      return `daily cap of ${p.dailyCap} reached`;
    }
  }
  return null;
}

/**
 * One delivery attempt for a message: walk the provider chain, record events, update
 * provider health. Throws RetryableSendError when every provider failed provider-side and
 * BullMQ attempts remain; on the final attempt the message is failed and copied to the DLQ.
 */
export async function processSend(deps: SendDeps, messageId: string, attempt: { number: number; max: number }) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { project: { select: { defaultProviderId: true } } } });
  if (!message || message.status === 'sent' || message.status === 'failed') return;

  await prisma.message.update({ where: { id: message.id }, data: { status: 'sending', attempts: { increment: 1 } } });
  const providers = orderChain(await prisma.provider.findMany({ where: { userId: message.userId } }), message.project.defaultProviderId);

  const fail = async (error: string) => {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error: error.slice(0, 2000) } });
    await event(message.id, 'failed', error);
    await bumpUsage(message.userId, 'failed');
    await notifyWebhooks(deps, message.projectId, 'message.failed', { message: { id: message.id, status: 'failed', to: message.to, error } });
  };

  if (providers.length === 0) return fail('No healthy provider available. Check your providers in the dashboard.');

  const result = await runChain(providers, {
    skipReason: (p) => skipReason(deps, p),
    send: (p) => {
      const provider = { type: p.type, config: decryptJson(deps.keyring, p.configEnc, p.keyVersion) } as ProviderConfig;
      return deps.channels.send(provider, {
        from: formatFrom(p.fromEmail, message.fromOverride ?? p.fromName),
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo ?? undefined,
        subject: message.subject,
        html: message.html,
        text: message.text ?? undefined,
        headers: { 'X-PingX-Message-Id': message.id },
      });
    },
    onEvent: async (e) => {
      if (e.type === 'skipped') return void (await event(message.id, 'fallback', `${e.provider.name}: ${e.reason}`, e.provider.id));
      if (e.type === 'attempt') return void (await event(message.id, 'attempt', `via ${e.provider.name} (${e.provider.type})`, e.provider.id));
      const { provider, error } = e;
      await event(message.id, 'fallback', `${provider.name}: ${error.message}`, provider.id);
      if (error.opts.cap) await deps.redis.set(blockKey(provider.id), '1', 'EX', CAP_BLOCK_SECONDS);
      if (error.isAuth) {
        const updated = await prisma.provider.update({
          where: { id: provider.id },
          data: { consecutiveAuthFailures: { increment: 1 }, lastError: error.message.slice(0, 1000) },
        });
        if (updated.consecutiveAuthFailures >= AUTH_FAILURE_LIMIT) {
          await prisma.provider.update({ where: { id: provider.id }, data: { healthy: false } });
        }
      } else {
        await prisma.provider.update({ where: { id: provider.id }, data: { lastError: error.message.slice(0, 1000) } });
      }
    },
  });

  if (result.status === 'sent') {
    const now = new Date();
    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: { status: 'sent', sentAt: now, providerId: result.provider.id, providerMessageId: result.result.providerMessageId, error: null },
      }),
      prisma.provider.update({ where: { id: result.provider.id }, data: { consecutiveAuthFailures: 0, lastUsedAt: now } }),
    ]);
    await event(message.id, 'sent', result.result.providerMessageId, result.provider.id);
    await bumpUsage(message.userId, 'sent');
    await notifyWebhooks(deps, message.projectId, 'message.sent', {
      message: { id: message.id, status: 'sent', to: message.to, providerMessageId: result.result.providerMessageId, sentAt: now },
    });
    return;
  }

  if (result.status === 'recipient_error') {
    await prisma.message.update({ where: { id: message.id }, data: { providerId: result.provider.id } });
    return fail(result.error.message);
  }

  const summary = result.errors.length
    ? result.errors.map((e) => e.message).join(' | ')
    : 'All providers are capped or rate limited';
  if (attempt.number < attempt.max) {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'queued', error: summary.slice(0, 2000) } });
    await event(message.id, 'retry', `attempt ${attempt.number}/${attempt.max} failed; retrying`);
    throw new RetryableSendError(summary);
  }
  await fail(`All providers failed after ${attempt.max} attempts: ${summary}`);
  await deps.dlqQueue.add('dead', { messageId: message.id, error: summary });
}
