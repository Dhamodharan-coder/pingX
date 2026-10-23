import type { ProviderConfig } from '@pingx/shared';
import { createGmailAdapter } from './gmail';
import { createResendAdapter } from './resend';
import { createSesAdapter } from './ses';
import { createSmtpAdapter } from './smtp';
import type { AdapterContext, OutboundMessage, SendResult } from './types';

export * from './errors';
export * from './types';
export { exchangeGoogleRefreshToken } from './gmail';

export function createChannels(ctx: AdapterContext = {}) {
  const adapters = {
    smtp: createSmtpAdapter(ctx),
    gmail_oauth: createGmailAdapter(ctx),
    resend: createResendAdapter(ctx),
    ses: createSesAdapter(ctx),
  };

  return {
    send(provider: ProviderConfig, message: OutboundMessage): Promise<SendResult> {
      switch (provider.type) {
        case 'smtp':
          return adapters.smtp.send(provider.config, message);
        case 'gmail_oauth':
          return adapters.gmail_oauth.send(provider.config, message);
        case 'resend':
          return adapters.resend.send(provider.config, message);
        case 'ses':
          return adapters.ses.send(provider.config, message);
      }
    },
  };
}

export type Channels = ReturnType<typeof createChannels>;

export function formatFrom(email: string, name?: string | null) {
  return name ? `"${name.replace(/["\\]/g, '')}" <${email}>` : email;
}
