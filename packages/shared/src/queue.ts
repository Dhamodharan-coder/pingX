export const QUEUES = {
  send: 'send',
  sendDlq: 'send-dlq',
  webhook: 'webhook',
  system: 'system-email',
} as const;

export interface SendJob {
  messageId: string;
}

export interface WebhookJob {
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

export interface SystemEmailJob {
  to: string;
  subject: string;
  html: string;
}

export const WEBHOOK_EVENTS = ['message.sent', 'message.failed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const SEND_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

export const redisKeys = {
  quotaDay: (userId: string, day = utcDay()) => `quota:d:${userId}:${day}`,
  quotaMonth: (userId: string, month = utcMonth()) => `quota:m:${userId}:${month}`,
  burst: (userId: string, second: number) => `quota:b:${userId}:${second}`,
  providerDay: (providerId: string, day = utcDay()) => `prov:d:${providerId}:${day}`,
  providerSecond: (providerId: string, second: number) => `prov:s:${providerId}:${second}`,
  aiDay: (userId: string, day = utcDay()) => `ai:d:${userId}:${day}`,
  limitNotice: (userId: string, level: number, day = utcDay()) => `notice:${userId}:${level}:${day}`,
};

export const WEBHOOK_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

export const SYSTEM_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
} as const;
