import { prisma, type Plan } from '@pingx/db';

const TTL_MS = 60_000;

export interface UserLimits {
  plan: Plan;
  daily: number;
  monthly: number;
  burst: number;
  aiDaily: number;
}

const userCache = new Map<string, { at: number; value: UserLimits }>();

export async function getUserLimits(userId: string): Promise<UserLimits> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { plan: true } });
  const value: UserLimits = {
    plan: user.plan,
    daily: user.dailyLimitOverride ?? user.plan.dailyLimit,
    monthly: user.plan.monthlyLimit,
    burst: user.plan.burstPerSecond,
    aiDaily: user.plan.aiDailyLimit,
  };
  userCache.set(userId, { at: Date.now(), value });
  return value;
}

export function invalidateLimits(userId?: string) {
  if (userId) userCache.delete(userId);
  else userCache.clear();
}

let settingsCache: { at: number; value: Map<string, unknown> } | undefined;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!settingsCache || Date.now() - settingsCache.at > TTL_MS) {
    const rows = await prisma.setting.findMany();
    settingsCache = { at: Date.now(), value: new Map(rows.map((r) => [r.key, r.value])) };
  }
  return (settingsCache.value.get(key) as T | undefined) ?? fallback;
}

export const invalidateSettings = () => {
  settingsCache = undefined;
};
