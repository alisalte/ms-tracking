import { defineConfig, devices } from '@playwright/test';

/**
 * Sprint H — browser E2E for the Notification Center.
 *
 * Runs against the real dev stack:
 *   - vite dev server (web-dashboard) on :5173, proxying /api → identity + notification services
 *   - docker compose infra (postgres, redis, kafka) + identity-service (seeded admin)
 *
 * The suite SKIPS (does not fail) when the stack is unreachable — set
 * E2E_RUN=1 to require it. Credentials come from the identity seed defaults
 * (overridable via E2E_EMAIL / E2E_PASSWORD / E2E_TENANT).
 *
 * Run: `pnpm --filter @fleetvision/web-dashboard test:e2e`
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/**
 * Chromium download from the Playwright CDN is blocked in some environments;
 * the system Edge/Chrome channel is used when E2E_BROWSER_CHANNEL is set
 * (e.g. E2E_BROWSER_CHANNEL=msedge on Windows).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
    ...devices['Desktop Chrome'],
  },
  outputDir: './e2e/.results',
});
