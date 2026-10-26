import { randomBytes } from 'node:crypto';

/** Test env defaults; each app passes its own database name and Redis DB index. */
export function testEnv(dbName: string, redisDb: number): Record<string, string> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? `postgresql://pingx:pingx@localhost:5432/${dbName}`;
  return {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    REDIS_URL: process.env.TEST_REDIS_URL ?? `redis://localhost:6379/${redisDb}`,
    APP_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0000',
    JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-000',
    ENCRYPTION_KEY_V1: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: '1',
    EMAIL_ENABLED: 'true',
  };
}
