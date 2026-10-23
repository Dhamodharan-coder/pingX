import { z } from 'zod';

export const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().min(1),
  pass: z.string().min(1),
});

export const gmailOAuthConfigSchema = z.object({
  email: z.string().email(),
  refreshToken: z.string().min(1),
});

export const resendConfigSchema = z.object({ apiKey: z.string().min(1) });

export const sesConfigSchema = z.object({
  region: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

export const providerConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('smtp'), config: smtpConfigSchema }),
  z.object({ type: z.literal('gmail_oauth'), config: gmailOAuthConfigSchema }),
  z.object({ type: z.literal('resend'), config: resendConfigSchema }),
  z.object({ type: z.literal('ses'), config: sesConfigSchema }),
]);

export type SmtpConfig = z.infer<typeof smtpConfigSchema>;
export type GmailOAuthConfig = z.infer<typeof gmailOAuthConfigSchema>;
export type ResendConfig = z.infer<typeof resendConfigSchema>;
export type SesConfig = z.infer<typeof sesConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProviderType = ProviderConfig['type'];

const SECRET_FIELDS = new Set(['pass', 'apiKey', 'secretAccessKey', 'refreshToken']);

export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([k, v]) => [k, SECRET_FIELDS.has(k) ? '••••' : v]),
  );
}
