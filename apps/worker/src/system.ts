import { pickSystemEmailTransport, type SystemEmailEnv, type SystemEmailJob } from '@pingx/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

let transport: Transporter | undefined;

function smtpTransport(e: SystemEmailEnv): Transporter {
  if (e.SMTP_URL) return nodemailer.createTransport(e.SMTP_URL);
  return nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
}

async function sendViaResend(e: SystemEmailEnv, job: SystemEmailJob) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [job.to], subject: job.subject, html: job.html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
}

/** Sends PingX's own emails (verify, reset, limit warnings) using the EMAIL_* / SMTP_* settings in .env. */
export async function sendSystemEmail(job: SystemEmailJob, e: SystemEmailEnv = env) {
  const via = pickSystemEmailTransport(e);
  if (!e.EMAIL_ENABLED || via === 'console') {
    const link = /href="([^"]+)"/.exec(job.html)?.[1];
    console.log(`[system-email${e.EMAIL_ENABLED ? '' : ' disabled'}] to=${job.to} subject="${job.subject}"${link ? ` link=${link}` : ''}`);
    return;
  }
  if (via === 'resend') return sendViaResend(e, job);
  transport ??= smtpTransport(e);
  await transport.sendMail({ from: e.EMAIL_FROM, to: job.to, subject: job.subject, html: job.html });
}
