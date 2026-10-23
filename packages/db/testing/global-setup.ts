import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { PrismaClient } from '../src/index';

const dbDir = fileURLToPath(new URL('..', import.meta.url));

/**
 * Vitest globalSetup shared by apps. Uses a dedicated test database (name must end in _test):
 * applies migrations, empties every table, seeds plans/presets/templates, flushes the test Redis DB.
 */
export default async function setup() {
  const DATABASE_URL = process.env.DATABASE_URL!;
  const REDIS_URL = process.env.REDIS_URL!;
  if (!/_test(\?|$)/.test(DATABASE_URL)) throw new Error(`Refusing to run tests against ${DATABASE_URL}`);
  const run = (cmd: string, extra: Record<string, string> = {}) => {
    try {
      execSync(cmd, { env: { ...process.env, ...extra }, stdio: 'pipe', cwd: dbDir });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`${cmd} failed:\n${e.stdout?.toString()}\n${e.stderr?.toString()}`, { cause: err });
    }
  };
  run('npx prisma migrate deploy');

  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await prisma.$disconnect();

  run('npx tsx prisma/seed.ts', { ADMIN_EMAIL: '', ADMIN_PASSWORD: '' });

  const redis = new Redis(REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
