import { baseEnvSchema, parseEnv } from '@pingx/shared';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

export const env = parseEnv(
  baseEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(4100),
    APP_URL: z.string().url(),
    API_URL: z.string().url().default('http://localhost:4100'),
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
    ANTHROPIC_API_KEY: optional,
    TURNSTILE_SECRET: optional,
  }),
);
