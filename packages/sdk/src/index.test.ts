import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PingX, PingXError, verifyWebhook } from './index';

function mockFetch(responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(r.body ? JSON.stringify(r.body) : null, { status: r.status, headers: r.headers });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const ok = { status: 202, body: { id: 'msg_1', status: 'queued', scheduledAt: null, createdAt: 'now' } };

describe('PingX client', () => {
  it('sends with bearer auth and an idempotency key', async () => {
    const m = mockFetch([ok]);
    const px = new PingX({ apiKey: 'pgx_live_x', baseUrl: 'https://px.dev/api/', fetch: m.fetch });
    const res = await px.send({ to: 'a@b.dev', template: 'welcome', data: { name: 'A' } });
    expect(res.id).toBe('msg_1');
    expect(m.calls[0]!.url).toBe('https://px.dev/api/v1/send');
    const headers = m.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer pgx_live_x');
    expect(headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/);
  });

  it('retries 5xx with the same idempotency key', async () => {
    const m = mockFetch([{ status: 503 }, ok]);
    const px = new PingX({ apiKey: 'k', baseUrl: 'https://px.dev', fetch: m.fetch });
    await px.send({ to: 'a@b.dev', subject: 's', text: 't' });
    const keys = m.calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('does not retry a daily limit and exposes retryAfter', async () => {
    const m = mockFetch([{ status: 429, body: { error: { code: 'daily_limit', message: 'Daily limit of 200 reached' } }, headers: { 'retry-after': '3600' } }]);
    const px = new PingX({ apiKey: 'k', baseUrl: 'https://px.dev', fetch: m.fetch });
    const err = await px.send({ to: 'a@b.dev', subject: 's', text: 't' }).catch((e) => e);
    expect(err).toBeInstanceOf(PingXError);
    expect(err).toMatchObject({ status: 429, code: 'daily_limit', retryAfter: 3600 });
    expect(m.calls).toHaveLength(1);
  });

  it('does not retry 4xx validation errors', async () => {
    const m = mockFetch([{ status: 400, body: { error: { code: 'validation_error', message: 'to: Invalid email' } } }]);
    const px = new PingX({ apiKey: 'k', baseUrl: 'https://px.dev', fetch: m.fetch });
    await expect(px.send({ to: 'nope' })).rejects.toMatchObject({ code: 'validation_error' });
    expect(m.calls).toHaveLength(1);
  });

  it('explains a 404 from a server that is not PingX', async () => {
    const m = mockFetch([{ status: 404 }]);
    const px = new PingX({ apiKey: 'k', baseUrl: 'http://localhost:5173/api', fetch: m.fetch });
    await expect(px.send({ to: 'a@b.dev', subject: 's', text: 't' })).rejects.toMatchObject({
      status: 404,
      code: 'not_pingx_api',
      message: expect.stringMatching(/No PingX API at http:\/\/localhost:5173\/api\/v1\/send/),
    });
  });

  it('keeps PingX 404 errors as they are', async () => {
    const m = mockFetch([{ status: 404, body: { error: { code: 'template_not_found', message: 'Template "x" not found' } } }]);
    const px = new PingX({ apiKey: 'k', baseUrl: 'http://localhost:4100', fetch: m.fetch });
    await expect(px.send({ to: 'a@b.dev', template: 'x' })).rejects.toMatchObject({ code: 'template_not_found' });
  });

  it('requires a base URL', () => {
    expect(() => new PingX({ apiKey: 'k' })).toThrow(/baseUrl/);
  });

  it('rejects a base URL that is not an absolute http(s) URL', () => {
    expect(() => new PingX({ apiKey: 'k', baseUrl: 'undefined' })).toThrow(/absolute http\(s\) URL.*"undefined"/);
    expect(() => new PingX({ apiKey: 'k', baseUrl: 'localhost:4100' })).toThrow(/absolute/);
    expect(() => new PingX({ apiKey: 'k', baseUrl: 'http://localhost:4100' })).not.toThrow();
  });
});

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'message.sent', createdAt: 'now', data: { message: { id: 'm', status: 'sent', to: [] } } });
  const sign = (t: number, b = body) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${b}`).digest('hex')}`;

  it('accepts a valid signature', () => {
    const t = Math.floor(Date.now() / 1000);
    expect(verifyWebhook(body, sign(t), secret).event).toBe('message.sent');
  });
  it('accepts a raw Buffer body (express.raw)', () => {
    const t = Math.floor(Date.now() / 1000);
    expect(verifyWebhook(Buffer.from(body), sign(t), secret).event).toBe('message.sent');
  });

  it('rejects a tampered body', () => {
    const t = Math.floor(Date.now() / 1000);
    expect(() => verifyWebhook(body.replace('sent', 'failed'), sign(t), secret)).toThrow(/Invalid/);
  });
  it('rejects old timestamps', () => {
    const t = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verifyWebhook(body, sign(t), secret)).toThrow(/tolerance/);
  });
});
