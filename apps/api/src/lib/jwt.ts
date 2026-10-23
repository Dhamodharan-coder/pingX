import { jwtVerify, SignJWT } from 'jose';
import { env } from '../env';

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const stateKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessClaims {
  sub: string;
  role: 'user' | 'admin';
}

export const signAccessToken = (claims: AccessClaims) =>
  new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(accessKey);

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: ['HS256'] });
  return { sub: payload.sub!, role: payload.role === 'admin' ? 'admin' : 'user' };
}

/** Short-lived signed state for OAuth redirects. */
export const signState = (data: Record<string, string>) =>
  new SignJWT(data).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(stateKey);

export async function verifyState(token: string): Promise<Record<string, unknown>> {
  return (await jwtVerify(token, stateKey, { algorithms: ['HS256'] })).payload;
}
