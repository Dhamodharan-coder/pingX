import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { SesConfig } from '@pingx/shared';
import { classifySesError } from './errors';
import type { AdapterContext, OutboundMessage, SendResult } from './types';

export function createSesAdapter(ctx: AdapterContext) {
  return {
    async send(config: SesConfig, message: OutboundMessage): Promise<SendResult> {
      const client = new SESv2Client({
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        requestHandler: { requestTimeout: ctx.timeoutMs ?? 20_000 },
      });
      try {
        const out = await client.send(
          new SendEmailCommand({
            FromEmailAddress: message.from,
            Destination: { ToAddresses: message.to, CcAddresses: message.cc, BccAddresses: message.bcc },
            ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: 'UTF-8' },
                Body: {
                  Html: { Data: message.html, Charset: 'UTF-8' },
                  ...(message.text ? { Text: { Data: message.text, Charset: 'UTF-8' } } : {}),
                },
              },
            },
          }),
        );
        return { providerMessageId: out.MessageId };
      } catch (err) {
        throw classifySesError(err);
      } finally {
        client.destroy();
      }
    },
  };
}
