import { prisma, type SubscriptionStatus } from '@pingx/db';
import { AppError, hmacSha256, safeEqual } from '@pingx/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../env';
import { invalidateLimits } from '../lib/limits';
import { notFound, parse } from '../lib/validate';
import { requireUser } from '../middleware/auth';

async function razorpay<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new AppError('billing_disabled', 503, 'Billing is not configured');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { description?: string } };
  if (!res.ok) throw new AppError('billing_error', 502, json.error?.description ?? 'Razorpay request failed');
  return json;
}

export const billingRouter = Router();
billingRouter.use(requireUser);

billingRouter.get('/plans', async (_req, res) => {
  res.json(
    await prisma.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, name: true, dailyLimit: true, monthlyLimit: true, burstPerSecond: true, aiDailyLimit: true, priceInr: true, razorpayPlanId: true },
    }),
  );
});

billingRouter.get('/subscription', async (req, res) => {
  const sub = await prisma.subscription.findFirst({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' }, include: { plan: true } });
  res.json({ subscription: sub, razorpayKeyId: env.RAZORPAY_KEY_ID ?? null });
});

billingRouter.post('/subscribe', async (req, res) => {
  const { planCode } = parse(z.object({ planCode: z.string() }), req.body);
  const plan = await prisma.plan.findFirst({ where: { code: planCode, active: true } });
  if (!plan) throw notFound('Plan');
  if (!plan.razorpayPlanId) throw new AppError('plan_not_purchasable', 400, 'This plan cannot be purchased online');
  const sub = await razorpay<{ id: string; status: SubscriptionStatus; short_url: string }>('/subscriptions', {
    plan_id: plan.razorpayPlanId,
    total_count: 120,
    customer_notify: 1,
    notes: { userId: req.userId, planCode },
  });
  await prisma.subscription.create({ data: { userId: req.userId!, planId: plan.id, razorpaySubscriptionId: sub.id, status: 'created' } });
  res.status(201).json({ subscriptionId: sub.id, shortUrl: sub.short_url, keyId: env.RAZORPAY_KEY_ID });
});

billingRouter.post('/cancel', async (req, res) => {
  const sub = await prisma.subscription.findFirst({ where: { userId: req.userId, status: { in: ['active', 'pending'] } }, orderBy: { createdAt: 'desc' } });
  if (!sub) throw notFound('Active subscription');
  await razorpay(`/subscriptions/${sub.razorpaySubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
  res.json({ ok: true, endsAt: sub.currentPeriodEnd });
});

const STATUS_BY_EVENT: Record<string, SubscriptionStatus> = {
  'subscription.authenticated': 'created',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.resumed': 'active',
  'subscription.pending': 'pending',
  'subscription.halted': 'halted',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
};

interface RazorpayEvent {
  event: string;
  payload: { subscription?: { entity: { id: string; current_end?: number | null } } };
}

/** Mounted before express.json so the signature is checked against the raw body. */
export const razorpayWebhookRouter = Router();

razorpayWebhookRouter.post('/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = (req.body as Buffer).toString('utf8');
  if (!env.RAZORPAY_WEBHOOK_SECRET || typeof signature !== 'string' || !safeEqual(hmacSha256(env.RAZORPAY_WEBHOOK_SECRET, raw), signature)) {
    throw new AppError('invalid_signature', 400, 'Invalid signature');
  }
  const evt = JSON.parse(raw) as RazorpayEvent;
  const status = STATUS_BY_EVENT[evt.event];
  const entity = evt.payload.subscription?.entity;
  if (!status || !entity) return void res.json({ ok: true });

  const sub = await prisma.subscription.findUnique({ where: { razorpaySubscriptionId: entity.id } });
  if (!sub) return void res.json({ ok: true });

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status, currentPeriodEnd: entity.current_end ? new Date(entity.current_end * 1000) : undefined },
  });
  if (status === 'active') {
    await prisma.user.update({ where: { id: sub.userId }, data: { planId: sub.planId } });
  } else if (status === 'halted' || status === 'cancelled' || status === 'completed') {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: 'free' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sub.userId } });
    if (user.planId === sub.planId) await prisma.user.update({ where: { id: sub.userId }, data: { planId: free.id } });
  }
  invalidateLimits(sub.userId);
  res.json({ ok: true });
});
