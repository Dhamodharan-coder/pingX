import { env } from '../env';
import { systemQueue } from './infra';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p><a href="${escape(cta.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escape(cta.label)}</a></p><p style="color:#71717a;font-size:12px">Or open: ${escape(cta.url)}</p>`
    : '';
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px"><h2>${escape(title)}</h2><p>${body}</p>${button}<p style="color:#a1a1aa;font-size:12px">PingX</p></div>`;
}

const send = (to: string, subject: string, html: string) => systemQueue.add('email', { to, subject, html });

export const systemEmails = {
  verify: (to: string, token: string) =>
    send(to, 'Verify your PingX email', layout('Confirm your email', 'Click below to verify your email address.', { label: 'Verify email', url: `${env.APP_URL}/verify-email?token=${token}` })),
  reset: (to: string, token: string) =>
    send(to, 'Reset your PingX password', layout('Reset your password', 'This link expires in 1 hour. Ignore this email if you did not request it.', { label: 'Reset password', url: `${env.APP_URL}/reset-password?token=${token}` })),
  limit: (to: string, percent: number, limit: number) =>
    send(
      to,
      percent >= 100 ? 'You reached your PingX daily limit' : `You've used ${percent}% of your PingX daily limit`,
      layout(
        percent >= 100 ? 'Daily limit reached' : 'Approaching your daily limit',
        `You've used ${percent}% of your ${limit} emails today. ${percent >= 100 ? 'New sends return 429 until midnight UTC.' : ''} Upgrade for higher limits.`,
        { label: 'View plans', url: `${env.APP_URL}/billing` },
      ),
    ),
};
