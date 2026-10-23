import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AppError, redisKeys } from '@pingx/shared';
import { z } from 'zod/v4';
import { env } from '../env';
import { redis } from '../lib/infra';
import { getUserLimits } from '../lib/limits';

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

const DraftSchema = z.object({
  subject: z.string().describe('Email subject line; may use {{variables}}'),
  body: z.string().describe('MJML fragment of mj-* elements that goes inside an mj-column'),
  sampleData: z.record(z.string(), z.string()).describe('Example values for every {{variable}} used'),
});

export type TemplateDraft = z.infer<typeof DraftSchema>;

const SYSTEM = `You write transactional email templates for PingX.
Return an MJML fragment that sits inside <mj-column>: only mj-text, mj-button, mj-image, mj-divider, mj-spacer, mj-table and mj-raw elements. Do not wrap it in <mjml>, <mj-body>, <mj-section> or <mj-column>.
Use Handlebars double-brace variables like {{name}} for dynamic values. Never use triple braces {{{ }}} or {{& }}.
Keep copy short, clear and friendly. Use inline attributes (color, font-size, padding) for styling; no external CSS.
If the user shares an existing template, edit it according to their request instead of starting over.`;

async function consumeAiQuota(userId: string) {
  const { aiDaily } = await getUserLimits(userId);
  const key = redisKeys.aiDay(userId);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 60 * 60 * 48);
  if (used > aiDaily) {
    await redis.decr(key);
    throw new AppError('ai_limit', 429, `AI assistant limit of ${aiDaily} per day reached on your plan`);
  }
  return () => redis.decr(key);
}

export async function draftTemplate(userId: string, prompt: string, current?: { subject: string; body: string }) {
  if (!client) throw new AppError('ai_disabled', 503, 'The AI assistant is not configured on this server');
  const refund = await consumeAiQuota(userId);

  const content = current
    ? `Current template:\nSubject: ${current.subject}\n\n${current.body}\n\nRequest: ${prompt}`
    : prompt;

  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(DraftSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      await refund();
      throw new AppError('ai_refused', 422, 'The assistant could not help with that request');
    }
    if (!response.parsed_output) {
      await refund();
      throw new AppError('ai_failed', 502, 'The assistant returned an unexpected response, try again');
    }
    return response.parsed_output;
  } catch (err) {
    if (err instanceof AppError) throw err;
    await refund();
    if (err instanceof Anthropic.RateLimitError) throw new AppError('ai_busy', 503, 'The assistant is busy, try again shortly');
    if (err instanceof Anthropic.APIError) throw new AppError('ai_failed', 502, `AI request failed (${err.status ?? 'network'})`);
    throw err;
  }
}
