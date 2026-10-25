import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { prisma, type AiProvider } from '@pingx/db';
import { AppError, assertPublicHost, decrypt } from '@pingx/shared';
import { z } from 'zod/v4';
import { env } from '../env';
import { keyring } from '../lib/infra';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: '',
  gemini: '',
  openai_compatible: '',
};

export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl?: string | null;
  apiKey: string;
}

const DraftSchema = z.object({
  subject: z.string().describe('Email subject line; may use {{variables}}'),
  body: z.string().describe('The template body in the requested format'),
  sampleData: z.record(z.string(), z.string()).describe('Example values for every {{variable}} used'),
});
type Draft = z.infer<typeof DraftSchema>;

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
    sampleData: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: ['subject', 'body', 'sampleData'],
  additionalProperties: false,
} as const;

export interface TemplateDraft {
  subject: string;
  body: string;
  format: 'html';
  sampleData: Record<string, unknown>;
  source: AiProvider;
}

const SYSTEM_PROMPT = `You write transactional email templates for PingX.
Return a complete, email-safe HTML document: table-based layout, max width 600px, all styles inline (no <style> blocks, no external CSS, no scripts), Arial/Helvetica fonts, buttons as styled <a> links.
Use Handlebars double-brace variables like {{name}} for dynamic values and {{#each items}}…{{/each}} for lists. Never use triple braces {{{ }}} or {{& }}.
Keep copy short, clear and friendly.
If the user shares an existing template, edit it according to their request instead of starting over.
Respond with JSON only: {"subject": string, "body": string, "sampleData": {variable: example string}}.`;

const userMessage = (prompt: string, current?: { subject: string; body: string }) =>
  current ? `Current template:\nSubject: ${current.subject}\n\n${current.body}\n\nRequest: ${prompt}` : prompt;

const TIMEOUT_MS = 120_000;

function parseDraft(text: string | undefined): Draft {
  const json = text?.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const parsed = DraftSchema.safeParse(json ? safeJson(json) : undefined);
  if (!parsed.success) throw new AppError('ai_failed', 502, 'The AI returned an unexpected response, try again');
  return parsed.data;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

async function httpError(provider: string, res: Response): Promise<AppError> {
  const body = await res.text().catch(() => '');
  const detail = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? res.statusText;
  if (res.status === 401 || res.status === 403) return new AppError('ai_auth', 400, `${provider} rejected the API key: ${detail}`);
  if (res.status === 404) return new AppError('ai_model', 400, `${provider}: model not found — ${detail}`);
  if (res.status === 429) return new AppError('ai_busy', 503, `${provider} rate limit or quota reached: ${detail}`);
  return new AppError('ai_failed', 502, `${provider} request failed (${res.status}): ${detail}`);
}

async function callAnthropic(cfg: AiConfig, system: string, content: string): Promise<Draft> {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: TIMEOUT_MS });
  try {
    const response = await client.beta.messages.parse({
      model: cfg.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(DraftSchema) },
      system,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') throw new AppError('ai_refused', 422, 'The assistant could not help with that request');
    if (!response.parsed_output) throw new AppError('ai_failed', 502, 'The AI returned an unexpected response, try again');
    return response.parsed_output;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AppError('ai_auth', 400, 'Anthropic rejected the API key');
    }
    if (err instanceof Anthropic.NotFoundError) throw new AppError('ai_model', 400, `Anthropic: model "${cfg.model}" not found`);
    if (err instanceof Anthropic.RateLimitError) throw new AppError('ai_busy', 503, 'Anthropic rate limit reached, try again shortly');
    if (err instanceof Anthropic.APIError) throw new AppError('ai_failed', 502, `Anthropic request failed (${err.status ?? 'network'})`);
    throw err;
  }
}

async function callOpenAi(cfg: AiConfig, system: string, content: string, label: string): Promise<Draft> {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const strict = cfg.provider === 'openai';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      // OpenAI enforces the schema; most compatible servers only support plain JSON mode.
      response_format: strict ? { type: 'json_schema', json_schema: { name: 'template', strict: true, schema: JSON_SCHEMA } } : { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: Error) => {
    throw new AppError('ai_failed', 502, `${label} is unreachable: ${err.message}`);
  });
  if (!res.ok) throw await httpError(label, res);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseDraft(data.choices?.[0]?.message?.content);
}

async function callGemini(cfg: AiConfig, system: string, content: string): Promise<Draft> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: content }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: Error) => {
    throw new AppError('ai_failed', 502, `Gemini is unreachable: ${err.message}`);
  });
  if (!res.ok) throw await httpError('Gemini', res);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return parseDraft(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(''));
}

export async function assertSafeBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (env.NODE_ENV !== 'production') return;
  if (url.protocol !== 'https:') throw new AppError('validation_error', 400, 'Base URL must use https');
  await assertPublicHost(url.hostname).catch(() => {
    throw new AppError('validation_error', 400, 'Base URL must point to a public host');
  });
}

export async function runAi(cfg: AiConfig, prompt: string, current?: { subject: string; body: string }): Promise<Draft> {
  const system = SYSTEM_PROMPT;
  const content = userMessage(prompt, current);
  switch (cfg.provider) {
    case 'anthropic':
      return callAnthropic(cfg, system, content);
    case 'openai':
      return callOpenAi(cfg, system, content, 'OpenAI');
    case 'openai_compatible':
      if (!cfg.baseUrl) throw new AppError('validation_error', 400, 'Base URL is required for OpenAI-compatible providers');
      await assertSafeBaseUrl(cfg.baseUrl);
      return callOpenAi(cfg, system, content, new URL(cfg.baseUrl).hostname);
    case 'gemini':
      return callGemini(cfg, system, content);
  }
}

export async function loadAiConfig(userId: string): Promise<AiConfig | null> {
  const row = await prisma.aiSetting.findUnique({ where: { userId } });
  if (!row) return null;
  return { provider: row.provider, model: row.model, baseUrl: row.baseUrl, apiKey: decrypt(keyring, row.apiKeyEnc, row.keyVersion) };
}

/** Uses the AI provider and key the user configured in Settings. There is no server-wide AI key. */
export async function draftTemplate(
  userId: string,
  prompt: string,
  current?: { subject: string; body: string },
): Promise<TemplateDraft> {
  const cfg = await loadAiConfig(userId);
  if (!cfg) throw new AppError('ai_not_configured', 400, 'Add your AI provider and API key in Settings → AI assistant first');
  const draft = await runAi(cfg, prompt, current);
  return { ...draft, format: 'html', source: cfg.provider };
}
