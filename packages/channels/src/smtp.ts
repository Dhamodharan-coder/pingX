import { assertPublicHost, type SmtpConfig } from '@pingx/shared';
import nodemailer from 'nodemailer';
import { classifySmtpError, ProviderError } from './errors';
import type { AdapterContext, OutboundMessage, SendResult } from './types';

export function createSmtpAdapter(ctx: AdapterContext) {
  const timeout = ctx.timeoutMs ?? 20_000;
  return {
    async send(config: SmtpConfig, message: OutboundMessage): Promise<SendResult> {
      if (!ctx.allowPrivateHosts) {
        await assertPublicHost(config.host).catch((err: Error) => {
          throw new ProviderError('provider', err.message, { code: 'EHOST' });
        });
      }
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        // Dev sinks like Mailpit speak plain SMTP; real providers must upgrade to TLS.
        requireTLS: !config.secure && !ctx.allowPrivateHosts,
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
