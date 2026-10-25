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
