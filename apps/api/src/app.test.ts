import { prisma } from '@pingx/db';
import { redisKeys } from '@pingx/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { redis, sendQueue } from './lib/infra';
import { api, signup } from './test/helpers';

afterAll(async () => {
  await sendQueue.close();
  await redis.quit();
  await prisma.$disconnect();
});

describe('basics', () => {
  it('GET /health', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('unknown route returns error envelope', async () => {
    const res = await api().get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('validates bodies with zod', async () => {
    const res = await api().post('/auth/signup').send({ email: 'nope', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('auth', () => {
  it('signup → login → me', async () => {
    const { email } = await signup();
    const login = await api().post('/auth/login').send({ email, password: 'correct horse battery' });
    expect(login.status).toBe(200);
    const me = await api().get('/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.body).toMatchObject({ email, role: 'user', plan: { code: 'free' }, limits: { daily: 200 } });
  });

  it('rejects a wrong password', async () => {
    const { email } = await signup();
    const res = await api().post('/auth/login').send({ email, password: 'wrong password!' });
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and revokes everything on reuse', async () => {
    const { cookie } = await signup();
    const first = await api().post('/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    const newCookie = String(first.headers['set-cookie']).split(';')[0]!;
    const reuse = await api().post('/auth/refresh').set('Cookie', cookie);
    expect(reuse.status).toBe(401);
    const afterReuse = await api().post('/auth/refresh').set('Cookie', newCookie);
    expect(afterReuse.status).toBe(401);
  });

  it('verifies email with a one-time token', async () => {
    const { user } = await signup({ verified: false });
    const job = (await (await import('./lib/infra')).systemQueue.getJobs(['waiting'])).find((j) => j.data.to === user.email);
    const token = /token=([\w-]+)/.exec(job!.data.html)![1];
    expect((await api().post('/auth/verify-email').send({ token })).status).toBe(200);
    expect((await api().post('/auth/verify-email').send({ token })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
  });
});

describe('providers', () => {
  it('encrypts config and never returns secrets', async () => {
    const { auth, user } = await signup();
    const res = await api()
      .post('/providers')
      .set(auth)
      .send({ name: 'Resend', type: 'resend', fromEmail: 'me@x.dev', config: { apiKey: 're_secret_value' } });
    expect(res.status).toBe(201);
    expect(res.body.config).toEqual({ apiKey: '••••' });
    expect(JSON.stringify(res.body)).not.toContain('re_secret_value');
    const row = await prisma.provider.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.configEnc).not.toContain('re_secret_value');
    expect(row.keyVersion).toBe(1);
  });

  it('keeps stored secrets when a masked value is sent back', async () => {
    const { auth } = await signup();
    const created = await api()
      .post('/providers')
      .set(auth)
      .send({ name: 'SMTP', type: 'smtp', fromEmail: 'me@x.dev', config: { host: 'smtp.x.dev', port: 465, secure: true, user: 'me', pass: 'p4ss' } });
    const updated = await api().patch(`/providers/${created.body.id}`).set(auth).send({ config: { ...created.body.config, host: 'smtp2.x.dev' } });
    expect(updated.body.config).toMatchObject({ host: 'smtp2.x.dev', pass: '••••' });
  });

  it('reorders priorities and scopes by user', async () => {
    const a = await signup();
    const b = await signup();
    const mk = (name: string) =>
      api().post('/providers').set(a.auth).send({ name, type: 'resend', fromEmail: 'a@x.dev', config: { apiKey: 'k' } });
    const p1 = (await mk('one')).body;
    const p2 = (await mk('two')).body;
    expect([p1.priority, p2.priority]).toEqual([1, 2]);
    expect((await api().put('/providers/order').set(a.auth).send({ ids: [p2.id, p1.id] })).status).toBe(200);
    const list = (await api().get('/providers').set(a.auth)).body;
    expect(list.map((p: { name: string }) => p.name)).toEqual(['two', 'one']);
    expect((await api().get('/providers').set(b.auth)).body).toEqual([]);
    expect((await api().delete(`/providers/${p1.id}`).set(b.auth)).status).toBe(404);
  });
});

async function setupSender(opts: { verified?: boolean; provider?: boolean } = {}) {
  const s = await signup({ verified: opts.verified });
  if (opts.provider !== false) {
    await api().post('/providers').set(s.auth).send({ name: 'R', type: 'resend', fromEmail: 'me@x.dev', config: { apiKey: 'k' } });
  }
  const project = (await api().post('/projects').set(s.auth).send({ name: 'App' })).body;
  const key = (await api().post(`/projects/${project.id}/api-keys`).set(s.auth).send({ name: 'test' })).body;
  return { ...s, project, key: key.key as string, keyAuth: { Authorization: `Bearer ${key.key}` } };
}

describe('v1 send', () => {
  it('shows the API key once and stores only its hash', async () => {
    const { key, project } = await setupSender();
    expect(key).toMatch(/^pgx_live_/);
    const row = await prisma.apiKey.findFirstOrThrow({ where: { projectId: project.id } });
    expect(row.keyHash).not.toBe(key);
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('queues a message and returns 202 with rate limit headers', async () => {
    const { keyAuth } = await setupSender();
    const res = await api().post('/v1/send').set(keyAuth).send({ to: 'a@b.dev', subject: 'Hi', html: '<p>Hi</p>' });
    expect(res.status).toBe(202);
    expect(res.headers['x-ratelimit-limit']).toBe('200');
    expect(res.headers['x-ratelimit-remaining']).toBe('199');
    const job = await sendQueue.getJob(res.body.id);
    expect(job?.data).toEqual({ messageId: res.body.id });
    const status = await api().get(`/v1/messages/${res.body.id}`).set(keyAuth);
    expect(status.body).toMatchObject({ status: 'queued', to: ['a@b.dev'], events: [{ type: 'queued' }] });
  });

  it('requires a verified email and a provider', async () => {
    expect((await api().post('/v1/send').set((await setupSender({ verified: false })).keyAuth).send({ to: 'a@b.dev', subject: 'x', text: 'y' })).body.error.code).toBe('email_not_verified');
    expect((await api().post('/v1/send').set((await setupSender({ provider: false })).keyAuth).send({ to: 'a@b.dev', subject: 'x', text: 'y' })).body.error.code).toBe('no_provider');
  });

  it('rejects revoked and unknown keys', async () => {
    const { auth, project, keyAuth } = await setupSender();
    const keys = (await api().get(`/projects/${project.id}/api-keys`).set(auth)).body;
    await api().delete(`/projects/${project.id}/api-keys/${keys[0].id}`).set(auth);
    expect((await api().post('/v1/send').set(keyAuth).send({ to: 'a@b.dev', subject: 'x', text: 'y' })).status).toBe(401);
    expect((await api().post('/v1/send').set({ Authorization: 'Bearer pgx_live_nope' }).send({})).status).toBe(401);
  });

  it('replays idempotent requests without double-counting quota', async () => {
    const { keyAuth, user } = await setupSender();
    const body = { to: 'a@b.dev', subject: 'Hi', text: 'once' };
    const first = await api().post('/v1/send').set(keyAuth).set('Idempotency-Key', 'order-1').send(body);
    const second = await api().post('/v1/send').set(keyAuth).set('Idempotency-Key', 'order-1').send(body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await redis.get(redisKeys.quotaDay(user.id))).toBe('1');
  });

  it('returns 429 when the daily limit is reached and does not consume quota', async () => {
    const { keyAuth, user } = await setupSender();
    await prisma.user.update({ where: { id: user.id }, data: { dailyLimitOverride: 2 } });
    (await import('./lib/limits')).invalidateLimits(user.id);
    const send = () => api().post('/v1/send').set(keyAuth).send({ to: 'a@b.dev', subject: 'x', text: 'y' });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('daily_limit');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(await redis.get(redisKeys.quotaDay(user.id))).toBe('2');
  });

  it('sends a batch and counts each message', async () => {
    const { keyAuth, user } = await setupSender();
    const res = await api()
      .post('/v1/send/batch')
      .set(keyAuth)
      .send({ messages: [{ to: 'a@b.dev', subject: '1', text: 'x' }, { to: ['c@d.dev', 'e@f.dev'], subject: '2', text: 'y' }] });
    expect(res.status).toBe(202);
    expect(res.body.messages).toHaveLength(2);
    expect(await redis.get(redisKeys.quotaDay(user.id))).toBe('2');
  });

  it('schedules messages with a delayed job', async () => {
    const { keyAuth } = await setupSender();
    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await api().post('/v1/send').set(keyAuth).send({ to: 'a@b.dev', subject: 'later', text: 'x', scheduledAt: at });
    expect(res.body.status).toBe('scheduled');
    expect(await (await sendQueue.getJob(res.body.id))?.isDelayed()).toBe(true);
  });

  it('renders templates by slug and refunds quota on render errors', async () => {
    const { auth, keyAuth, user } = await setupSender();
    await api()
      .post('/templates')
      .set(auth)
      .send({ name: 'Welcome', slug: 'welcome', version: { subject: 'Hi {{name}}', format: 'html', body: '<p>Hello {{name}}</p>' } });
    const ok = await api().post('/v1/send').set(keyAuth).send({ to: 'a@b.dev', template: 'welcome', data: { name: '<Ann>' } });
    expect(ok.status).toBe(202);
    const msg = await prisma.message.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(msg.subject).toBe('Hi <Ann>');
    expect(msg.html).toBe('<p>Hello &lt;Ann&gt;</p>');
    const missing = await api().post('/v1/send').set(keyAuth).send({ to: 'a@b.dev', template: 'nope' });
    expect(missing.status).toBe(404);
    expect(await redis.get(redisKeys.quotaDay(user.id))).toBe('1');
  });
});

describe('templates', () => {
  it('rejects triple-stash and versions every save', async () => {
    const { auth } = await signup();
    const bad = await api().post('/templates').set(auth).send({ name: 'x', slug: 'x', version: { subject: 's', format: 'html', body: '{{{raw}}}' } });
    expect(bad.status).toBe(422);
    const t = (await api().post('/templates').set(auth).send({ name: 'x', slug: 'x', version: { subject: 'v1', format: 'html', body: '<p>1</p>' } })).body;
    await api().put(`/templates/${t.id}`).set(auth).send({ version: { subject: 'v2', format: 'html', body: '<p>2</p>' } });
    const rolled = await api().post(`/templates/${t.id}/rollback`).set(auth).send({ version: 1 });
    expect(rolled.body.currentVersion).toBe(3);
    expect(rolled.body.versions[0].subject).toBe('v1');
  });

  it('previews mjml with the system layout', async () => {
    const { auth } = await signup();
    const layout = (await api().get('/layouts').set(auth)).body.find((l: { isSystem: boolean }) => l.isSystem);
    const res = await api()
      .post('/templates/preview')
      .set(auth)
      .send({ subject: 'Code {{code}}', format: 'mjml', body: '<mj-text>{{code}}</mj-text>', layoutId: layout.id, data: { code: '42', brand: 'Acme' } });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Code 42');
    expect(res.body.html).toContain('Acme');
  });

  it('creates from the gallery', async () => {
    const { auth } = await signup();
    const gallery = (await api().get('/templates/gallery').set(auth)).body;
    expect(gallery.length).toBeGreaterThan(0);
    const res = await api().post('/templates').set(auth).send({ name: 'Mine', slug: 'mine', fromGalleryId: gallery[0].id });
    expect(res.status).toBe(201);
  });
});

describe('admin', () => {
  it('is forbidden for normal users', async () => {
    const { auth } = await signup();
    expect((await api().get('/admin/stats').set(auth)).status).toBe(403);
  });

  it('never exposes provider credentials and audits changes', async () => {
    const admin = await signup({ admin: true });
    const user = await setupSender();
    const providers = (await api().get('/admin/providers').set(admin.auth)).body;
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0]).not.toHaveProperty('configEnc');
    expect(providers[0]).not.toHaveProperty('config');
    const detail = (await api().get(`/admin/users/${user.user.id}`).set(admin.auth)).body;
    expect(JSON.stringify(detail)).not.toContain('configEnc');

    await api().patch(`/admin/users/${user.user.id}`).set(admin.auth).send({ dailyLimitOverride: 5 });
    const me = (await api().get('/auth/me').set(user.auth)).body;
    expect(me.limits.daily).toBe(5);
    const log = (await api().get('/admin/audit').set(admin.auth)).body;
    expect(log[0]).toMatchObject({ action: 'user.update', targetId: user.user.id });
  });

  it('disabling a user blocks their API keys', async () => {
    const admin = await signup({ admin: true });
    const user = await setupSender();
    await api().patch(`/admin/users/${user.user.id}`).set(admin.auth).send({ disabled: true });
    expect((await api().post('/v1/send').set(user.keyAuth).send({ to: 'a@b.dev', subject: 'x', text: 'y' })).status).toBe(401);
  });
});
