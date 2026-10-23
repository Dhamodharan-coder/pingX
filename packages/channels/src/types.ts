import type { ProviderConfig } from '@pingx/shared';

export interface OutboundMessage {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  providerMessageId?: string;
}

export interface ChannelAdapter<T extends ProviderConfig['type']> {
  send(config: Extract<ProviderConfig, { type: T }>['config'], message: OutboundMessage): Promise<SendResult>;
}

export interface AdapterContext {
  googleClientId?: string;
  googleClientSecret?: string;
  timeoutMs?: number;
}
