import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PingXOptions {
  apiKey: string;
  /** e.g. https://pingx.example.com/api — falls back to the PINGX_BASE_URL env var. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries for 429, 5xx and network errors. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface SendInput {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  fromName?: string;
  subject?: string;
  html?: string;
  text?: string;
  /** Template slug or id. */
  template?: string;
  data?: Record<string, unknown>;
  scheduledAt?: Date | string;
  tags?: string[];
}

export type MessageStatus = 'scheduled' | 'queued' | 'sending' | 'sent' | 'failed';

export interface SendResult {
  id: string;
  status: MessageStatus;
  scheduledAt: string | null;
  createdAt: string;
}

export interface Message extends SendResult {
  to: string[];
  subject: string;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  tags: string[];
  events: { type: string; detail: string | null; createdAt: string }[];
}

export class PingXError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'PingXError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PingX {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: PingXOptions) {
    if (!options.apiKey) throw new Error('PingX: apiKey is required');
    const base = options.baseUrl ?? globalThis.process?.env?.PINGX_BASE_URL;
    if (!base) throw new Error('PingX: baseUrl is required (or set PINGX_BASE_URL)');
    this.baseUrl = base.replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** Queues one email. Retries reuse the same idempotency key, so a retry never sends twice. */
  send(input: SendInput, opts: { idempotencyKey?: string } = {}): Promise<SendResult> {
    return this.request<SendResult>('POST', '/v1/send', serialize(input), opts.idempotencyKey ?? randomUUID());
  }

  /** Queues up to 100 emails in one request. */
  sendBatch(messages: SendInput[]): Promise<{ batchId: string; messages: SendResult[] }> {
    return this.request('POST', '/v1/send/batch', { messages: messages.map(serialize) });
  }

  getMessage(id: string): Promise<Message> {
    return this.request('GET', `/v1/messages/${encodeURIComponent(id)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
            'user-agent': 'pingx-node/0.1.0',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new PingXError(0, 'network_error', (err as Error).message);
      }

      const text = await res.text();
      const json = text ? safeJson(text) : undefined;
      if (res.ok) return json as T;

      const retryAfter = Number(res.headers.get('retry-after')) || undefined;
      const retryable = res.status === 429 || res.status >= 500;
      // A daily/monthly limit won't clear within a retry window; only short waits are retried.
      if (retryable && attempt < maxRetries && (retryAfter === undefined || retryAfter <= 10)) {
        await sleep(retryAfter !== undefined ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new PingXError(res.status, error?.code ?? 'http_error', error?.message ?? `HTTP ${res.status}`, retryAfter);
    }
  }
}

const backoff = (attempt: number) => Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function serialize(input: SendInput) {
  return { ...input, scheduledAt: input.scheduledAt instanceof Date ? input.scheduledAt.toISOString() : input.scheduledAt };
}

export interface WebhookEvent {
  event: 'message.sent' | 'message.failed';
  createdAt: string;
  data: { message: { id: string; status: MessageStatus; to: string[]; error?: string; providerMessageId?: string; sentAt?: string } };
}

/**
 * Verifies a PingX webhook. Pass the raw request body (not parsed JSON) and the `PingX-Signature` header.
 * Throws if the signature is invalid or older than `toleranceSec`.
 */
export function verifyWebhook(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string, toleranceSec = 300): WebhookEvent {
  if (!signatureHeader) throw new PingXError(400, 'invalid_signature', 'Missing PingX-Signature header');
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) throw new PingXError(400, 'invalid_signature', 'Malformed PingX-Signature header');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new PingXError(400, 'invalid_signature', 'Webhook timestamp outside tolerance');
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new PingXError(400, 'invalid_signature', 'Invalid webhook signature');
  return JSON.parse(body) as WebhookEvent;
}
