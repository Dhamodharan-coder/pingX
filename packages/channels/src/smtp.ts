import type { SmtpConfig } from '@pingx/shared';
import nodemailer from 'nodemailer';
import { classifySmtpError } from './errors';
import type { AdapterContext, OutboundMessage, SendResult } from './types';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'mailpit']);

export function createSmtpAdapter(ctx: AdapterContext) {
  const timeout = ctx.timeoutMs ?? 20_000;
  return {
    async send(config: SmtpConfig, message: OutboundMessage): Promise<SendResult> {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        // Local dev sinks (Mailpit) speak plain SMTP; everything else must upgrade to TLS.
        requireTLS: !config.secure && !LOCAL_HOSTS.has(config.host),
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout: timeout,
      });
      try {
        const info = await transport.sendMail(message);
        if (info.rejected.length > 0 && info.accepted.length === 0) {
          throw Object.assign(new Error(`Recipients rejected: ${info.rejected.join(', ')}`), { code: 'EENVELOPE' });
        }
        return { providerMessageId: info.messageId };
      } catch (err) {
        throw classifySmtpError(err);
      } finally {
        transport.close();
      }
    },
  };
}
