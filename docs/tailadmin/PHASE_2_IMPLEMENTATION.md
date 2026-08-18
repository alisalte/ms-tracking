# FleetVision TailAdmin Migration — Phase 2 Implementation

**Date:** 2026-08-18
**Scope:** TailAdmin foundation + application shell (`apps/web-dashboard`)
**Source of truth:** `docs/tailadmin/PHASE_1_AUDIT.md`
**Result:** TailAdmin shell live; all existing routes, auth, APIs, and business logic untouched. 222/222 unit tests pass; typecheck, lint (new files), and production build pass.

---

## 1. What was built

The Phase 1 finding was that Tailwind v4 + TailAdmin tokens were already wired but unconsumed (`tailwind-ui` had zero consumers; the shell was MUI). Phase 2 completed that staged strategy:

1. **TailAdmin application shell** — Sidebar / Header / MainContent / PageContainer (all Tailwind, replacing the MUI `shell/Sidebar` + `shell/Topbar`).
2. **Theme system** — light / dark / **system** with persistence and live OS-scheme tracking.
3. **Branding** — single-source `Brand` / `BrandLogo` components.
4. **9 new UI primitives** in `tailwind-ui` (Modal, Dropdown, Input, Select, Table, Spinner, Skeleton, Alert, EmptyState) on top of the existing 7.
5. **Breadcrumb** derived from the nav model; **mobile off-canvas navigation**; responsive desktop rail with collapse.
6. **30 new tests** across three spec files.

No dependency was added — the entire phase uses React 19, Tailwind v4 (already installed), lucide-react, and react-router v7. This satisfies "use the official TailAdmin architecture compatible with React 19 + TS + Vite + Tailwind" without pulling a template package: the TailAdmin layout anatomy (dark sidebar, 64px header, content column) is reproduced with the project's own token set, which was already TailAdmin's palette.

## 2. Changed files

### New (19 files)

| File | Purpose |
|---|---|
| `src/components/branding/Brand.tsx` | `Brand` + `BrandLogo` — the ONLY place the logo/wordmark is defined |
| `src/components/layout/Sidebar.tsx` | TailAdmin dark rail; permission-aware nav; desktop 270/64px collapse; mobile off-canvas |
| `src/components/layout/Header.tsx` | 64px sticky header: hamburger, breadcrumb, search (inert, parity), bell, help, theme, language, user |
| `src/components/layout/MainContent.tsx` | scrollable `<main id="fv-main-content">`; owns `PAGE_PADDING` + full-bleed contract |
| `src/components/layout/PageContainer.tsx` | standard page wrapper for new/migrated pages |
| `src/components/layout/Breadcrumb.tsx` | `Group / Item` trail derived from `nav.config` (longest-prefix match) |
| `src/components/layout/ThemeSwitcher.tsx` | light / dark / system dropdown |
| `src/components/layout/LanguageMenu.tsx` | en/fa switcher (Tailwind replacement for MUI `LanguageSwitcher`) |
| `src/components/layout/UserMenu.tsx` | identity + tenant + profile + logout dropdown |
| `src/components/tailwind-ui/Modal.tsx` | portal dialog: role=dialog, aria-modal, ESC, backdrop, scroll-lock, focus-on-open |
| `src/components/tailwind-ui/Dropdown.tsx` | `Dropdown` + `DropdownItem` (+header/danger); outside-click/ESC close |
| `src/components/tailwind-ui/Input.tsx` | label/error/hint wiring, `forwardRef` (RHF-compatible) |
| `src/components/tailwind-ui/Select.tsx` | native `<select>` styled to TailAdmin; same a11y contract |
| `src/components/tailwind-ui/Table.tsx` | `Table/THead/TBody/TFoot/TH/TD` kit |
| `src/components/tailwind-ui/Spinner.tsx` | role=status + sr-only label |
| `src/components/tailwind-ui/Skeleton.tsx` | aria-hidden shimmer |
| `src/components/tailwind-ui/Alert.tsx` | info/success/warning/danger; role=alert vs status |
| `src/components/tailwind-ui/EmptyState.tsx` | role=status; icon/title/description/action slots |
| `src/__tests__/{app-shell,theme-system,tailwind-ui}.spec.tsx` | 30 tests (see §6) |

### Modified (6 files)

