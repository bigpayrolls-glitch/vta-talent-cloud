import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const WEB_PORT = 5174;
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://vta:vta_dev@localhost:5432/vta_e2e';

/**
 * Runs the real API (on its own database) and the web app, then drives a browser through them.
 * The API log is written to e2e/.api.log so phone sign-in tests can read the development OTP code.
 * The web app is built and served as in production, with its service worker, so offline tests are real.
 * Tests share one database and run one at a time.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: `pnpm --filter @vta/api exec tsx src/server.ts > ${process.cwd()}/.api.log 2>&1`,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        API_PORT: String(API_PORT),
        DATABASE_URL: E2E_DB,
        APP_ORIGIN: `http://localhost:${WEB_PORT}`,
        STORAGE_DIR: `${process.cwd()}/.storage`,
        NO_COLOR: '1',
        // Demo data uses fixed 2026 dates; pin the API's "today" so these tests do not age.
        VTA_TODAY: '2026-10-26',
        // Many sign-ins a minute from this one machine; ignored in production.
        VTA_RELAX_RATE_LIMITS: '1',
      },
    },
    {
      // The built app (not the dev server), so the service worker, install manifest and offline mode are real.
      command: `pnpm --filter @vta/web exec vite build --logLevel error && pnpm --filter @vta/web exec vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
