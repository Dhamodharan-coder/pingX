import { keyringFromEnv, QUEUES, SYSTEM_JOB_OPTIONS, WEBHOOK_JOB_OPTIONS, type SendJob, type SystemEmailJob, type WebhookJob } from '@pingx/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../env';

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const keyring = keyringFromEnv();

const connection = redis;
export const sendQueue = new Queue<SendJob>(QUEUES.send, { connection });
export const webhookQueue = new Queue<WebhookJob>(QUEUES.webhook, { connection, defaultJobOptions: WEBHOOK_JOB_OPTIONS });
export const systemQueue = new Queue<SystemEmailJob>(QUEUES.system, { connection, defaultJobOptions: SYSTEM_JOB_OPTIONS });
