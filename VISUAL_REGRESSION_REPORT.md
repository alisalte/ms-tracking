# Visual Regression Report — FleetVision Web Dashboard

> **Date:** 2026-08-24 · Suite: `apps/web-dashboard/e2e/visual-regression.e2e.spec.ts` (Playwright `toHaveScreenshot`)

---

## 1. What was built

- **Spec:** `e2e/visual-regression.e2e.spec.ts` — two tiers:
  - **PUBLIC (runs with only the vite dev server):** `/login` and `/dev/ui-gallery` across the full matrix **{light, dark} × {en-LTR, fa-RTL}** = 8 baselines.
  - **AUTHENTICATED (live stack required):** `/dashboard`, `/assets`, `/admin`, `/trips`, `/commands` (light+LTR) with volatile regions masked (live dots, map canvas, popups, timestamps). **Skips honestly** when the stack is unreachable (fast 20s deadline instead of a 60s timeout); `E2E_RUN=1` makes the stack mandatory.
- **Component gallery** (`/dev/ui-gallery`, public route): every primitive × states — the stable, backend-free screenshot target. This is what makes public-tier visual regression deterministic.
- **Combo priming:** theme via `localStorage['fleetvision_theme_mode']`, language via `localStorage['fleetvision_language']` — set with `addInitScript` BEFORE app boot, so first paint is already correct (no flash-of-wrong-theme in the shot).
- **Diff policy:** `animations: disabled`, `caret: hide`, `scale: css`, `maxDiffPixelRatio: 0.02` (anti-aliasing tolerance; real content changes still fail).

## 2. Execution results (this session, real runs)

| Run | Command | Result |
|---|---|---|
| Baseline generation | `E2E_BROWSER_CHANNEL=msedge npx playwright test e2e/visual-regression.e2e.spec.ts --update-snapshots` | **8/8 public baselines written** |
| Verification | same, without `--update-snapshots` | **8 passed, 5 skipped (stack down), 0 failed** |
| Browser | system **msedge channel** (Playwright CDN chromium unavailable in this environment — the config's documented `E2E_BROWSER_CHANNEL` path) | ✅ |

Baselines committed under `e2e/visual-regression.e2e.spec.ts-snapshots/`:

```
login-dark-ltr-win32.png   login-dark-rtl-win32.png
login-light-ltr-win32.png  login-light-rtl-win32.png
ui-gallery-dark-ltr-win32.png   ui-gallery-dark-rtl-win32.png
ui-gallery-light-ltr-win32.png  ui-gallery-light-rtl-win32.png
```

## 3. What the matrix actually verifies

- **Dark + RTL in one shot:** the fa/RTL gallery baseline exercises mirrored layout (logical utilities), Persian typography (Vazirmatn fallback stack), and dark surfaces of every primitive — the four-combo matrix is the task's §18 requirement, not just light-LTR.
- **Login × 4** catches auth-card layout/dark/RTL drift on the most-visited public screen.
- **Authenticated pages:** masked shots (canvas/live-dots/time) verify page anatomy (header, toolbars, tables, KPI rows) without flaky tiles/clocks. Wired and self-skipping; **not captured this session because the docker stack (identity/DB/Kafka) was down** — run after `docker compose up` + services:
  `E2E_BROWSER_CHANNEL=msedge npx playwright test e2e/visual-regression.e2e.spec.ts --update-snapshots`

## 4. Operational notes (honest constraints)

1. **Baselines are platform-specific** (suffix `-win32`; font rasterization differs per OS). Regenerate with `--update-snapshots` on the machine that owns the baseline set; treat cross-OS diffs as false positives.
2. **No webServer in playwright.config** (matches the repo's existing e2e convention — the dev server is expected running). Start `npx vite` (or set a `webServer` block) before running.
3. Map tiles are external (OSRM/OSM) — always inside the mask; basemap-switch UI is covered by the public gallery/settings testids instead.
4. Updating a baseline is a REVIEWABLE act: `--update-snapshots` rewrites pixels; PR reviewers should see the binary diff.

## 5. Definition of done for §18

- [x] Baselines exist for main surfaces that don't need a backend (login + the entire design system × 4 combos)
- [x] Light+LTR / Dark+LTR / Light+RTL / Dark+RTL scenarios
- [x] Desktop shots (mobile-viewport shots: gallery/login pages are responsive — add a `--viewport-size` variant when the mobile polish pass lands)
- [x] Changes can't enter silently: the suite runs with `pnpm --filter @fleetvision/web-dashboard test:e2e`
- [ ] Authenticated five-page baselines — blocked on live stack in this session (spec + skip path verified)
