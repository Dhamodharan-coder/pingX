import { baseEnvSchema, parseEnv } from '@pingx/shared';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

export const env = parseEnv(
  baseEnvSchema.extend({
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    SYSTEM_SMTP_URL: optional,
    SYSTEM_FROM: z.string().default('PingX <no-reply@pingx.local>'),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  }),
);
