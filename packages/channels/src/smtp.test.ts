import { describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import { createSmtpAdapter } from './smtp';

const msg = { from: 'a@x.dev', to: ['b@x.dev'], subject: 's', html: '<p>h</p>' };

describe('smtp adapter SSRF guard', () => {
  it.each(['localhost', '127.0.0.1', '10.0.0.5', '169.254.169.254', 'redis'])('refuses private host %s in production mode', async (host) => {
    const smtp = createSmtpAdapter({ allowPrivateHosts: false, timeoutMs: 2000 });
    const err = await smtp.send({ host, port: 6379, secure: false, user: 'u', pass: 'p' }, msg).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.side).toBe('provider');
  });
});
