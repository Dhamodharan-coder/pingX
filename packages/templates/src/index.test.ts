import { describe, expect, it } from 'vitest';
import { htmlToText, renderTemplate, validateTemplateSource } from './index';

describe('validateTemplateSource', () => {
  it('rejects triple-stash and {{& }}', () => {
    expect(() => validateTemplateSource('<p>{{{name}}}</p>')).toThrow(/not allowed/);
    expect(() => validateTemplateSource('<p>{{& name}}</p>')).toThrow(/not allowed/);
  });
  it('allows {{{content}}} only in layouts', () => {
    expect(() => validateTemplateSource('<div>{{{content}}}</div>', { layout: true })).not.toThrow();
    expect(() => validateTemplateSource('<div>{{{content}}}{{{x}}}</div>', { layout: true })).toThrow();
    expect(() => validateTemplateSource('<div>{{{content}}}</div>')).toThrow();
    expect(() => validateTemplateSource('<div>{{brand}}</div>', { layout: true })).toThrow(/content/);
  });
  it('reports syntax errors', () => {
    expect(() => validateTemplateSource('{{#if x}}')).toThrow(/syntax/);
  });
});

describe('renderTemplate', () => {
  it('escapes user data in html bodies but not in the subject header', async () => {
    const out = await renderTemplate({ subject: 'Hi {{name}}', body: '<p>{{name}}</p>', format: 'html' }, { name: '<script>x</script>' });
    expect(out.html).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    expect(out.subject).toBe('Hi <script>x</script>');
  });

  it('renders mjml fragments inside a layout', async () => {
    const out = await renderTemplate(
      { subject: 'Code {{code}}', body: '<mj-text>Your code is {{code}}</mj-text>', format: 'mjml' },
      { code: '1234', brand: 'Acme' },
      { format: 'mjml', body: '<mjml><mj-body><mj-section><mj-column><mj-text>{{brand}}</mj-text>{{{content}}}</mj-column></mj-section></mj-body></mjml>' },
    );
    expect(out.html).toContain('<!doctype html>');
    expect(out.html).toContain('Your code is 1234');
    expect(out.text).toContain('Acme');
    expect(out.text).toContain('Your code is 1234');
  });
});

describe('htmlToText', () => {
  it('keeps link targets', () => {
    expect(htmlToText('<p>Go <a href="https://x.dev">here</a></p>')).toBe('Go here (https://x.dev)');
  });
});
