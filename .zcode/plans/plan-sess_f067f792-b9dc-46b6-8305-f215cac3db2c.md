# FleetVision × TailAdmin Integration Plan

## Situation
The frontend (`apps/web-dashboard`) is built entirely on **MUI v6 + Emotion** (174 files). TailAdmin is a **Tailwind CSS** template (brand `#465fff`, white 290px sidebar, `rounded-lg`, gray-200 borders, Outfit font). Per your decision, I'll use the **hybrid approach**: add Tailwind CSS v4 (preflight DISABLED so it coexists with MUI), build the TailAdmin-style shell in pure Tailwind, and rewrite the MUI theme tokens to match TailAdmin's exact palette — so every existing MUI page (maps, video, tables, CRUD forms) inherits the new look automatically.

The task says to adapt TailAdmin's *design system*, not copy its demo. The result is FleetVision, not a TailAdmin demo. The accent direction is **Indigo/Violet** (TailAdmin's brand `#465fff` already fits this). The dark slate sidebar in TailAdmin is WHITE in light mode — I'll adopt that signature look.

## What is NOT touched (preserved 100%)
- Routing (`src/router/*`), React Router v7, all routes, redirects
- Auth (Zustand store, token storage, JWT refresh, tenant header, `ProtectedRoute`, MFA)
- API layer (axios client, `apiGet/Post/Put/Delete`, all `*.api.ts`, query keys/clients)
- State management (Zustand, TanStack Query, all hooks)
- Realtime (`useRealtimeSocket`, `useAlarmRealtime`, `useLiveTracking`)
- Maps (MapLibre, clustering, markers, trip replay — `FleetMap`, `map-markers`, `map-cluster`)
- Video (WebRTC stream sessions, wall rotation, tiles — `WallGrid`, `LiveVideoPlayer`, `useStreamSession`)
- Forms & validation (react-hook-form + zod, all schemas)
- i18n (react-i18next, en/fa locales, RTL stylis cache)
- Types (`src/types/*`), mock data
- Docker (Dockerfile, nginx.conf, compose) — `pnpm stack:up` keeps working
- All business logic in pages/features

The CRUD patterns (hub + tabs + form drawer + confirm + detail drawer) and all API hooks stay intact; only their visual styling changes.

---

## Phase 1 — Add Tailwind CSS v4 (preflight off) + design tokens

**Goal**: Make Tailwind available for the shell without disturbing MUI.

