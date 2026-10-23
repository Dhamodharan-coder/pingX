import type { SystemEmailJob } from '@pingx/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

let transport: Transporter | undefined;

export async function sendSystemEmail(job: SystemEmailJob) {
  if (!env.SYSTEM_SMTP_URL) {
    const link = /href="([^"]+)"/.exec(job.html)?.[1];
    console.log(`[system-email] to=${job.to} subject="${job.subject}"${link ? ` link=${link}` : ''}`);
    return;
  }
  transport ??= nodemailer.createTransport(env.SYSTEM_SMTP_URL);
  await transport.sendMail({ from: env.SYSTEM_FROM, to: job.to, subject: job.subject, html: job.html });
}
