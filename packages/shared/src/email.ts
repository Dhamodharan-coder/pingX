import { z } from 'zod';

const flag = (fallback: 'true' | 'false') =>
  z
    .string()
    .default(fallback)
    .transform((v) => v.trim().toLowerCase() === 'true');
const optional = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

/**
 * PingX's own emails (verification, password reset, limit warnings).
 * EMAIL_ENABLED=false turns them off: accounts are treated as verified and no verification step exists.
 */
export const systemEmailEnvSchema = z.object({
  EMAIL_ENABLED: flag('false'),
  EMAIL_FROM: z.string().default('PingX <no-reply@pingx.local>'),
  SMTP_URL: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: flag('false'),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  RESEND_API_KEY: optional,
});

export type SystemEmailEnv = z.infer<typeof systemEmailEnvSchema>;

export type SystemEmailTransport = 'smtp' | 'resend' | 'console';

/** SMTP if SMTP_URL or SMTP_HOST is set, else Resend if RESEND_API_KEY is set, else the console. */
export function pickSystemEmailTransport(env: SystemEmailEnv): SystemEmailTransport {
  if (env.SMTP_URL || env.SMTP_HOST) return 'smtp';
  if (env.RESEND_API_KEY) return 'resend';
  return 'console';
}
