import { prisma } from '@pingx/db';
import { QUEUES, type SendJob, type SystemEmailJob, type WebhookJob } from '@pingx/shared';
import { Queue, Worker } from 'bullmq';
import { env } from './env';
import { channels, dlqQueue, keyring, redis, webhookQueue } from './infra';
import { processSend } from './send';
import { sendSystemEmail } from './system';
import { deliverWebhook } from './webhooks';

const connection = redis;
const deps = { redis, keyring, channels, webhookQueue, dlqQueue };

const workers = [
  new Worker<SendJob>(
    QUEUES.send,
    (job) => processSend(deps, job.data.messageId, { number: job.attemptsMade + 1, max: job.opts.attempts ?? 1 }),
    { connection, concurrency: env.WORKER_CONCURRENCY },
  ),
  new Worker<WebhookJob>(QUEUES.webhook, (job) => deliverWebhook(keyring, job.data), { connection, concurrency: 5 }),
  new Worker<SystemEmailJob>(QUEUES.system, (job) => sendSystemEmail(job.data), { connection, concurrency: 2 }),
  new Worker(
    'maintenance',
    async () => {
      const now = new Date();
      const old = new Date(Date.now() - 30 * 86_400_000);
      await prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: old } }] } });
      await prisma.userToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { usedAt: { lt: old } }] } });
    },
    { connection },
  ),
];

for (const w of workers) {
  w.on('failed', (job, err) => console.warn(`[${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
  w.on('error', (err) => console.error(`[${w.name}]`, err));
}

const maintenance = new Queue('maintenance', { connection });
await maintenance.upsertJobScheduler('daily-cleanup', { pattern: '0 3 * * *', tz: 'UTC' }, { name: 'cleanup' });

console.log(`worker started (${env.NODE_ENV}), concurrency ${env.WORKER_CONCURRENCY}`);

const shutdown = async () => {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([maintenance.close(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
