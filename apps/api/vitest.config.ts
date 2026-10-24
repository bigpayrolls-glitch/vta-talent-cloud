import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All API tests share one test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
  },
});
