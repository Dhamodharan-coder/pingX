import { describe, expect, it } from 'vitest';
import { baseEnvSchema, parseEnv } from './env';

describe('parseEnv', () => {
  it('parses valid env and applies defaults', () => {
    const env = parseEnv(baseEnvSchema, {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws listing every invalid key', () => {
    expect(() => parseEnv(baseEnvSchema, { DATABASE_URL: 'nope' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });
});
