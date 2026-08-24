/**
 * Visual regression suite (UI redesign §18).
 *
 * Captures screenshot baselines for the design system and the primary pages
 * across the theme × direction matrix:
 *
 *   Light + LTR · Dark + LTR · Light + RTL (fa) · Dark + RTL (fa)
 *
 * Two tiers:
 *  1. PUBLIC (always runs — only needs the vite dev server):
 *     /login and /dev/ui-gallery (the component gallery) in all 4 combos.
 *  2. AUTHENTICATED (needs the live stack): /dashboard, /assets, /admin,
 *     /trips, /commands — light+LTR only, with volatile regions masked
 *     (clocks, relative times, live dots, map tiles). Skips (not fails) when
 *     the stack is unreachable unless E2E_RUN=1 — same contract as the other
 *     e2e specs.
 *
 * Baselines are PLATFORM-SPECIFIC (font rasterization differs per OS) —
 * regenerate with --update-snapshots on the machine that owns the baseline.
 */
import { type Page, expect, test } from '@playwright/test';

import { login } from './helpers/login';

const COMBOS = [
  { name: 'light-ltr', theme: 'light', lang: 'en' },
  { name: 'dark-ltr', theme: 'dark', lang: 'en' },
  { name: 'light-rtl', theme: 'light', lang: 'fa' },
  { name: 'dark-rtl', theme: 'dark', lang: 'fa' },
] as const;

/** Prime theme + language BEFORE the app boots (storage-driven). */
async function primeCombo(page: Page, theme: string, lang: string) {
  await page.addInitScript(
    ([t, l]) => {
      localStorage.setItem('fleetvision_theme_mode', t as string);
      localStorage.setItem('fleetvision_language', l as string);
    },
    [theme, lang],
  );
}

const SHOT = {
  animations: 'disabled',
  caret: 'hide',
  scale: 'css' as const,
  maxDiffPixelRatio: 0.02, // anti-aliasing tolerance; content changes still fail
};

test.describe('public surfaces × theme/direction matrix', () => {
  for (const combo of COMBOS) {
    test(`login — ${combo.name}`, async ({ page }) => {
      await primeCombo(page, combo.theme, combo.lang);
      await page.goto('/login');
      // Language-neutral readiness: the submit button exists in every locale.
      await expect(page.locator('button[type="submit"]')).toBeVisible();
      await expect(page).toHaveScreenshot(`login-${combo.name}.png`, {
        ...SHOT,
        fullPage: true,
      });
    });

    test(`ui-gallery — ${combo.name}`, async ({ page }) => {
      await primeCombo(page, combo.theme, combo.lang);
      await page.goto('/dev/ui-gallery');
      await expect(page.getByRole('heading', { name: 'Component Gallery' })).toBeVisible();
      await expect(page).toHaveScreenshot(`ui-gallery-${combo.name}.png`, {
        ...SHOT,
        fullPage: true,
        // Spinner animation frames are disabled, but mask the element anyway.
        mask: [page.locator('.animate-spin')],
      });
    });
  }
});

test.describe('authenticated pages (live stack required)', () => {
  test.beforeEach(async ({ page }) => {
    // The login helper waits up to 60s per attempt — race it against a short
    // deadline so an unreachable stack SKIPS quickly instead of timing out.
    const ok = await Promise.race([
      login(page).then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000)),
    ]);
    // Skip (not fail) when the stack is unreachable — E2E_RUN=1 requires it.
    test.skip(!ok && process.env.E2E_RUN !== '1', 'live stack unreachable');
  });

  /** Volatile regions that must not participate in the diff. */
  const volatile = (page: Page) => [
    page.locator('.fv-live-dot'),
    page.locator('[data-live]'),
    page.locator('.maplibregl-canvas'),
    page.locator('.maplibregl-popup'),
    page.locator('time'),
  ];

  const PAGES: Array<{ name: string; path: string; ready: string | RegExp }> = [
    { name: 'dashboard', path: '/dashboard', ready: /dashboard/i },
    { name: 'assets', path: '/assets', ready: /assets/i },
    { name: 'admin', path: '/admin', ready: /admin/i },
    { name: 'trips', path: '/trips', ready: /trips/i },
    { name: 'commands', path: '/commands', ready: /command/i },
  ];

  for (const target of PAGES) {
    test(`${target.name} — light-ltr`, async ({ page }) => {
      await primeCombo(page, 'light', 'en');
      await page.goto(target.path);
      await expect(page.getByRole('heading', { name: target.ready })).toBeVisible({
        timeout: 30_000,
      });
      // Let skeletons resolve into data (or honest empty/error) before the shot.
      await page.waitForTimeout(1_500);
      await expect(page).toHaveScreenshot(`${target.name}-light-ltr.png`, {
        ...SHOT,
        fullPage: true,
        mask: volatile(page),
      });
    });
  }
});
