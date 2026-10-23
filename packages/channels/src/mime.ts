import MailComposer from 'nodemailer/lib/mail-composer';
import type { OutboundMessage } from './types';

export async function buildMime(message: OutboundMessage): Promise<Buffer> {
  return new MailComposer(message).compile().build();
}
