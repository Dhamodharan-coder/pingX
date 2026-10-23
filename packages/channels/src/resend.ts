import type { ResendConfig } from '@pingx/shared';
import { classifyHttpError, ProviderError } from './errors';
import type { AdapterContext, OutboundMessage, SendResult } from './types';

export function createResendAdapter(ctx: AdapterContext) {
  return {
    async send(config: ResendConfig, message: OutboundMessage): Promise<SendResult> {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          reply_to: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        }),
        signal: AbortSignal.timeout(ctx.timeoutMs ?? 20_000),
      }).catch((err: Error) => {
        throw new ProviderError('provider', err.message, { code: 'NETWORK' });
      });
      const body = await res.text();
      if (!res.ok) throw classifyHttpError(res.status, body);
      return { providerMessageId: (JSON.parse(body) as { id: string }).id };
    },
  };
}
