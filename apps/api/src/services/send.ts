import { Prisma, prisma, type Message } from '@pingx/db';
import { AppError, SEND_JOB_OPTIONS } from '@pingx/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { sendQueue } from '../lib/infra';
import { consumeQuota } from './quota';
import { findTemplateForSend, renderVersion } from './templates';

const email = z.string().trim().toLowerCase().email().max(320);
const recipients = z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(email).min(1).max(50));
const MAX_SCHEDULE_MS = 30 * 24 * 60 * 60 * 1000;

export const sendInputSchema = z
  .object({
    to: recipients,
    cc: z.array(email).max(50).optional(),
    bcc: z.array(email).max(50).optional(),
    replyTo: email.optional(),
    fromName: z.string().trim().max(100).optional(),
    subject: z.string().max(998).optional(),
    html: z.string().max(512_000).optional(),
    text: z.string().max(256_000).optional(),
    template: z.string().max(200).optional(),
    data: z.record(z.unknown()).default({}),
    scheduledAt: z.coerce.date().optional(),
    tags: z.array(z.string().max(50)).max(10).default([]),
  })
  .refine((v) => v.template || (v.subject && (v.html || v.text)), {
    message: 'Provide either `template` or `subject` with `html`/`text`',
  })
  .refine((v) => !v.scheduledAt || (v.scheduledAt.getTime() > Date.now() - 60_000 && v.scheduledAt.getTime() < Date.now() + MAX_SCHEDULE_MS), {
    message: 'scheduledAt must be in the next 30 days',
    path: ['scheduledAt'],
  });

export type SendInput = z.infer<typeof sendInputSchema>;

export interface SendContext {
  userId: string;
  projectId: string;
  apiKeyId?: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function renderInput(userId: string, input: SendInput) {
  if (input.template) {
    const { template, version } = await findTemplateForSend(userId, input.template);
    const out = await renderVersion(version, template.layout, input.data);
    return { ...out, subject: input.subject ?? out.subject, templateId: template.id, templateVersion: version.version };
  }
  return {
    subject: input.subject!,
    html: input.html ?? `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(input.text!)}</pre>`,
    text: input.text,
    templateId: undefined,
    templateVersion: undefined,
  };
}

export const publicMessage = (m: Pick<Message, 'id' | 'status' | 'scheduledAt' | 'createdAt'>) => ({
  id: m.id,
  status: m.status,
  scheduledAt: m.scheduledAt,
  createdAt: m.createdAt,
});

/** auth → quota → render → save → enqueue. Quota is refunded if anything after it fails. */
export async function createMessages(
  ctx: SendContext,
  inputs: SendInput[],
  opts: { idempotencyKey?: string; batchId?: string; res?: Response } = {},
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { emailVerifiedAt: true } });
  if (!user.emailVerifiedAt) throw new AppError('email_not_verified', 403, 'Verify your account email before sending');

  if (opts.idempotencyKey) {
    const existing = await prisma.message.findUnique({
      where: { projectId_idempotencyKey: { projectId: ctx.projectId, idempotencyKey: opts.idempotencyKey } },
    });
    if (existing) return { messages: [existing], replayed: true };
  }

  const providers = await prisma.provider.count({ where: { userId: ctx.userId } });
  if (providers === 0) throw new AppError('no_provider', 422, 'Connect an email provider before sending');

  const ticket = await consumeQuota(ctx.userId, inputs.length, opts.res);
  try {
    const rendered = await Promise.all(inputs.map((i) => renderInput(ctx.userId, i)));
    const messages = await prisma.$transaction(
      inputs.map((input, i) => {
        const r = rendered[i]!;
        const scheduled = input.scheduledAt && input.scheduledAt.getTime() > Date.now();
        return prisma.message.create({
          data: {
            userId: ctx.userId,
            projectId: ctx.projectId,
            apiKeyId: ctx.apiKeyId,
            templateId: r.templateId,
            templateVersion: r.templateVersion,
            to: input.to,
            cc: input.cc ?? [],
            bcc: input.bcc ?? [],
            replyTo: input.replyTo,
            fromOverride: input.fromName,
            subject: r.subject,
            html: r.html,
            text: r.text,
            tags: input.tags,
            status: scheduled ? 'scheduled' : 'queued',
            scheduledAt: input.scheduledAt,
            idempotencyKey: inputs.length === 1 ? opts.idempotencyKey : undefined,
            batchId: opts.batchId,
            events: { create: { type: 'queued', detail: scheduled ? `scheduled for ${input.scheduledAt!.toISOString()}` : undefined } },
          },
        });
      }),
    );

    await sendQueue.addBulk(
      messages.map((m) => ({
        name: 'send',
        data: { messageId: m.id },
        opts: { ...SEND_JOB_OPTIONS, jobId: m.id, delay: m.scheduledAt ? Math.max(0, m.scheduledAt.getTime() - Date.now()) : 0 },
      })),
    );
    return { messages, replayed: false };
  } catch (err) {
    await ticket.refund();
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && opts.idempotencyKey) {
      const existing = await prisma.message.findUniqueOrThrow({
        where: { projectId_idempotencyKey: { projectId: ctx.projectId, idempotencyKey: opts.idempotencyKey } },
      });
      return { messages: [existing], replayed: true };
    }
    throw err;
  }
}
