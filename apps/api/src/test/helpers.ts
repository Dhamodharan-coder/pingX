import { prisma } from '@pingx/db';
import request from 'supertest';
import { createApp } from '../app';

export const app = createApp();
export const api = () => request(app);

let n = 0;
export async function signup(opts: { verified?: boolean; admin?: boolean } = {}) {
  n++;
  const email = `user${Date.now()}${n}@test.dev`;
  const res = await api().post('/auth/signup').set('X-Forwarded-For', `10.0.${Math.floor(n / 250)}.${n % 250}`).send({ email, password: 'correct horse battery' });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  const user = await prisma.user.update({
    where: { email },
    data: { emailVerifiedAt: opts.verified === false ? null : new Date(), role: opts.admin ? 'admin' : 'user' },
  });
  const token: string = res.body.accessToken;
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  return { user, email, token, cookie, auth: { Authorization: `Bearer ${token}` } };
}
