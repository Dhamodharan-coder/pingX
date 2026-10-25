import { baseEnvSchema, parseEnv, systemEmailEnvSchema } from '@pingx/shared';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

export const env = parseEnv(
  baseEnvSchema.merge(systemEmailEnvSchema).extend({
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  }),
);
