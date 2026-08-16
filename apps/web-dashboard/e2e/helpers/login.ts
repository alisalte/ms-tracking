/**
 * Shared browser-E2E login helper (extracted from the Sprint H notifications
 * spec — the same UI login flow, reused by the Sprint I specs).
 *
 * identity throttles logins (10/min per IP). Serial suites that log in once
 * per test trip that limiter, so the session is created ONCE per test-run
 * process via the real UI flow and then INJECTED into each test page's
 * localStorage (the app hydrates from `fleetvision_tokens` on load — the
 * exact same storage the app itself uses, no test-only auth path).
 */
import { expect } from '@playwright/test';
import { chromium } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL ?? 'admin@fleetvision.local';
export const PASSWORD = process.env.E2E_PASSWORD ?? 'ChangeMe!StrongPass123';
export const TENANT = process.env.E2E_TENANT ?? 'FleetVision';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

interface StoredSession {
  tokensJson: string;
  tenantId: string;
}

let cachedSession: StoredSession | null = null;

async function createSessionViaUi(): Promise<StoredSession | null> {
  const browser = await chromium
    .launch({ channel: process.env.E2E_BROWSER_CHANNEL, headless: true })
    .catch(() => chromium.launch({ headless: true }));
  try {
    const page = await browser.newPage();
    await page.goto('/login');
    await page.getByLabel(/organization|tenant/i).fill(TENANT);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 60_000 });
    const tokensJson = await page.evaluate(() => localStorage.getItem('fleetvision_tokens'));
    const tenantId = await page.evaluate(() => localStorage.getItem('fleetvision_tenant_id'));
    if (!tokensJson) return null;
    return { tokensJson, tenantId: tenantId ?? '' };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Log the page in — injecting the shared session when one exists. */
export async function login(page: import('@playwright/test').Page) {
  if (!cachedSession) {
    cachedSession = (await createSessionViaUi().catch(() => null)) ?? null;
  }
  if (cachedSession) {
    await page.goto('/login');
    await page.evaluate((s) => {
      localStorage.setItem('fleetvision_tokens', s.tokensJson);
      if (s.tenantId) localStorage.setItem('fleetvision_tenant_id', s.tenantId);
    }, cachedSession);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/, { timeout: 60_000 });
    return;
  }
  // Fallback: the plain UI flow (fresh session per page).
  await page.goto('/login');
  await page.getByLabel(/organization|tenant/i).fill(TENANT);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 60_000 });
}
