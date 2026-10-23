import { AppError } from '@pingx/shared';
import type { RequestHandler } from 'express';
import { redis } from '../lib/infra';

/** Fixed-window limiter per IP for unauthenticated endpoints (login, signup, reset). */
export function ipRateLimit(name: string, max: number, windowSec: number): RequestHandler {
  return async (req, res, next) => {
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${name}:${req.ip}:${window}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    if (count > max) {
      res.setHeader('Retry-After', String(windowSec));
      throw new AppError('rate_limited', 429, 'Too many requests, try again later');
    }
    next();
  };
}
