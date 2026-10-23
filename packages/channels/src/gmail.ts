import type { GmailOAuthConfig } from '@pingx/shared';
import { classifyHttpError, ProviderError } from './errors';
import { buildMime } from './mime';
import type { AdapterContext, OutboundMessage, SendResult } from './types';

export async function exchangeGoogleRefreshToken(ctx: AdapterContext, refreshToken: string): Promise<string> {
  if (!ctx.googleClientId || !ctx.googleClientSecret) {
    throw new ProviderError('provider', 'Google OAuth is not configured on this server', { auth: true });
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ctx.googleClientId,
      client_secret: ctx.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(ctx.timeoutMs ?? 20_000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new ProviderError('provider', `Google token refresh failed: ${body}`, { auth: res.status === 400 || res.status === 401, code: String(res.status) });
  }
  return (JSON.parse(body) as { access_token: string }).access_token;
}

export function createGmailAdapter(ctx: AdapterContext) {
  return {
    async send(config: GmailOAuthConfig, message: OutboundMessage): Promise<SendResult> {
      const accessToken = await exchangeGoogleRefreshToken(ctx, config.refreshToken);
      const raw = (await buildMime(message)).toString('base64url');
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(ctx.timeoutMs ?? 20_000),
      }).catch((err: Error) => {
        throw new ProviderError('provider', err.message, { code: 'NETWORK' });
      });
      const body = await res.text();
      if (!res.ok) {
        if (res.status === 403 && /dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded/i.test(body)) {
          throw new ProviderError('provider', body, { cap: true, code: '403' });
        }
        throw classifyHttpError(res.status, body);
      }
      return { providerMessageId: (JSON.parse(body) as { id: string }).id };
    },
  };
}