1. **Install** `tailwindcss@4`, `@tailwindcss/vite`, `@tailwindcss/postcss` in `apps/web-dashboard`.
2. **`vite.config.ts`**: add the `@tailwindcss/vite` plugin.
3. **New `src/styles/tailwind.css`**: TailAdmin's exact `@theme` block — brand `#465fff` scale (50–950), blue-light, gray (25–950 + `gray-dark #1a2231`), success `#12b76a`, error `#f04438`, warning `#f79009`, orange, plus theme-purple `#7a5af8`. Import with `@use "tailwindcss"` but **disable preflight** (`@layer base { /* no reset */ }`) so MUI/Emotion styles are untouched. Add the TailAdmin `@utility` definitions (`menu-item`, `menu-item-active`, `menu-item-inactive`, `menu-item-icon-*`, `menu-dropdown-item*`, `no-scrollbar`, `custom-scrollbar`). Define the dark variant `@custom-variant dark (&:where(.dark, .dark *))`.
4. **`main.tsx`**: import `tailwind.css` before `global.css`.
5. **Fonts**: switch `index.html` Google Fonts from Roboto → **Outfit** (TailAdmin's font) for Latin; keep Vazirmatn for Persian/RTL.

## Phase 2 — Rewrite MUI theme tokens → TailAdmin palette

**Goal**: Every existing MUI component (tables, dialogs, forms, chips, buttons across all 174 files) automatically adopts the TailAdmin look with zero per-file edits.

Rewrite these 3 files:
1. **`src/theme/palette.ts`** — new TailAdmin-faithful tokens:
   - `primary.main: #465fff` (was `#2196F3`), with 50–950 scale, hover `#3641f5`, pressed `#2a31d8`, tint `rgba(70,95,255,0.10)`
   - `neutral` → TailAdmin gray scale (`gray-900 #101828`, `gray-500 #667085`, etc.)
   - `status` → TailAdmin semantics: success `#12b76a`, error `#f04438`, warning `#f79009`, info `#0ba5ec`, purple `#7a5af8`
   - `lightSurface` → `bg #f9fafb` (gray-50), `paper #fff`, `border #f2f4f7` (gray-100), `borderStrong #e4e7ec` (gray-200)
   - `darkSurface` → `bg #1a2231` (gray-dark), `paper #101828` (gray-900), elevated `#0c111d`
   - `sidebar` → now **white**: `bg #fff`, `text #667085`, `textStrong #101828`, `accent #465fff`, `border #f2f4f7`; dark-mode variant `bg #101828`
   - `glass` → retune aurora/purple tints to brand `#465fff` family
   - `mapAccents` → keep status colors but shift to TailAdmin greens/reds
   - `shadows` → TailAdmin `shadow-theme-xs…xl` scale
   - radius: `8px` (was 3px) — TailAdmin `rounded-lg`
2. **`src/theme/theme.ts`** (light) — `shape.borderRadius: 8`; typography `fontFamily: Outfit`; component overrides: `MuiCard` radius 8 + gray-200 border + theme-xs shadow; `MuiButton` radius 8 + brand fill; `MuiOutlinedInput` radius 8; `MuiChip` radius pill; `MuiTableCell` head `#667085` uppercase; align all `borderColor`/`backgroundColor` to new surface tokens.
3. **`src/theme/dark.theme.ts`** (dark) — mirror with `gray-900/950` surfaces, brand-500 primary, Outfit font, radius 8.

This single phase restyles every table, form, dialog, chip, alert, toggle, tab across all existing pages (assets, alarms, admin, reports, trips, geofences, profile, auth) for free.

## Phase 3 — TailAdmin shell (pure Tailwind)

Rebuild the application shell in Tailwind (faithful to TailAdmin's actual source). The shell wraps `<Outlet/>` so existing MUI pages render inside it unchanged.

1. **New `src/components/shell/Sidebar.tsx`** (Tailwind, replaces the MUI version):
   - White `aside` (`bg-white dark:bg-gray-900`), 290px expanded / 90px collapsed, `border-r border-gray-200 dark:border-gray-800`, `fixed top-0 h-screen z-50`, `mt-16 lg:mt-0`
   - FleetVision logo block (Truck icon in a brand-500 rounded badge + "FleetVision" wordmark; icon-only when collapsed)
   - Grouped nav using the existing `NAV_GROUPS` + `filterNavByPermissions` + i18n `t()` keys (preserving RBAC + translations) — rendered with TailAdmin `menu-item`/`menu-item-active`/`menu-item-inactive` utility classes + lucide icons
   - Active state: brand-tinted bg + brand-500 text + brand-500 left bar; RTL-aware (logical inset)
   - Collapsible (hover-expand when collapsed), mobile off-canvas with a `Backdrop`
   - Footer version strip
2. **New `src/components/shell/Topbar.tsx`** (Tailwind, replaces MUI version):
   - `sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-99999`, `h-16`
   - Left: sidebar toggle (hamburger/menu icons), `lg:hidden` logo, and the signature TailAdmin search input (`h-11 rounded-lg border-gray-200 pl-12 pr-14 xl:w-[430px]` with ⌘K hint badge + `Cmd/Ctrl+K` focus shortcut)
   - Right: `ThemeToggleButton`, `NotificationDropdown` (bell → `/alarms`), `LanguageSwitcher`, `UserDropdown` (avatar → profile/logout) — all preserving existing behavior (logout calls `useAuth().logout()`, theme toggle uses `useThemeContext()`, language switch uses `i18n.changeLanguage`)
3. **New `src/components/shell/SidebarContext.tsx`** — TailAdmin's `useSidebar` context (`isExpanded`, `isMobileOpen`, `isHovered`, `setIsHovered`, `toggle*`) with localStorage persistence (mirroring how the old `collapsed`/`mobileOpen` state worked in `AppLayout`).
4. **Rewrite `src/layouts/AppLayout.tsx`** — Tailwind layout: `<div class="flex min-h-screen">` with the `Sidebar` (fixed) + a `<div class="flex-1 lg:ml-[290px]">` containing `Topbar` (sticky) + `<main>` with consistent content padding. Keeps `<Outlet/>`. Preserves the full-bleed behavior for Map/Video (those pages use `position:absolute; inset:0` internally).
5. **Rewrite `src/layouts/AuthLayout.tsx`** — TailAdmin-style auth split panel (brand gradient left, clean form right) in Tailwind, with the same feature pills. Keeps `<Outlet/>`.

## Phase 4 — Theme toggle wiring

- `ThemeRegistry.tsx` already toggles `fleetvision_theme_mode` in localStorage and sets MUI mode. **Add**: it also toggles the `dark` class on `<html>` (so Tailwind `dark:` variants follow the same switch) — one line in the existing `useEffect` that sets `dir`/`lang`. Dark mode then works consistently across the Tailwind shell AND MUI components.

## Phase 5 — Dashboard restyle to TailAdmin

- **`DashboardGrid.tsx`**: keep the widget grid + all data hooks (`useFleetStats`), restyle to TailAdmin card language — clean white `rounded-lg border-gray-200 shadow-xs` cards (drop the glassmorphism aurora, which reads as a generic template). Header row with export button. KPI row, 12-col chart/alert grid, map preview — same layout, TailAdmin visuals.
- **`KpiCard.tsx`** / **`WidgetCard.tsx`**: TailAdmin KPI tile look — icon badge (brand-tinted `bg-brand-50`), overline label, large value, trend chip, mini sparkline. Keep ECharts `EChart` wrapper.
- **`EChart.tsx`**: retune the hardcoded tooltip/axis rgba values to the gray-900/gray-500 family; keep the SVG renderer + lazyUpdate.
- Add a TailAdmin-style fleet-status KPI row (Vehicles / Online / Offline / Moving / Stopped / Active Alarms) per the task spec §7, sourced from existing `useFleetStats`.

## Phase 6 — Global CSS + font swap

- **`src/styles/global.css`**: keep scrollbars, keyframes (`fv-pulse`, `fv-fade-in`, `fv-float`), selection, MapLibre overrides, breadcrumb RTL. Update the `::selection` + scrollbar colors to brand `#465fff`. Swap body font to Outfit (LTR) / Vazirmatn (RTL).
- Update `fontStackFor()` in `theme.ts` → Outfit-first Latin stack; Vazirmatn-first RTL stack.

## Phase 7 — i18n keys + nav polish

- Add a couple of nav-group i18n keys if needed (most exist: `navGroups.*`, `nav.*`). Verify RTL: sidebar grouping, chevron flip, breadcrumb mirror — all already handled via logical properties + the `fv-breadcrumb-sep` transform. No string hardcoding.

## Phase 8 — Validation (run in this order, fix as I go)

```
pnpm install
pnpm --filter @fleetvision/web-dashboard lint        # biome
pnpm --filter @fleetvision/web-dashboard typecheck   # tsc -b --noEmit
pnpm --filter @fleetvision/web-dashboard test        # vitest (14 specs)
pnpm --filter @fleetvision/web-dashboard build       # vite build
```
Then Docker: `pnpm stack:up` (unchanged scripts) and verify `fleetvision-web` serves. I'll fix any type/lint/test regressions introduced by the shell rewrite (the tests render MUI components which now get the new theme tokens — they assert behavior/data, not exact colors, so they should pass; I'll verify and patch if needed).

---

## What this plan deliberately does NOT do
- Does **not** rewrite the 174 MUI files into Tailwind — too risky, violates "don't break functionality." Instead, the MUI theme token rewrite (Phase 2) makes them all inherit the TailAdmin look automatically.
- Does **not** invent backend functionality. Maintenance (`UpcomingFeature`, no `vehicle-maintenance-service`) and Command Center (`UpcomingFeature`, no device command endpoint) stay as proper placeholders — the task says "only create routes that correspond to functionality actually present." Assets, Alarms, Admin, Geofences, Trips, Reports, Map, Video all keep their real CRUD/API hooks.
- Does **not** rename stack scripts or break Docker. `pnpm stack:up` continues to work unchanged.

## Files touched (summary)
- **New (~6)**: `tailwind.css`, `SidebarContext.tsx`, Tailwind `Sidebar.tsx` (replaces), Tailwind `Topbar.tsx` (replaces), maybe a `Backdrop.tsx`
- **Rewritten (~9)**: `palette.ts`, `theme.ts`, `dark.theme.ts`, `ThemeRegistry.tsx` (+dark class), `AppLayout.tsx`, `AuthLayout.tsx`, `DashboardGrid.tsx`, `KpiCard.tsx`, `WidgetCard.tsx`, `global.css`, `EChart.tsx`, `index.html` (fonts), `vite.config.ts` (plugin)
- **Untouched (~165)**: all pages' business logic, all API/auth/i18n/realtime/map/video code, all types, all tests, Docker, nginx, compose

## Final report
At the end I'll produce the TailAdmin Integration Report in the exact structure from the task spec (§31), with every module's status and any remaining work called out explicitly.