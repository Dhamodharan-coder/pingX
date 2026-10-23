import { hash, verify } from '@node-rs/argon2';
import { prisma, type User } from '@pingx/db';
import { AppError, randomToken, sha256 } from '@pingx/shared';
import { Router, type Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '../env';
import { signAccessToken } from '../lib/jwt';
import { getSetting, getUserLimits } from '../lib/limits';
import { systemEmails } from '../lib/systemEmail';
import { parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';
import { ipRateLimit } from '../middleware/rateLimit';
import { usageToday } from '../services/quota';

const REFRESH_COOKIE = 'pingx_rt';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(8).max(200);

export const authRouter = Router();

async function issueSession(res: Response, user: Pick<User, 'id' | 'role'>) {
  const token = randomToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  });
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/auth',
    maxAge: REFRESH_TTL_MS,
  });
  return { accessToken: await signAccessToken({ sub: user.id, role: user.role }) };
}

async function createUserToken(userId: string, type: 'verify_email' | 'reset_password', ttlMs: number) {
  const token = randomToken();
  await prisma.userToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

async function consumeUserToken(token: string, type: 'verify_email' | 'reset_password') {
  const row = await prisma.userToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError('invalid_token', 400, 'This link is invalid or has expired');
  }
  await prisma.userToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

async function verifyCaptcha(token: string | undefined, ip: string | undefined) {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) throw new AppError('captcha_required', 400, 'Captcha required');
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  const body = (await res.json()) as { success: boolean };
  if (!body.success) throw new AppError('captcha_failed', 400, 'Captcha verification failed');
}

const freePlanId = async () => (await prisma.plan.findUniqueOrThrow({ where: { code: 'free' } })).id;

authRouter.post('/signup', ipRateLimit('signup', 5, 600), async (req, res) => {
  const body = parse(z.object({ email, password, name: z.string().trim().max(100).optional(), captchaToken: z.string().optional() }), req.body);
  if (!(await getSetting('signup_enabled', true))) throw new AppError('signup_disabled', 403, 'Signups are currently closed');
  await verifyCaptcha(body.captchaToken, req.ip);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw new AppError('email_taken', 409, 'An account with this email already exists');
  }
  const user = await prisma.user.create({
    data: { email: body.email, name: body.name, passwordHash: await hash(body.password), planId: await freePlanId() },
  });
  await systemEmails.verify(user.email, await createUserToken(user.id, 'verify_email', 24 * 60 * 60 * 1000));
  res.status(201).json(await issueSession(res, user));
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
  const userId = await consumeUserToken(token, 'verify_email');
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  res.json({ ok: true });
});

authRouter.post('/resend-verification', requireUser, ipRateLimit('verify', 3, 600), async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (!user.emailVerifiedAt) await systemEmails.verify(user.email, await createUserToken(user.id, 'verify_email', 24 * 60 * 60 * 1000));
  res.json({ ok: true });
});

authRouter.post('/login', ipRateLimit('login', 10, 300), async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = user?.passwordHash ? await verify(user.passwordHash, body.password) : false;
  if (!user || !ok) throw new AppError('invalid_credentials', 401, 'Incorrect email or password');
  if (user.disabledAt) throw new AppError('account_disabled', 403, 'This account is disabled');
  res.json(await issueSession(res, user));
});

authRouter.post('/google', ipRateLimit('google', 10, 300), async (req, res) => {
  const { credential } = parse(z.object({ credential: z.string().min(10) }), req.body);
  if (!env.GOOGLE_CLIENT_ID) throw new AppError('google_disabled', 400, 'Google sign-in is not configured');
  let payload;
  try {
    ({ payload } = await jwtVerify(credential, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    }));
  } catch {
    throw new AppError('invalid_credentials', 401, 'Invalid Google credential');
  }
  const googleId = payload.sub!;
  const gEmail = String(payload.email ?? '').toLowerCase();
  if (!gEmail || payload.email_verified !== true) throw new AppError('invalid_credentials', 401, 'Google email is not verified');

  let user = await prisma.user.findFirst({ where: { OR: [{ googleId }, { email: gEmail }] } });
  if (user) {
    if (!user.googleId || !user.emailVerifiedAt) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    }
  } else {
    if (!(await getSetting('signup_enabled', true))) throw new AppError('signup_disabled', 403, 'Signups are currently closed');
    user = await prisma.user.create({
      data: { email: gEmail, googleId, name: typeof payload.name === 'string' ? payload.name : null, emailVerifiedAt: new Date(), planId: await freePlanId() },
    });
  }
  if (user.disabledAt) throw new AppError('account_disabled', 403, 'This account is disabled');
  res.json(await issueSession(res, user));
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw new AppError('unauthorized', 401, 'No session');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.expiresAt < new Date() || row.user.disabledAt) throw new AppError('unauthorized', 401, 'Session expired');
  if (row.revokedAt) {
    // Reuse of a rotated token: assume theft and end every session for this user.
    await prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new AppError('unauthorized', 401, 'Session expired');
  }
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  res.json(await issueSession(res, row.user));
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
  res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  res.json({ ok: true });
});

authRouter.post('/forgot-password', ipRateLimit('forgot', 5, 600), async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && !user.disabledAt) await systemEmails.reset(user.email, await createUserToken(user.id, 'reset_password', 60 * 60 * 1000));
  res.json({ ok: true });
});

authRouter.post('/reset-password', ipRateLimit('reset', 10, 600), async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), password }), req.body);
  const userId = await consumeUserToken(body.token, 'reset_password');
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(body.password), emailVerifiedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  res.json({ ok: true });
});

authRouter.get('/me', requireUser, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  const limits = await getUserLimits(user.id);
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: Boolean(user.emailVerifiedAt),
    hasPassword: Boolean(user.passwordHash),
    plan: { code: limits.plan.code, name: limits.plan.name },
    limits: { daily: limits.daily, monthly: limits.monthly, burst: limits.burst, aiDaily: limits.aiDaily },
    usage: await usageToday(user.id),
  });
});

authRouter.patch('/me', requireUser, async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().max(100) }), req.body);
  await prisma.user.update({ where: { id: req.userId }, data: { name: body.name } });
  res.json({ ok: true });
});

authRouter.post('/change-password', requireUser, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().optional(), newPassword: password }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (user.passwordHash && !(body.currentPassword && (await verify(user.passwordHash, body.currentPassword)))) {
    throw new AppError('invalid_credentials', 401, 'Current password is incorrect');
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(body.newPassword) } });
  res.json({ ok: true });
});
