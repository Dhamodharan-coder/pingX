import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Keyring {
  current: number;
  keys: Map<number, Buffer>;
}

export function keyringFromEnv(source: Record<string, string | undefined> = process.env): Keyring {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(source)) {
    const match = /^ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match || !value) continue;
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) throw new Error(`${name} must be 32 bytes base64`);
    keys.set(Number(match[1]), key);
  }
  const current = Number(source.ENCRYPTION_KEY_VERSION ?? Math.max(0, ...keys.keys()));
  if (!keys.has(current)) throw new Error(`ENCRYPTION_KEY_V${current} is not set`);
  return { current, keys };
}

export function encrypt(keyring: Keyring, plaintext: string): { data: string; keyVersion: number } {
  const key = keyring.keys.get(keyring.current)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { data: [iv, tag, ct].map((b) => b.toString('base64')).join('.'), keyVersion: keyring.current };
}

export function decrypt(keyring: Keyring, data: string, keyVersion: number): string {
  const key = keyring.keys.get(keyVersion);
  if (!key) throw new Error(`Missing encryption key version ${keyVersion}`);
  const [iv, tag, ct] = data.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !ct) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export const encryptJson = (keyring: Keyring, value: unknown) => encrypt(keyring, JSON.stringify(value));

export const decryptJson = <T>(keyring: Keyring, data: string, keyVersion: number): T =>
  JSON.parse(decrypt(keyring, data, keyVersion)) as T;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const API_KEY_PREFIX = 'pgx_live_';

export function generateApiKey() {
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, hash: sha256(key), prefix: key.slice(0, API_KEY_PREFIX.length + 6) };
}

export const hmacSha256 = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
