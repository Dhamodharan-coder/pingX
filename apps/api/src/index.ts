import { prisma } from '@pingx/db';
import { createApp } from './app';
import { env } from './env';
import { redis } from './lib/infra';

const server = createApp().listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT}`);
});

const shutdown = () => {
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
