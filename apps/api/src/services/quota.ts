import { prisma } from '@pingx/db';
import { AppError, redisKeys } from '@pingx/shared';
import type { Response } from 'express';
import { redis } from '../lib/infra';
import { getUserLimits } from '../lib/limits';
import { systemEmails } from '../lib/systemEmail';

const secondsUntilUtcMidnight = () => {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
};

export interface QuotaTicket {
  refund(): Promise<void>;
}

/** Atomically reserves `n` sends against daily, monthly and burst limits; sets X-RateLimit-* headers. */
export async function consumeQuota(userId: string, n: number, res?: Response): Promise<QuotaTicket> {
  const limits = await getUserLimits(userId);
  const dayKey = redisKeys.quotaDay(userId);
  const monthKey = redisKeys.quotaMonth(userId);
  const burstKey = redisKeys.burst(userId, Math.floor(Date.now() / 1000));

  const results = await redis
    .multi()
    .incrby(dayKey, n)
    .expire(dayKey, 60 * 60 * 48)
    .incrby(monthKey, n)
    .expire(monthKey, 60 * 60 * 24 * 35)
    .incrby(burstKey, n)
    .expire(burstKey, 2)
    .exec();
  const [day, month, burst] = [0, 2, 4].map((i) => Number(results?.[i]?.[1] ?? 0)) as [number, number, number];

  const refund = async () => {
    await redis.multi().decrby(dayKey, n).decrby(monthKey, n).decrby(burstKey, n).exec();
  };
  const reset = secondsUntilUtcMidnight();

  if (res) {
    res.setHeader('X-RateLimit-Limit', String(limits.daily));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limits.daily - day)));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + reset));
  }

  const exceeded =
    burst > limits.burst ? { code: 'burst_limit', msg: `More than ${limits.burst} sends per second`, retry: 1 } :
    day > limits.daily ? { code: 'daily_limit', msg: `Daily limit of ${limits.daily} reached`, retry: reset } :
    month > limits.monthly ? { code: 'monthly_limit', msg: `Monthly limit of ${limits.monthly} reached`, retry: reset } :
    null;

  if (exceeded) {
    await refund();
    if (res) {
      res.setHeader('Retry-After', String(exceeded.retry));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limits.daily - (day - n))));
    }
    if (exceeded.code === 'daily_limit') void notifyLimit(userId, 100, limits.daily);
    throw new AppError(exceeded.code, 429, exceeded.msg);
  }

  if (day >= limits.daily * 0.8 && day - n < limits.daily * 0.8) void notifyLimit(userId, 80, limits.daily);
  return { refund };
}

async function notifyLimit(userId: string, percent: number, limit: number) {
  const first = await redis.set(redisKeys.limitNotice(userId, percent), '1', 'EX', 60 * 60 * 48, 'NX');
  if (!first) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user) await systemEmails.limit(user.email, percent, limit);
}

export async function usageToday(userId: string) {
  const [day, month] = await redis.mget(redisKeys.quotaDay(userId), redisKeys.quotaMonth(userId));
  return { day: Number(day ?? 0), month: Number(month ?? 0) };
}