| File | Change |
|---|---|
| `src/theme/ThemeRegistry.tsx` | light/dark/**system** preference (persisted, same key `fleetvision_theme_mode`); live `matchMedia('(prefers-color-scheme: dark)')` tracking; `preference` + `setPreference` added to context — `mode`/`toggleColorMode`/`setColorMode` unchanged for MUI-era consumers |
| `src/layouts/AppLayout.tsx` | composes the new shell; re-exports `PAGE_PADDING`; `useSilentRefresh` still mounted exactly once |
| `src/layouts/AuthLayout.tsx` | brand block replaced with `<Brand/>` (single source); MUI split-panel otherwise unchanged |
| `src/components/tailwind-ui/index.ts` | barrel extended (7 → 16 exports + types) |
| `src/i18n/locales/{en,fa}/common.json` | +3 keys: `common.theme`, `common.systemMode`, `common.navigation` |
| *(deleted)* `src/components/shell/Sidebar.tsx`, `shell/Topbar.tsx`, `components/LanguageSwitcher.tsx` | replaced by the Tailwind equivalents (git history preserves them) |

### Deliberately NOT changed

`src/router/index.tsx` (byte-identical route tree), all `src/api/*`, `src/auth/*` logic, `nav.config.tsx` (the permission model), `NotificationBell` (MUI, reused as-is — gradual compatibility), every page, `vite.config.ts`, `package.json`.

## 3. Architecture decisions

- **Router untouched** — `AppLayout` remains the single authenticated layout element; the shell swap is invisible to the route tree. No duplicate routing system.
- **Contracts preserved**: `#fv-main-content`, `PAGE_PADDING` (20px), relative-positioned `<main>` (Map/VideoWall full-bleed `inset:0` still works), `<header>` with a "notifications" button (e2e contract), `fleetvision_theme_mode` storage key (existing users' preference survives).
- **MUI compatibility**: MUI `ThemeRegistry`/`CssBaseline`/Emotion-RTL still wrap everything; preflight stays OFF; `NotificationBell` + all 19 pages keep working on MUI. Tailwind is now the preferred system for new components (`tailwind-ui` barrel).
- **Theme**: one `.dark` class on `<html>` drives Tailwind; MUI theme swaps in lockstep (unchanged mechanism). `system` resolves live and survives reloads; legacy `toggleColorMode()` pins the opposite of the resolved mode.
- **Branding**: gradient tile (brand-500→800) + "FleetVision" wordmark via `<Brand/>`; the AuthLayout and Sidebar share it — zero hardcoded logos remain.
- **Sidebar responsive**: desktop `lg:` permanent rail (270px ↔ 64px icon-only with tooltips); below `lg` an off-canvas dialog with labeled backdrop button; state (open/collapsed) hoisted in `AppLayout` so hamburger + toggle stay in sync.
- **A11y**: nav `aria-current="page"`, dialog `aria-modal` + labelled, ESC/backdrop close, focus-visible rings throughout, Spinners/EmptyStates announce via live regions, Dropdown exposes `aria-haspopup/aria-expanded/menu/menuitem`.

## 4. Dependencies

**None added.** Uses: react 19, react-router 7, tailwindcss 4 + `@tailwindcss/vite` (pre-existing), lucide-react, `@emotion/*`/`@mui/*` (unchanged, still required by MUI pages).

## 5. Routes affected

**All routes render inside the new shell** (behavior-identical): `/dashboard /map /trips /trips/:id /video /alarms /notifications /assets /fleets→redirect /vehicles→redirect /devices→redirect /reports /geofences /commands /maintenance /admin /account/profile /404` + public `/login /register /forgot-password /reset-password /mfa/verify` (AuthLayout brand only). Path/guard/redirect changes: **none**.

## 6. Tests

| Spec | Covers | Result |
|---|---|---|
| `app-shell.spec.tsx` (9) | layout composition, brand, permission filtering (none / `*` wildcard), active state + navigation, mobile drawer open/backdrop-close/nav-close, desktop collapse, breadcrumb derivation, user menu (identity/tenant/profile/logout) | ✅ |
| `theme-system.spec.tsx` (5) | default light, dark persistence + `.dark` mirror, system-follows-OS live flips, toggle pins explicit mode, persisted-system restore | ✅ |
| `tailwind-ui.spec.tsx` (16) | Button (loading/click), Spinner/Skeleton a11y, Alert roles/dismiss, EmptyState slots, Modal (portal/labels/ESC/backdrop/closeOnBackdrop), Dropdown (open/select/ESC/outside/header/danger), Input/Select (label/error/ref), Table kit + caption | ✅ |

**Totals: 222/222 unit tests pass** (192 pre-existing + 30 new — zero regressions). `typecheck` ✅ · `lint` ✅ for all new/modified files (repo-wide `pnpm lint` has **pre-existing** failures in untouched files — verified failing on clean HEAD before this phase; not introduced here) · `build` ✅ (4.0 MB bundle, pre-existing monolithic-bundle warning, unchanged strategy — code-splitting deferred with lazy routes per Phase 1 plan).

## 7. Known limitations

1. **Modal/Dropdown are dependency-free**, so no full focus trap and no arrow-key roving focus yet (Tab works; ESC/outside close implemented). Radix-style headless primitives remain a Phase-3+ option if audits require it.
2. **Global search input is inert** (parity with the previous topbar — backend has no search API; `common.searchPlanned`).
3. **NotificationBell is still MUI** inside the Tailwind header (deliberate gradual migration; its e2e/selectors unchanged).
4. **`/admin` and `/video` remain permission-ungated** at the route level (pre-existing gap, Phase 1 R9 — a product decision, addressed in Phase 3 within backend-supported limits).
5. **System-preference first paint**: `ThemeRegistry` reads the OS scheme synchronously at mount; no flash expected, but no blocking script in `index.html` (acceptable for an SPA behind auth).
6. **Breadcrumb** shows `Group / Item` only (nav-derived); detail pages like `/trips/:id` still rely on their own page headers.

**STOP after Phase 2 — Phase 3 (Auth/Tenant/RBAC) not started.**
