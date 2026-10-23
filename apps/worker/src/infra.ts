import { createChannels } from '@pingx/channels';
import { keyringFromEnv, QUEUES, WEBHOOK_JOB_OPTIONS, type WebhookJob } from '@pingx/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const keyring = keyringFromEnv();
export const channels = createChannels({
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  allowPrivateHosts: env.NODE_ENV !== 'production',
});
export const webhookQueue = new Queue<WebhookJob>(QUEUES.webhook, { connection: redis, defaultJobOptions: WEBHOOK_JOB_OPTIONS });
export const dlqQueue = new Queue(QUEUES.sendDlq, { connection: redis });
