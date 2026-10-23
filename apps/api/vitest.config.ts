import { testEnv } from '@pingx/db/testing/env';
import { defineConfig } from 'vitest/config';

Object.assign(process.env, testEnv('pingx_test', 1));

export default defineConfig({
  test: {
    globalSetup: ['@pingx/db/testing/global-setup'],
    env: { ...process.env } as Record<string, string>,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
