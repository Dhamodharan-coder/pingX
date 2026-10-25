import { describe, expect, it } from 'vitest';
import { pickSystemEmailTransport, systemEmailEnvSchema } from './email';

describe('system email env', () => {
  it('is disabled unless EMAIL_ENABLED is "true"', () => {
    expect(systemEmailEnvSchema.parse({}).EMAIL_ENABLED).toBe(false);
    expect(systemEmailEnvSchema.parse({ EMAIL_ENABLED: 'TRUE' }).EMAIL_ENABLED).toBe(true);
    expect(systemEmailEnvSchema.parse({ EMAIL_ENABLED: 'yes' }).EMAIL_ENABLED).toBe(false);
  });

  it('parses SMTP settings', () => {
    const e = systemEmailEnvSchema.parse({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_PASS: '' });
    expect(e).toMatchObject({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 465, SMTP_SECURE: true, SMTP_PASS: undefined });
  });

  it('picks SMTP, then Resend, then console', () => {
    expect(pickSystemEmailTransport(systemEmailEnvSchema.parse({ SMTP_HOST: 'h', RESEND_API_KEY: 'k' }))).toBe('smtp');
    expect(pickSystemEmailTransport(systemEmailEnvSchema.parse({ SMTP_URL: 'smtp://localhost:1025' }))).toBe('smtp');
    expect(pickSystemEmailTransport(systemEmailEnvSchema.parse({ RESEND_API_KEY: 'k' }))).toBe('resend');
    expect(pickSystemEmailTransport(systemEmailEnvSchema.parse({}))).toBe('console');
  });
});
