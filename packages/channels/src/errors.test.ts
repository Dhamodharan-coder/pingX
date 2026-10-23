import { describe, expect, it } from 'vitest';
import { classifyHttpError, classifySesError, classifySmtpError } from './errors';

describe('classifySmtpError', () => {
  it.each([
    [{ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Username and Password not accepted' }, 'provider', true],
    [{ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }, 'provider', false],
    [{ responseCode: 554, response: '554 5.2.2 mailbox full; submission quota exceeded' }, 'provider', false],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, 'provider', false],
    [{ code: 'ECONNECTION', message: 'Connection closed' }, 'provider', false],
    [{ responseCode: 421, response: '421 4.7.0 Try again later' }, 'provider', false],
    [{ responseCode: 550, response: '550 5.1.1 The email account that you tried to reach does not exist' }, 'recipient', false],
    [{ responseCode: 553, response: '553 5.1.3 Invalid address' }, 'recipient', false],
    [{ code: 'EENVELOPE', message: 'No recipients defined' }, 'recipient', false],
    [{ responseCode: 554, response: '554 5.7.1 Message rejected as spam' }, 'provider', false],
  ])('%j → %s (auth=%s)', (err, side, auth) => {
    const e = classifySmtpError(err);
    expect(e.side).toBe(side);
    expect(e.isAuth).toBe(auth);
  });

  it('flags Gmail daily cap as cap', () => {
    expect(classifySmtpError({ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }).opts.cap).toBe(true);
  });
});

describe('classifyHttpError', () => {
  it.each([
    [401, '{"message":"API key is invalid"}', 'provider', true],
    [429, 'rate limited', 'provider', false],
    [503, 'unavailable', 'provider', false],
    [422, '{"message":"Invalid `to` field. Please use our testing email address"}', 'recipient', false],
    [403, '{"message":"The domain is not verified"}', 'provider', false],
    [400, 'Invalid To header', 'recipient', false],
  ])('%i %s → %s', (status, body, side, auth) => {
    const e = classifyHttpError(status, body);
    expect(e.side).toBe(side);
    expect(e.isAuth).toBe(auth);
  });
});

describe('classifySesError', () => {
  it('auth errors', () => {
    expect(classifySesError({ name: 'InvalidClientTokenId', message: 'bad' }).isAuth).toBe(true);
  });
  it('unverified identity is provider-side', () => {
    expect(classifySesError({ name: 'MessageRejected', message: 'Email address is not verified. The following identities failed the check' }).side).toBe('provider');
  });
  it('throttling is a cap', () => {
    expect(classifySesError({ name: 'TooManyRequestsException', message: 'slow down' }).opts.cap).toBe(true);
  });
});
