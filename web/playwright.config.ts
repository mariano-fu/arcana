// End-to-end tests (T1.15): WebKit on an iPhone profile against the production build, served by
// `vite preview` with the real service worker, so the offline reloads are real.
//
// They run in CI only (the `e2e` job): Playwright does not support Arch-based distros. Build
// first (`npm run build`), then `npm run test:e2e`.
//
// With E2E_API set, the API (gunicorn, `../api`) starts too, for the two-device sync spec (T3.9);
// `vite preview` proxies /api to it like Caddy does in production. The CI job provides its
// database, migrations and the made-up account.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = Boolean(process.env.CI);
const API_PORT = 8000;

export default defineConfig({
  testDir: './e2e',
  // Only the two-device spec talks to the API; without one it can't run.
  testIgnore: process.env.E2E_API ? [] : ['**/two-device.spec.ts'],
  fullyParallel: true,
  forbidOnly: CI,
  // One retry records a trace; a test that only passes on it is reported as flaky.
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    locale: 'es-CR',
    timezoneId: 'America/Costa_Rica',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 15'] } }],
  webServer: [
    {
      command: `npm run preview -- --port ${String(PORT)} --strictPort`,
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: !CI,
    },
    ...(process.env.E2E_API
      ? [
          {
            command: `uv run --locked gunicorn arcana.wsgi:application --bind 127.0.0.1:${String(API_PORT)} --workers 1 --access-logfile -`,
            cwd: '../api',
            url: `http://127.0.0.1:${String(API_PORT)}/api/health/`,
            reuseExistingServer: !CI,
            stdout: 'pipe' as const,
          },
        ]
      : []),
  ],
});
