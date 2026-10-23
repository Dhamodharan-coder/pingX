// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient types for mjml, which ships none
/// <reference path="./mjml.d.ts" />
import { AppError } from '@pingx/shared';
import Handlebars from 'handlebars';
import mjml2html from 'mjml';

export type TemplateFormat = 'mjml' | 'html';

export interface TemplateSource {
  subject: string;
  body: string;
  format: TemplateFormat;
  text?: string | null;
}

export interface LayoutSource {
  body: string;
  format: TemplateFormat;
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

const hbs = Handlebars.create();

const UNESCAPED = /\{\{\{|\{\{\s*&|\{\{~?\{/;
const CONTENT_SLOT = /\{\{\{\s*content\s*\}\}\}/g;

/** Rejects unescaped output. Layouts may use `{{{content}}}` only, which is the already-rendered template. */
export function validateTemplateSource(source: string, opts: { layout?: boolean } = {}) {
  const checked = opts.layout ? source.replace(CONTENT_SLOT, '') : source;
  if (UNESCAPED.test(checked)) {
    throw new AppError('unsafe_template', 422, 'Triple-stash / unescaped output is not allowed. Use {{variable}}.');
  }
  try {
    hbs.precompile(source);
  } catch (err) {
    throw new AppError('template_syntax', 422, `Template syntax error: ${(err as Error).message}`);
  }
  if (opts.layout && !CONTENT_SLOT.test(source)) {
    throw new AppError('layout_missing_content', 422, 'Layout must contain {{{content}}}');
  }
  CONTENT_SLOT.lastIndex = 0;
}

function compile(source: string, data: Record<string, unknown>, noEscape = false) {
  try {
    return hbs.compile(source, { noEscape })(data);
  } catch (err) {
    throw new AppError('template_render', 422, `Template render failed: ${(err as Error).message}`);
  }
}

const wrapMjml = (fragment: string) =>
  `<mjml><mj-body><mj-section><mj-column>${fragment}</mj-column></mj-section></mj-body></mjml>`;

export async function mjmlToHtml(source: string): Promise<string> {
  const input = /^\s*<mjml[\s>]/.test(source) ? source : wrapMjml(source);
  const { html, errors } = await mjml2html(input, { validationLevel: 'soft' });
  if (!html) throw new AppError('mjml_invalid', 422, errors.map((e) => e.formattedMessage).join('\n'));
  return html;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export async function renderTemplate(
  template: TemplateSource,
  data: Record<string, unknown>,
  layout?: LayoutSource | null,
): Promise<RenderedTemplate> {
  const subject = compile(template.subject, data, true).replace(/\s+/g, ' ').trim();
  let body = compile(template.body, data);
  let format = template.format;

  if (layout) {
    body = compile(layout.body, { ...data, content: body });
    format = layout.format;
  }

  const html = format === 'mjml' ? await mjmlToHtml(body) : body;
  const text = template.text ? compile(template.text, data, true) : htmlToText(html);
  return { subject, html, text };
}
