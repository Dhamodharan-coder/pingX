/** provider: fallback to the next provider. recipient: fail the message, never fall back. */
export type ErrorSide = 'provider' | 'recipient';

export class ProviderError extends Error {
  constructor(
    readonly side: ErrorSide,
    message: string,
    readonly opts: { auth?: boolean; cap?: boolean; code?: string } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get isAuth() {
    return this.opts.auth ?? false;
  }
}

const CAP_PATTERNS = [/5\.4\.5/, /sending limit/i, /quota exceeded/i, /rate limit/i, /too many/i, /5\.2\.2/];
const RECIPIENT_SMTP_PATTERNS = [/5\.1\.[0-9]/, /5\.2\.1/, /mailbox (unavailable|not found|disabled)/i, /user unknown/i, /no such user/i, /invalid (address|recipient)/i, /does not exist/i];
const NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'ETLS', 'EPROTOCOL']);

interface SmtpLikeError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

export function classifySmtpError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = (err ?? {}) as SmtpLikeError;
  const text = `${e.response ?? ''} ${e.message ?? ''}`.trim();
  const rc = e.responseCode;

  if (e.code === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) {
    return new ProviderError('provider', text, { auth: true, code: String(rc ?? e.code) });
  }
  if (CAP_PATTERNS.some((p) => p.test(text))) return new ProviderError('provider', text, { cap: true, code: String(rc ?? e.code) });
  if (e.code === 'EENVELOPE') return new ProviderError('recipient', text, { code: e.code });
  if (e.code && NETWORK_CODES.has(e.code)) return new ProviderError('provider', text, { code: e.code });
  if (rc && rc >= 400 && rc < 500) return new ProviderError('provider', text, { code: String(rc) });
  if (rc && rc >= 500) {
    const recipient = rc === 553 || rc === 551 || RECIPIENT_SMTP_PATTERNS.some((p) => p.test(text));
    return new ProviderError(recipient ? 'recipient' : 'provider', text, { code: String(rc) });
  }
  return new ProviderError('provider', text || 'Unknown SMTP error', { code: e.code });
}

const RECIPIENT_HTTP_PATTERNS = [/invalid.*(to|recipient|email address)/i, /(to|recipient).*invalid/i, /not a valid email/i, /invalid to header/i, /malformed address/i];

export function classifyHttpError(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) {
    if (/invalid.*(to|recipient)/i.test(body)) return new ProviderError('recipient', body, { code: String(status) });
    return new ProviderError('provider', body, { auth: status === 401 || /credential|token|api key|unauthor/i.test(body), code: String(status) });
  }
  if (status === 429) return new ProviderError('provider', body, { cap: true, code: '429' });
  if (status >= 500) return new ProviderError('provider', body, { code: String(status) });
  if (status === 400 || status === 422) {
    const recipient = RECIPIENT_HTTP_PATTERNS.some((p) => p.test(body));
    return new ProviderError(recipient ? 'recipient' : 'provider', body, { code: String(status) });
  }
  return new ProviderError('provider', body, { code: String(status) });
}

const SES_AUTH = new Set(['UnrecognizedClientException', 'InvalidClientTokenId', 'SignatureDoesNotMatch', 'AccessDeniedException', 'InvalidSignatureException']);
const SES_CAP = new Set(['LimitExceededException', 'TooManyRequestsException', 'AccountSuspendedException', 'SendingPausedException', 'Throttling']);

export function classifySesError(err: unknown): ProviderError {
  const e = (err ?? {}) as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name ?? '';
  const message = e.message ?? name;
  if (SES_AUTH.has(name)) return new ProviderError('provider', message, { auth: true, code: name });
  if (SES_CAP.has(name)) return new ProviderError('provider', message, { cap: true, code: name });
  if (name === 'MessageRejected' && /not verified/i.test(message) && /identit/i.test(message)) {
    return new ProviderError('provider', message, { code: name });
  }
  if ((name === 'BadRequestException' || name === 'MessageRejected') && RECIPIENT_HTTP_PATTERNS.some((p) => p.test(message))) {
    return new ProviderError('recipient', message, { code: name });
  }
  return new ProviderError('provider', message, { code: name || String(e.$metadata?.httpStatusCode ?? '') });
}
