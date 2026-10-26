import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All API tests share one test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Demo data uses fixed 2026 dates; pin "today" so the suite does not age.
    env: { NODE_ENV: 'test', VTA_TODAY: '2026-10-26' },
  },
});
