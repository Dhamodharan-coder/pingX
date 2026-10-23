import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, generateApiKey, keyringFromEnv, sha256 } from './crypto';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

describe('crypto', () => {
  it('round-trips with the current key version', () => {
    const ring = keyringFromEnv({ ENCRYPTION_KEY_V1: k1 });
    const { data, keyVersion } = encrypt(ring, 'secret');
    expect(keyVersion).toBe(1);
    expect(data).not.toContain('secret');
    expect(decrypt(ring, data, keyVersion)).toBe('secret');
  });

  it('decrypts old versions after rotation', () => {
    const old = encrypt(keyringFromEnv({ ENCRYPTION_KEY_V1: k1 }), 'x');
    const ring = keyringFromEnv({ ENCRYPTION_KEY_V1: k1, ENCRYPTION_KEY_V2: k2 });
    expect(ring.current).toBe(2);
    expect(decrypt(ring, old.data, old.keyVersion)).toBe('x');
    expect(encrypt(ring, 'y').keyVersion).toBe(2);
  });

  it('rejects tampered ciphertext', () => {
    const ring = keyringFromEnv({ ENCRYPTION_KEY_V1: k1 });
    const { data } = encrypt(ring, 'secret');
    const [iv, tag] = data.split('.');
    expect(() => decrypt(ring, `${iv}.${tag}.AAAA`, 1)).toThrow();
  });

  it('generates prefixed api keys and stores only a hash', () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^pgx_live_[\w-]{43}$/);
    expect(hash).toBe(sha256(key));
    expect(key.startsWith(prefix)).toBe(true);
  });
});
