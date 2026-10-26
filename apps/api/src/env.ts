import { baseEnvSchema, parseEnv, systemEmailEnvSchema } from '@pingx/shared';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

export const env = parseEnv(
  baseEnvSchema.merge(systemEmailEnvSchema).extend({
    PORT: z.coerce.number().int().positive().default(4100),
    APP_URL: z.string().url(),
    API_URL: z.string().url().default('http://localhost:4100'),
    /** Path prefix the browser uses to reach the API (e.g. /api behind the Vite proxy or Caddy). */
    PUBLIC_API_PREFIX: z.string().default(''),
    /** Proxy hops in front of the API, so req.ip is the visitor: 1 = Caddy only, 2 = Vercel → Caddy. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
    COOKIE_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    RAZORPAY_KEY_ID: optional,
    RAZORPAY_KEY_SECRET: optional,
    RAZORPAY_WEBHOOK_SECRET: optional,
    TURNSTILE_SECRET: optional,
  }),
);
