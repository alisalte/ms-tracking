# FleetVision — TailAdmin Migration: Phase 1 Audit & Migration Preparation

**Date:** 2026-08-17
**Scope:** `apps/web-dashboard` (React 19 + TypeScript strict + Vite) — analysis only.
**Baseline at audit time:** commit `f122145` ("sprint k"), clean working tree.
**Rule honored:** no application behavior modified, no backend touched, MUI not removed, TailAdmin not installed (Tailwind v4 is already present — see §1.3), no pages rewritten.

---

## Table of Contents

1. [Current architecture](#1-current-architecture)
2. [Frontend structure](#2-frontend-structure)
3. [Page inventory](#3-page-inventory)
4. [Component inventory](#4-component-inventory)
5. [MUI inventory](#5-mui-inventory)
6. [Routing inventory](#6-routing-inventory)
7. [Authentication inventory](#7-authentication-inventory)
8. [Authorization inventory](#8-authorization-inventory)
9. [API inventory](#9-api-inventory)
10. [Testing inventory](#10-testing-inventory)
11. [TailAdmin migration candidates](#11-tailadmin-migration-candidates)
12. [Risk assessment](#12-risk-assessment)
13. [Recommended migration order](#13-recommended-migration-order)
14. [Files that MUST NOT be modified](#14-files-that-must-not-be-modified)
15. [Files that can be safely migrated](#15-files-that-can-be-safely-migrated)
16. [Recommended target architecture](#16-recommended-target-architecture)

---

## 1. Current architecture

### 1.1 Stack summary

| Concern | Technology | Version |
|---|---|---|
| Framework | React | 19.0.0 |
| Language | TypeScript (strict, `noUnusedLocals/Parameters`) | 5.6.3 |
| Bundler / dev server | Vite (alias `@` → `src`, multi-service dev proxy) | 6.1.0 |
| UI library (current) | MUI + Emotion (`@mui/material`, `@mui/icons-material`*) | 6.4.6 |
| UI library (target) | Tailwind CSS v4 (CSS-first, `@tailwindcss/vite`) + TailAdmin patterns | 4.3.3 |
| Routing | react-router v7 (`createBrowserRouter`) | 7.3.0 |
| Server state | TanStack React Query | 5.68.0 |
| Client state | Zustand (exactly one store: auth) | 5.0.3 |
| Forms | react-hook-form + zod (+ `@hookform/resolvers`) | 7.84 / 4.4 |
| HTTP | axios (single client, interceptors) | 1.8.1 |
| Realtime | socket.io-client (gps WS :3001, notification WS :3010) | 4.7.2 |
| Maps | maplibre-gl (imperative `Marker`/`Popup`, no React wrapper) + supercluster | 6.2.0 |
| Charts | echarts + echarts-for-react **and** recharts (both in use) | 6.1 / 3.10 |
| i18n | i18next + react-i18next (en/fa, RTL via `stylis-plugin-rtl`) | 24.2 |
| Icons | lucide-react (108 distinct icons, 59 files) | 0.474.0 |
| Testing | Vitest + Testing Library (unit), Playwright (e2e) | 3.0.5 / 1.50 |
| Lint/format | Biome (repo-wide) | 1.9.4 |

\* `@mui/icons-material` is declared in `package.json` but has **zero imports** — all icons are lucide-react.

### 1.2 Application composition

```
main.tsx
 ├─ import '@/i18n'                      (side-effect i18next init, en/fa, persisted)
 ├─ import '@/styles/global.css'         (fonts, keyframes, .fv-glass glassmorphism)
 ├─ import '@/styles/tailwind.css'       (Tailwind v4 @theme tokens — TailAdmin palette)
 ├─ import 'maplibre-gl/dist/maplibre-gl.css'
 └─ <App/>
     <ThemeRegistry>                     MUI theme + Emotion RTL cache + dark mode → mirrors .dark on <html>
       <AuthProvider>                    profile bootstrap only (store hydrates itself)
         <QueryClientProvider>           TanStack Query (staleTime 30s, retry 1)
           <ToastProvider>               MUI Snackbar singleton + useToast context
             <RouterProvider/>           createBrowserRouter (src/router/index.tsx)
```

Each top-level router branch is wrapped in `ErrorBoundary`. Authenticated branch: `ProtectedRoute → AppLayout → <Outlet/>`.

### 1.3 Key finding — migration is already partially staged

The codebase is in a **deliberate intermediate state** between two UI systems:

1. **Tailwind v4 is fully wired** (CSS-first `@theme` in `src/styles/tailwind.css` with the complete TailAdmin token set: `brand-25…900` indigo `#465FFB`, TailAdmin `gray`/`graydark` scales, semantic `success/warning/danger/info` ramps, `meta-1…9` chart accents). Preflight is **deliberately disabled** (MUI `CssBaseline` owns resets). Dark mode via `.dark` class on `<html>`, mirrored by `ThemeRegistry`.
2. **`src/components/tailwind-ui/`** is a complete 7-component TailAdmin primitive kit (Button, Card, Avatar, Badge, IconButton, StatusBadge, Tooltip + barrel with prop types) — **with zero consumers**. The barrel's own comment declares it "the single presentation-layer entry point" for migration.
3. `theme/palette.ts` already mirrors the Tailwind `@theme` values — one token source feeds both systems.
4. `AppLayout.tsx` is already Tailwind-styled (`flex h-screen bg-gray-50 dark:bg-graydark-200`); dead CSS (`.fv-sidebar-link`, `.fv-focus-ring`, `.fv-scroll`) is pre-staged for the sidebar port.
5. Historical context: a previous "Limitless-inspired" MUI reskin is documented in `docs/frontend-theme-migration.md`; the palette has since moved to TailAdmin indigo. `@mui/icons-material` was already fully replaced by lucide-react.

**Implication:** the migration is a *completion* of an in-flight strategy, not a cold start. The intended path (tokens → primitives → shell → feature pages) was already chosen; Phase 2 continues it.

### 1.4 Monorepo context

9 backend services in `apps/*` (identity :3000, gps-engine :3005/WS :3001, fleet-management :3006, fleet-service :3007, notification :3008/WS :3010, map-engine :3009, media-service, reporting :3011, device-gateway), shared `packages/*` (auth, cache-redis, config, health, observability, persistence-knex, shared-kernel, web). The frontend talks to all of them through a single `/api/v1` base with prefix-based proxying (dev: `vite.config.ts`; prod: `nginx.conf`).

---

## 2. Frontend structure

```
apps/web-dashboard/src/
├── api/                 15 files — axios client, per-service api modules, query-client, query-keys, error classes
├── auth/                6 files  — zustand auth store, AuthProvider, ProtectedRoute, permissions engine, token.storage, useSilentRefresh
├── components/
│   ├── admin/           8  — AdminNav, Users/Roles/Permissions/Settings/Audit sections, User/Role detail drawers, admin-meta
│   ├── alarms/          7  — AlarmList, AlarmTimeline, AlarmMap, AlarmDetailDrawer, AlarmLiveIndicator, AlarmStatusBadge, AlarmTypeIcon
│   ├── assets/          6  — FleetsTab, VehiclesTab, DevicesTab, AssetDetailDrawers, AssetFormDrawer, asset-meta
│   ├── commands/        3  — CommandCatalogPanel, CommandHistoryTable, CommandParamDialog
│   ├── common/          4  — ErrorBoundary, ErrorState, RequirePermission (route guard), UpcomingFeature
│   ├── dashboard/       10 — DashboardGrid, KpiCard, StatCard, WidgetCard, EChart wrapper, AlertTypeBreakdownChart, ActiveAlertsPanel, FleetMapPreview, LiveBadge, EmptyState
│   ├── feedback/        2  — ToastProvider (MUI Snackbar), ConfirmDialog
│   ├── form/            2  — FormAlert, PasswordTextField
│   ├── geofences/       3  — GeofenceDrawMap (polygon/circle editor), GeofenceFormDialog, GeofencePreviewMap
│   ├── map/             8  — FleetMap, DeviceListPanel, DevicePopup, MapToolbar, PlaybackControls, RoutePlannerDialog, useTrackPlayback, types
│   ├── reports/         7  — Overview/Vehicles/Trips/Alarms/Geofences/Activity sections, ReportRangePicker
│   ├── shell/           3  — Sidebar, Topbar, NotificationBell, nav.config (nav IA + permission filtering)
│   ├── tailwind-ui/     8  — TailAdmin primitives (UNUSED — staged migration kit)
│   ├── trips/           5  — TripReplayMap, SpeedGraph, TripSummary, TripTimeline, useTripPlayback
│   ├── ui/              10 — shared MUI kit: PageHeader, DataTable, Toolbar, StatusBadge, EmptyState, Panel, Breadcrumb, SectionLabel, index barrel
│   └── video/           8  — LiveVideoPlayer, VideoTile, WallGrid, WallToolbar, ChannelDock, useStreamSession, useWallRotation
├── hooks/               5  — useAuth, useLiveTracking, useAlarmRealtime, useNotificationRealtime, useRealtimeSocket
├── i18n/                4  — config (RTL langs), index, locales en/fa common.json
├── layouts/             2  — AppLayout (Tailwind), AuthLayout (MUI)
├── lib/                 9  — errors, map-cluster, map-markers, mock-gate, relative-time, track-utils, use-cursor-pagination, validation, video-stream
├── mock/                5  — admin/alarm/command/fleet/video data (deterministic mulberry32 PRNG)
├── pages/               19 pages
├── router/              1  — index.tsx (full route tree, guards, redirects, 404)
├── styles/              2  — global.css (glass/keys), tailwind.css (@theme tokens)
├ ├── theme/             5  — palette (token source), theme (light), dark.theme, rtl (stylis caches), ThemeRegistry
├── types/               12 — domain types (admin, alarm, api, asset, auth, command, fleet, geofence, maintenance, notification, video)
├── test/ + __tests__/   1 setup + 24 spec files
└── App.tsx / main.tsx
```

Counts: **216 files** under `src/` + `e2e/`; 19 pages, ~92 component files, ~15 api modules, 24 unit spec files, 5 e2e spec files.

---

## 3. Page inventory

Classification legend: **KEEP** (already target-tech or logic-only, no work), **MIGRATE** (port markup to TailAdmin, keep logic), **REBUILD** (heavy interactive MUI surface — re-implement view layer against same hooks/APIs), **DEPRECATE** (candidate for removal), **UNKNOWN** (pending backend/decision).

| # | Page | Route(s) | Purpose | Domain | UI tech today | API deps | Auth/permission | Complexity | Class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | DashboardPage | `/dashboard` | Fleet KPI widget grid | fleet | none direct (delegates to DashboardGrid) | fleet.api via DashboardGrid | auth only | LOW (14 lines) | **MIGRATE** (grid widgets MUI+glass) |
| 2 | MapPage | `/map` | Live tracking, history playback, route planner, deep links | tracking | MUI + MapLibre custom | asset.api, fleet.api, map.api, useLiveTracking (WS) | `tracking.read` (route) | HIGH (424 ln) | **MIGRATE** (map core logic stays; MUI panels/toolbar port) |
| 3 | TripsPage | `/trips` | Trip roster table | tracking | MUI + ui-kit DataTable | fleet.api `useTrips` | auth only (nav: `tracking.read`) | MEDIUM (188 ln) | **MIGRATE** |
| 4 | TripDetailPage | `/trips/:id` | Trip replay: map + speed graph + timeline | tracking | MUI (Skeleton heavy) | fleet.api `useTripDetail` | auth only (nav-gated) | HIGH (274 ln) | **MIGRATE** |
| 5 | VideoWallPage | `/video` | Video wall (divisions, spotlight, rotation) | video | MUI shell + lib-free player | video.api (`useChannels`, `useVideoWalls`, `useSaveWall`), mock video-data | auth only | HIGH (237 ln) | **MIGRATE** (player is UI-lib-free; shell/toolbar/dock port) |
| 6 | AlarmCenterPage | `/alarms` | Alarm triage: list/timeline/map + drawer | monitoring | MUI (10 symbols) | alarm.api `useAlarms` | auth only | HIGH (297 ln) | **MIGRATE** |
| 7 | NotificationCenterPage | `/notifications` | Notification history + preferences matrix | monitoring | MUI (20 symbols — heaviest page) | notification.api (7 hooks), useNotificationRealtime (WS) | `notification.read` (route) | HIGH (540 ln) | **REBUILD** (largest MUI surface: Drawer, Tabs, List, Switch matrix) |
| 8 | AssetManagementPage | `/assets` (+redirects `/fleets`,`/vehicles`,`/devices`) | Fleet/vehicle/device CRUD registry | assets | MUI tabs + drawers | asset.api (6 hooks/mutations) | `vehicle.read` (route) + `fleet/vehicle/device.write` gates | HIGH (282 ln) | **REBUILD** (3 tabs, 2 drawer systems, confirm dialog) |
| 9 | GeofencePage | `/geofences` | Geofence list + draw/create/edit on map | geofences | MUI (15 symbols) + ui-kit | geofence.api (4), asset.api | `maps.read` (route) + `maps.write` gates | HIGH (430 ln) | **MIGRATE** (map draw logic stays; dialogs/table port) |
| 10 | ReportsPage | `/reports` | Analytics hub, 6 sections + range picker | reports | thin MUI shell (77 ln; weight in 6 section components) | report.api (in sections) | `report.read` (route) | MEDIUM | **MIGRATE** |
| 11 | CommandCenterPage | `/commands` | Meitrack MDVR command dispatch | commands | MUI (Autocomplete, dialogs) | command.api (3), asset.api `useDevices` | `telemetry.command.read` (route) + `telemetry.command.send` gate | MEDIUM (204 ln) | **MIGRATE** |
| 12 | MaintenancePage | `/maintenance` | Placeholder (backend CMMS missing) | maintenance | none (UpcomingFeature) | none | auth only | LOW (26 ln) | **KEEP** (re-skin when built) |
| 13 | AdminPage | `/admin` | Users/roles/permissions/settings/audit | admin | MUI shell + 8 admin components | admin.api (`useUsers`,`useRoles`,`usePermissions`) | auth only — **no permission gate (risk, see §12)** | HIGH (112 ln shell + heavy sections) | **REBUILD** (2 detail drawers, 5 sections; partly mock-bound) |
| 14 | LoginPage | `/login` | Email+password+tenant, `?redirect=` | auth | MUI Card/TextField + RHF/zod | auth.api via auth store | public | MEDIUM (183 ln) | **MIGRATE** (AuthLayout rebuild first) |
| 15 | RegisterPage | `/register` | Self-service registration (honest 501 UX) | auth | MUI + RHF/zod | auth.api `register` (backend pending) | public | MEDIUM (214 ln) | **MIGRATE** |
| 16 | ForgotPasswordPage | `/forgot-password` | Reset request | auth | MUI + RHF/zod | auth.api `forgotPassword` | public | MEDIUM (151 ln) | **MIGRATE** |
| 17 | ResetPasswordPage | `/reset-password` | Set new password via `?token=` | auth | MUI + RHF/zod | auth.api `resetPassword` | public | MEDIUM (167 ln) | **MIGRATE** |
| 18 | MfaVerifyPage | `/mfa/verify` | OTP second factor UI (backend MFA absent — wired to NotImplementedError stubs) | auth | MUI (11 symbols, custom OTP inputs) | auth.api `verifyMfa` (stub) | public | MEDIUM (203 ln) | **MIGRATE** (or DEPRECATE if MFA deferred — see §12) |
| 19 | ProfilePage | `/account/profile` | Read-only account/roles/security | profile | MUI static cards | auth store only | auth only | LOW/MEDIUM (206 ln) | **MIGRATE** |

Plus one inline route component: **NotFoundPage** (404) — inline MUI Box/Typography inside `router/index.tsx` → **MIGRATE** (trivial).

Summary: **KEEP 1 · MIGRATE 16 · REBUILD 3 (NotificationCenter, AssetManagement, Admin) · DEPRECATE 0 · UNKNOWN 0** (MfaVerifyPage flagged for a DEPRECATE-or-KEEP decision when MFA backend status is decided).

### 3.1 Shared-page-shape notes (drives migration design)

- URL-synced state pattern (`?section=`, `?tab=`, `?d=`, filters as search params) is used by Admin, Assets, Reports, VideoWall, Alarms — must be preserved verbatim.
- Full-bleed contract: MapPage and VideoWallPage escape `AppLayout`'s padded `<main>` via `position:absolute; inset:0`. The new TailAdmin shell must keep this contract (or introduce an explicit full-bleed layout variant).
- Loading = MUI `Skeleton` (15 files) / `CircularProgress` (17 files); empty states via shared `EmptyState`; errors via shared `ErrorState` — porting these three primitives unblocks most pages.

---

## 4. Component inventory

### 4.1 Layout & shell

| Component | Tech | Notes |
|---|---|---|
| `layouts/AppLayout.tsx` | **Tailwind** | already TailAdmin-styled wrapper; composes MUI Sidebar/Topbar; mounts `useSilentRefresh` once; `<main id="fv-main-content" style={{padding:20}}>` |
| `layouts/AuthLayout.tsx` | MUI | split branded panel, mobile-responsive via useMediaQuery, RTL-safe |
| `components/shell/Sidebar.tsx` | MUI | dark slate 270/64px, mobile off-canvas (Drawer); dead `.fv-sidebar-link` Tailwind CSS pre-staged for it |
| `components/shell/Topbar.tsx` | MUI (11 symbols) | 64px sticky, search, theme toggle, language switcher, NotificationBell, profile menu |
| `components/shell/NotificationBell.tsx` | MUI (12 symbols) | Badge + Popover + List; realtime unread count |
| `components/shell/nav.config.tsx` | logic | nav IA + `filterNavByPermissions` (permission/anyOf per item) |
| `components/LanguageSwitcher.tsx` | MUI | Button+Menu; drives i18n + RTL direction |

### 4.2 Reusable UI kit — `components/ui/` (MUI-based, used by nearly every page — highest-leverage migration surface)

`PageHeader`, `DataTable` (generic `DataTable<Row>`: column defs, skeleton rows, sticky header, i18n empty state, row click/selection — **the single table abstraction**), `Toolbar`, `StatusBadge`, `EmptyState`, `Panel`, `Breadcrumb` (RTL chevron mirroring), `SectionLabel`, barrel `index.ts`.

### 4.3 Staged TailAdmin kit — `components/tailwind-ui/` (**zero consumers today**)

`Button` (6 variants × 3 sizes, loading), `Card` (+CardHeader, polymorphic `as`), `Avatar`, `Badge` (8 tonal colors), `IconButton` (3 variants), `StatusBadge` (fleet statuses → tonal colors, dot+label), `Tooltip` (dependency-free CSS overlay, a11y attrs), `index.ts` barrel + prop types.
**Gap analysis for Phase 2:** missing primitives the app needs — Input/Select/Textarea (RHF-compatible), Dialog/Drawer (focus trap, portal), Tabs, Table, Skeleton, Toggle/ToggleButtonGroup, Menu/Dropdown, Switch/Checkbox, CircularProgress, Alert/FormAlert, Autocomplete, List. The MUI kit uses no `styled()` (0 occurrences) — everything is `sx`-inline, which ports mechanically.

### 4.4 Feature components (grouped, with UI tech)

- **dashboard (10):** DashboardGrid, KpiCard, StatCard, WidgetCard (glass `.fv-glass`), EChart (theme-aware echarts wrapper), AlertTypeBreakdownChart, ActiveAlertsPanel, FleetMapPreview, LiveBadge, EmptyState — MUI + glass CSS.
- **map (8):** FleetMap (supercluster clustering, rotated markers, gap-split polylines), DeviceListPanel, DevicePopup, MapToolbar, PlaybackControls (Slider + ToggleButtons), RoutePlannerDialog, `useTrackPlayback` hook, types.
- **geofences (3):** GeofenceDrawMap (POLYGON click/drag/right-click vertices + CIRCLE center/radius drag, bidirectional field sync), GeofenceFormDialog, GeofencePreviewMap.
- **alarms (7):** AlarmList, AlarmTimeline, AlarmMap, AlarmDetailDrawer, AlarmLiveIndicator (**already pure Tailwind** — the reference example of a migrated component), AlarmStatusBadge, AlarmTypeIcon.
- **trips (5):** TripReplayMap, SpeedGraph (recharts + MUI tooltip), TripSummary, TripTimeline (Slider), `useTripPlayback`.
- **video (8):** LiveVideoPlayer (**zero UI-lib dependency**, canvas MediaStream via srcObject), VideoTile (MUI overlays), WallGrid (CSS grid, divisions 1–64, spotlight), WallToolbar, ChannelDock (MUI List/Collapse), `useStreamSession` (synthetic stream, honest `stub` kind, documented RTCPeerConnection swap path), `useWallRotation` (bandwidth scheduler).
- **assets (6), admin (8), commands (3), reports (7):** MUI-heavy section components (tables, drawers, dialogs, forms) — see §3 pages.
- **common (4):** ErrorBoundary, ErrorState, RequirePermission (renders `PermissionDeniedState`), UpcomingFeature (placeholder).
- **feedback (2):** ToastProvider (root provider, MUI Snackbar singleton), ConfirmDialog.
- **form (2):** FormAlert, PasswordTextField (visibility toggle).

### 4.5 Cross-cutting states (current implementations)

- Loading: `CircularProgress` (17 files), `Skeleton` (15 files) — both MUI.
- Error: shared `ErrorState` + `ErrorBoundary`; API errors typed (`api/errors.ts`) and toasted via `useToast`.
- Empty: shared `ui/EmptyState` + dashboard `EmptyState`; i18n'd copy.

---

## 5. MUI inventory

### 5.1 Scale

| Metric | Value |
|---|---|
| `@mui/*` import statements (non-test src) | **97** (93 `@mui/material`, 3 `createTheme` from styles, 1 deep `@mui/material/Alert`) |
| Files containing MUI imports | **~92** |
| `sx={}` occurrences | **647 across 85 files** (dominant styling mechanism) |
| `styled()` / `makeStyles` / Grid / Container / Paper / AppBar / LinearProgress | **0 runtime usage** (theme files carry dead `MuiAppBar`/`MuiLinearProgress`/`MuiPaper` overrides) |
| `@mui/icons-material` imports | **0** (dependency removable at the end) |
| `useTheme` / `useMediaQuery` | 3 files / 1 file |

### 5.2 Component usage by category (files using each)

| Category | MUI components (files) | TailAdmin/Tailwind Phase-2 counterpart |
|---|---|---|
| **Layout** | Box (68), Stack (65), Divider (11), Drawer (8) | `div` + flex/grid utilities; `Divider` utility class; Headless UI / custom Drawer |
| **Typography** | Typography (72 — #1 import), Link (5) | utility classes + `<Link>` (react-router) |
| **Buttons** | Button (34), IconButton (24), ButtonGroup (1), ToggleButton/Group (4) | `tailwind-ui/Button`, `IconButton` (exist); add Toggle, ButtonGroup |
| **Forms** | TextField (18), Select (13), MenuItem (22), InputBase (5), Autocomplete (1), Checkbox (2), Switch (1), Slider (2), FormControl/InputLabel/FormControlLabel (2 each), Input (1), InputAdornment (1) | **biggest primitive gap** — build Input/Select/Checkbox/Switch/Slider/Autocomplete on RHF |
| **Tables** | Table family (4 files each) behind `ui/DataTable` | single TailAdmin Table primitive (port `DataTable` API as-is) |
| **Modals/overlays** | Dialog family (6 files each), Menu (6), Popover (1), Tooltip (14) | Dialog/Drawer with focus-trap + portal; Menu/Dropdown; `tailwind-ui/Tooltip` (exists) |
| **Navigation** | Tabs/Tab (5 each), List (4), ListItem/Button/Text (3–4), ListItemIcon (6) | Tabs primitive; lists as utility markup |
| **Feedback** | Skeleton (15), CircularProgress (17), Alert (7), Snackbar (1 — ToastProvider only), Chip (29), Badge (1) | Skeleton + Spinner primitives; Alert; toast system (keep MUI Snackbar until last or swap to sonner-style); Badge (exists), Chip→Badge |
| **Surfaces** | Card (20), CardContent (15), CardActionArea (3) | `tailwind-ui/Card` (exists) |
| **Data-viz** | none (echarts/recharts used directly — only skeletons/tooltips are MUI) | keep libraries; re-skin wrappers |
| **Misc** | Avatar (2), Collapse (1), CssBaseline/ThemeProvider (ThemeRegistry only) | Avatar (exists); Collapse → grid-rows transition or Radix |

### 5.3 Top MUI consumers (migration effort hotspots)

1. `pages/NotificationCenterPage` (20 symbols) · 2. `admin/AuditSection` (16) · 3. `pages/GeofencePage` (15) · 4. `geofences/GeofenceFormDialog` (14) · 5. `video/ChannelDock` + `assets/AssetDetailDrawers` (13) · 6. `shell/NotificationBell` + `admin/UsersSection` (12) · then Topbar, WallToolbar, MfaVerifyPage, reports/VehiclesSection, commands panels, AssetFormDrawer (11 each).

### 5.4 Can migrate to TailAdmin soon vs. must remain MUI temporarily

**Migrate early (mechanical):** Typography, Box, Stack, Divider, Card, Chip→Badge, Button, IconButton, Tooltip, Skeleton, CircularProgress→Spinner, PageHeader/Panel/Breadcrumb/SectionLabel/StatusBadge (ui kit), Page shells, ErrorState/EmptyState.
**Migrate after primitives exist:** TextField/Select/MenuItem (RHF register-compatible), Tabs, Table→DataTable port, Dialog→ConfirmDialog, Menu/Dropdown, Switch/Checkbox matrix, Autocomplete (CommandCenter), Slider (playback), ToggleButtonGroup (view switchers, playback speed).
**Keep MUI until the very end (system-level):** `ThemeRegistry` (MUI theme + Emotion RTL cache + CssBaseline) and `ToastProvider` (Snackbar) — they sit above the router; both must be swapped in one coordinated cutover step once no page imports MUI. `stylis-plugin-rtl` + per-direction Emotion caches can be dropped with them (Tailwind logical utilities `ps-/pe-/ms-/me-` already handle RTL; `rtl.ts` becomes obsolete).

### 5.5 Hazards inside the MUI surface

- **28 references to `var(--mui-palette-*)` in 15 files** (DeviceListPanel, SpeedGraph, TripDetailPage, global.css, …) — these variables are **never emitted** (no `CssVarsProvider`); only hardcoded fallbacks render. They must be replaced with the shared token names during migration (bug-fix opportunity, but verify visually).
- ~30 `styleOverrides` in `theme.ts`/`dark.theme.ts` encode the current design system — after migration these vanish; Tailwind utilities + the tailwind-ui primitives must reproduce them.
- `PermissionDeniedState` and the `ProtectedRoute` loading spinner render MUI from inside `src/auth/` (logic layer) — extract before/at swap (see §14/§15).

---

## 6. Routing inventory

Single file: `src/router/index.tsx` (223 lines, `createBrowserRouter`). No lazy routes, no route loaders/actions.

```
/                          → Navigate → /dashboard
├── ErrorBoundary → AuthLayout                      [PUBLIC]
│   ├── /login                    LoginPage
│   ├── /register                 RegisterPage
│   ├── /forgot-password          ForgotPasswordPage
│   ├── /reset-password           ResetPasswordPage
│   └── /mfa/verify               MfaVerifyPage
└── ErrorBoundary → ProtectedRoute → AppLayout      [AUTHENTICATED]
    ├── /dashboard                DashboardPage                     (no perm gate)
    ├── /map                      RequirePermission(tracking.read)
    ├── /trips                    TripsPage                         (no perm gate)
    ├── /trips/:id                TripDetailPage                    (no perm gate)
    ├── /video                    VideoWallPage                     (no perm gate)
    ├── /alarms                   AlarmCenterPage                   (no perm gate)
    ├── /notifications            RequirePermission(notification.read)
    ├── /assets                   RequirePermission(vehicle.read)
    ├── /fleets                   Navigate → /assets?tab=fleets
    ├── /vehicles                 Navigate → /assets?tab=vehicles
    ├── /devices                  Navigate → /assets?tab=devices
    ├── /reports                  RequirePermission(report.read)
    ├── /geofences                RequirePermission(maps.read)
    ├── /commands                 RequirePermission(telemetry.command.read)
    ├── /maintenance              MaintenancePage                   (no perm gate)
    ├── /admin                    AdminPage                         (⚠ no perm gate)
    ├── /account/profile          ProfilePage                       (no perm gate)
    └── *                         NotFound (inline, inside AppLayout)
```

- **Public:** 5 auth routes. **Authenticated:** 14 + 404. **Role-protected:** none (permission-string-based only). **Tenant-protected:** none at route level (tenant isolation is transport-level: `X-Tenant-Id` header + WS rooms + backend enforcement).
- **Guards:** `ProtectedRoute` (token check + `?redirect=` back; full-screen MUI spinner while `isLoading`) and `RequirePermission` (renders `PermissionDeniedState` *inside* the layout; UX-only, backend enforces the same strings).
- **Lazy routes:** none — all 19 pages statically imported (single monolithic bundle; independent Phase-2+ optimization opportunity, not required for TailAdmin).
- **Redirects:** `/`→`/dashboard`; `/fleets|/vehicles|/devices`→`/assets?tab=…`.
- **404:** inline component inside AppLayout.
- Nav visibility (`nav.config.tsx` `filterNavByPermissions`) hides items by permission — note `/trips` nav requires `tracking.read` but the route itself is ungated (defense-in-depth gap to raise with backend, not a UI task).

**Migration verdict:** routing is UI-agnostic except (a) ProtectedRoute's MUI spinner and (b) the inline MUI 404. Route tree, paths, guards, redirects stay byte-identical during migration.

---

## 7. Authentication inventory

*(No changes proposed — this is the contract Phase 2 must preserve.)*

| Aspect | Current implementation |
|---|---|
| Store | `src/auth/auth.store.ts` — the only zustand store: `{accessToken, refreshToken, user, tenantId, isAuthenticated, isLoading, error}` + `login/refreshTokens/fetchUser/logout/hydrate/clearError`. **Synchronous hydration from localStorage at store creation** (no refresh bounce). |
| Login flow | `LoginPage` → `useAuthStore.login(email, password, tenantId)`: persist tenant pre-login (`saveTenantId`) so `X-Tenant-Id` rides the login request; `POST /auth/login` (snake_case→camelCase mapping); canonicalize tenant to server UUID; save token pair; best-effort `GET /auth/me` seeds real `permissions[]`. |
| MFA | Backend absent. `verifyMfa`/`getMfaFactors` are typed `NotImplementedError` stubs; fully built OTP UI at `/mfa/verify` errors honestly. No MFA branch in login flow. |
| Token storage | `src/auth/token.storage.ts` — plain **localStorage** keys `fleetvision_tokens` (TokenPair JSON incl. tenantId) + `fleetvision_tenant_id`. Read directly by axios client and WS hooks (not via store). `rememberDevice` checkbox is cosmetic. |
| Refresh — reactive | axios 401 interceptor (`api/client.ts`): skips `/auth/login`+`/auth/refresh`, single-flight `refreshPromise`, bare-axios `POST /auth/refresh`, retry original once; on failure `clearTokens()` + hard redirect `/login`. |
| Refresh — proactive | `useSilentRefresh` (mounted once in AppLayout): decodes JWT `exp` via atob, schedules refresh at `exp−60s` (min 5s), reschedules on token change. Access TTL 15 min. |
| Logout | `POST /auth/logout` (failure tolerated) → null state + clear storage. |
| Current user | `GET /auth/me` → User incl. `permissions[]`, `roles[]`. |
| Session expiration | 401→refresh→retry / forced `/login` redirect. No idle timeout, no expiry toast. |
| Unauthorized handling | Typed `UnauthorizedError(401)`/`ForbiddenError(403)` from `api/errors.ts`; UI toasts; no snackbar in interceptors. |
| Multi-tenancy | Manual tenant field at login; `X-Tenant-Id` on every request; WS rooms `tenant:<id>:fleet/alerts/notifications` + `user:<tenantId>:<userId>`. Tenant never a query/body param. |
| Provider | `AuthProvider` = profile-bootstrap effect only; consumers read the store directly. |

**UI coupling inside auth layer (to extract during migration, not change):** `auth.guard.tsx` renders MUI `Box`+`CircularProgress`; `permissions.tsx` renders `PermissionDeniedState` (EmptyState + lucide icon) and imports `useTranslation`. Behavior must not change — only the rendered markup of these two leaf states.

**Known timing quirk (pre-existing, out of scope):** `user.permissions` seeds `[]` until `/auth/me` resolves — permission-gated routes can flash `PermissionDenied` right after login. Also WS sockets read the token at connect time only (rotation picked up on reconnect).

---

## 8. Authorization inventory

- **Model:** permission strings from JWT claims (`GET /auth/me`); roles displayed but never gated on. `'*'` wildcard = tenant-admin (mirrors backend `permissionSatisfies`). AND semantics by default (`canAll`), ANY via `PermissionGate any`.
- **Catalog (23 strings, `src/auth/permissions.tsx`):** `fleet.read|write`, `vehicle.read|write`, `device.read|write`, `tracking.read`, `maps.read|write`, `report.read|export`, `notification.alert.read|ack|resolve`, `notification.rule.read|update`, `notification.event.read`, `notification.read`, `notification.read.all`, `notification.preference.read|write`, `telemetry.command.read|send`.
- **Surfaces:** `usePermissions()` hook (with frozen-empty-array guard against re-render loops) · `<PermissionGate requires any?>` (buttons/toolbars) · `<RequirePermission>` (route level) · `filterNavByPermissions` (nav IA).
- **Route gates:** 6 routes gated (see §6). Ungated: `/dashboard /trips /trips/:id /video /alarms /admin /maintenance /account/profile` — of these, **`/admin` without a gate is the notable risk** (§12).
- **In-page gates:** `fleet/vehicle/device.write` (Assets), `maps.write` (Geofences), `telemetry.command.send` (Commands).
- **Mock catalog:** Admin permissions UI renders a 14-domain mock IAM catalog (`iam.user.read`, …) from `mock/admin-data.ts` — static regardless of mock mode (does not match live permission strings; flagged §12).
- Explicit design note in code: guards are UX-only; backend enforces identical strings.

---

## 9. API inventory

### 9.1 Transport

Single axios client (`api/client.ts`): `baseURL = VITE_API_BASE_URL ?? '/api/v1'`, JSON, 30s timeout. Request interceptor: `Authorization: Bearer` + `X-Tenant-Id` (from token.storage). Response interceptor: 401-refresh-retry (§7) + error normalization. Envelope helpers: `apiGet/Post/Put/Patch/Delete` (unwrap `{data}`), `…Raw` (gps/map/reporting return raw bodies), `…NoContent` (204), `apiGetBlob` (CSV). Typed error hierarchy in `api/errors.ts` (`Unauthorized/Forbidden/NotFound/Conflict/Validation/Server/Network`), JSON:API `errors[0]` extraction, `getApiErrorMessage`.

### 9.2 Modules → services (dev proxy = vite.config.ts; prod = nginx.conf)

| API module | Backend service (port) | Endpoints/roles | Mock behavior |
|---|---|---|---|
| `auth.api` | identity (3000) | login/refresh/me/logout, register/forgot/reset (501-honest), MFA stubs | none |
| `admin.api` | identity `/iam/*` + `/auth/api-keys` | users CRUD, roles, audit, settings, permission catalog | users=mock-fallback; roles/audit/settings mock-only (settings throws NotImplementedError in real mode); catalog static mock |
| `asset.api` | fleet-management (3006) | fleets/vehicles/devices CRUD, bind/unbind, archive, `fetchAll` cursor-follower (200/page, ≤50) | mock fixtures from fleet-data |
| `fleet.api` | fleet-management + gps-engine (3005) | `/summary`, positions, `tracking/devices/status`, `/trips` registry+detail (wire→UI join) | mock from `mockMapVehicles` |
| `map.api` | map-engine (3009) + gps-engine | track windows, map-matching (OSRM `route/match`), reverse geocode, route presets | none (real-only) |
| `geofence.api` | map-engine (3009) | geofence CRUD + infinite pages + status/archive; own inline `geofenceKeys` | empty-list fallback |
| `alarm.api` | notification (3008; WS 3010) | alerts list/detail, ack/resolve transitions (optimistic w/ rollback) | mock alarm-data |
| `notification.api` | notification (3008) | cursor-paged history, detail, mark-read/all, preferences matrix, channel health, unread count (30s poll) | empty fallback |
| `report.api` | reporting (3011) | overview/vehicles/trips/alarms/geofences/activity + CSV blob export | none (real-only) |
| `command.api` | fleet-management `/device-commands` | Meitrack catalog (5min cache), send, history (3s/15s conditional poll) | mock command-data |
| `video.api` | media-service (`/channels`, `/media/*`) | channels, walls (walls mock-only today; `useSaveWall` rejects honestly in real mode) | mock video-data |
| `query-client.ts` | — | staleTime 30s, retry 1, refetchOnFocus/Reconnect, mutations retry 0 | — |
| `query-keys.ts` | — | hierarchical factories (`fleet/trips/video/alarms/commands/assets/reports/admin/notifications`); deviations: geofence inline keys, map/report ad-hoc literals | — |

### 9.3 Realtime

`useRealtimeSocket` base (websocket transport only, manual 1s→30s backoff ×10, stable ref-map resubscribe) → `useLiveTracking` (`VITE_GPS_WS_URL` :3001, `tenant:<id>:fleet`, `position.update`/`device.status`, `mergeLivePositions`) · `useAlarmRealtime` + `useNotificationRealtime` (:3010, tenant+user rooms, `alarm.*` / `notification.new` with incremental cache patch capped at 100).

### 9.4 Mock gate

`lib/mock-gate.ts`: `?useMock=` URL param → `localStorage['fleetvision_use_mock']` → `VITE_USE_MOCK` → default **false**; network-error-only fallback (`withMockFallback`), honest failures otherwise; 250ms simulated latency; deterministic mulberry32 data.

**Migration verdict:** the API layer is UI-agnostic (no MUI/tailwind imports; errors toasted by UI). It is a MUST-NOT-MODIFY zone except zero-risk cosmetic type moves. The only layering oddities: `admin.api`/`report.api` borrow `downloadBlob` from `lib/video-stream` (works; optionally relocate later).

---

## 10. Testing inventory

### 10.1 Infrastructure

- **Unit:** Vitest, jsdom, globals, `css:false`, setup `src/test/setup.ts` (jest-dom matchers + forces `fleetvision_use_mock=true`; browser APIs stubbed per-file, not globally). Alias `@`→src.
- **E2E:** Playwright, Desktop Chrome, `fullyParallel:false`, no webServer (stack started externally; specs `test.skip()` gracefully when a dependency is down), no storageState — custom login-once + localStorage-injection helper (`e2e/helpers/login.ts`).
- **CI (`.github/workflows/ci.yml`):** lint (Biome) → typecheck → build → `pnpm test` (unit only; **e2e not in CI**).
- **Coverage:** **not configured anywhere** (no coverage block, no `@vitest/coverage-v8`, no thresholds, no artifacts beyond `e2e/.results/.last-run.json` = last run passed).

### 10.2 Volume

- **Unit: 192 test cases / 41 describes / 24 files.** Breakdown by resilience to a UI-lib swap: **14 LOGIC** (pure hooks/functions: api wire contracts, auth store, token storage, socket state machine, playback math, track-utils, validation, errors, mock-gate, pagination types, mergeLivePositions) · **9 COMPONENT-DOM** (assert rendered text/roles) · **2 MIXED**.
- **E2E: 12 tests / 5 specs** (reports 5, geofences 3, notifications 2, geofence-alarm 1 Kafka pipeline, history-playback 1).

### 10.3 UI-library coupling inside tests (the exact swap hazards)

| Location | Coupling |
|---|---|
| `notifications.spec.tsx:171` | `document.querySelector('.MuiBadge-badge')` — hard MUI class |
| `notifications.spec.tsx:218` | `.closest('label')?.querySelector('input')` — MUI FormControlLabel structure |
| `alarms.spec.tsx:215`, `map.spec.tsx:299` | `getByRole('presentation')` — MUI Drawer implementation role |
| alarms/assets/map specs | MUI Select open gesture: `fireEvent.mouseDown` on `combobox` + `role=option` |
| `e2e/notifications.e2e.spec.ts:99` | `page.locator('.MuiDrawer-root')` |
| `e2e/reports.e2e.spec.ts` | `.echarts-for-react` class (chart-lib, not MUI) |
| `e2e/geofences.e2e.spec.ts` | `waitForTimeout(600)` documented as "let the MUI menu portal unmount" |

The rest of the suite leans on app-owned `data-testid`s (`report-*`, `geofence-*`, `history-*`, `playback-*`) and semantic roles — **designed to survive the swap**. Phase 2 must keep every existing testid stable and update the 7 coupled selectors above alongside the components they cover.

---

## 11. TailAdmin migration candidates

Ranked by leverage (each unblocks the pages/sections beneath it):

| # | Candidate | Why | Unblocks |
|---|---|---|---|
| 1 | **Shared ui-kit port** (`PageHeader, Panel, Toolbar, StatusBadge, EmptyState, Breadcrumb, SectionLabel`) → tailwind-ui | used by nearly every page; pure presentational | all pages' shells |
| 2 | **`DataTable` port** (same generic API: columns, skeleton rows, sticky header, empty state, selection) | the only table abstraction; 6+ consumers | Trips, Geofences, Commands history, Admin users, Assets lists, Reports tables |
| 3 | **Form primitives** (Input, Select, Textarea, Checkbox, Switch, Autocomplete) RHF-register-compatible, zod error display parity with FormAlert | 18 TextField + 13 Select files | Login/Register/Reset/Forgot, Geofence dialog, Command param dialog, Asset form drawer, preferences matrix |
| 4 | **Overlay primitives** (Dialog w/ focus-trap+portal, Drawer, Menu/Dropdown, Popover) | 6 Dialog + 8 Drawer + 6 Menu files; ConfirmDialog single consumer | Assets, Admin, Alarms, Notifications, Commands, Geofences |
| 5 | **Feedback primitives** (Skeleton, Spinner, Alert/FormAlert; toast system decision) | 15 Skeleton + 17 CircularProgress + 7 Alert files | every loading/error state |
| 6 | **Shell port**: Sidebar (dead `.fv-sidebar-link` CSS already staged), Topbar, NotificationBell, AuthLayout | biggest visible win; AppLayout already Tailwind | whole app chrome |
| 7 | **Tabs + ToggleButtonGroup primitives** | 5 Tabs files, 4 Toggle files, URL-synced tab state | Assets, Reports, Notifications, Alarms view switcher, playback speed |
| 8 | **Chart wrappers re-skin** (`EChart` already theme-aware; SpeedGraph/StatCard recharts tooltip DOM is MUI) | libraries stay; only container/tooltip/legend DOM | Dashboard, Reports, TripDetail |
| 9 | **Map/video panel chrome only** (FleetMap/players stay; DeviceListPanel, MapToolbar, PlaybackControls, VideoTile overlays, ChannelDock, WallToolbar port) | map/video engines are UI-lib-free at core | Map, VideoWall, Trips, Geofences |
| 10 | **Auth leaf states** (guard spinner, PermissionDeniedState, inline 404) | tiny, but sit in logic files | ProtectedRoute, RequirePermission, router |

**Explicitly NOT migration candidates:** api/, auth store/guards logic, hooks, lib, i18n, types, mock, echarts/maplibre/socket.io integrations, react-query keys, forms logic (RHF+zod), URL-state conventions.

---

## 12. Risk assessment

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **RTL regression** — RTL is currently implemented by Emotion `stylis-plugin-rtl` mirroring; Tailwind relies on logical utilities being used consistently | High | High | RTL visual snapshot checklist per primitive (fa locale); prefer `ps/pe/ms/me/start/end` utilities; test Sidebar/Drawers/Menus in fa; keep `dir` sync mechanism |
| R2 | **Dark-mode drift** — MUI theme object vs Tailwind `.dark` tokens can diverge visually during the long dual period | Medium | High | palette.ts stays the single source; compare light/dark per migrated component; keep `.dark` mirroring until cutover |
| R3 | **Focus-trap / a11y loss** — MUI Dialog/Drawer/Menu/Tooltip ship focus management, aria, ESC, scroll-lock for free; hand-rolled replacements often don't | High | Medium | use battle-tested headless primitives (e.g., Radix/Headless UI) inside tailwind-ui wrappers; keyboard walkthrough per overlay; keep Tooltip a11y attrs |
| R4 | **Test breakage** — 7 known MUI-coupled selectors (§10.3) + Select open-gesture patterns in 3 unit specs | Medium | Certain (scoped) | update selectors in the same PR as the component; never rename app testids; run unit suite per page migration |
| R5 | **Form behavior drift** — PasswordTextField adornments, Autocomplete keyboard nav, Select rendering, RHF error parity | Medium | Medium | port FormAlert contract first; e2e login flow after AuthLayout/Login migration |
| R6 | **Dual-system bundle bloat** — MUI + Emotion remain while Tailwind grows | Low | Certain | acceptable mid-migration; final cutover removes MUI/Emotion/stylis/icon deps; add `React.lazy` routes as an independent win |
| R7 | **`var(--mui-palette-*)` phantom variables** (28 refs/15 files) already render fallbacks only | Low | Pre-existing | replace with shared tokens during each file's migration; do not bulk-edit up front |
| R8 | **Preflight conflict** — enabling Tailwind preflight while MUI is alive would reset MUI globally | High | Low | keep preflight OFF until the MUI-removal cutover; then re-enable and audit |
| R9 | **Permission-gate gaps exposed mid-migration** — `/admin` (and /trips, /video, /alarms) lack route gates; nav hiding is cosmetic | Medium | Pre-existing | do NOT "fix" silently in Phase 2 (behavior change); raise as a separate backend+frontend decision ticket |
| R10 | **MfaVerifyPage orphaned** — full UI wired to NotImplementedError stubs; may be deprecated instead of migrated | Low | — | decide MFA roadmap before migrating this page |
| R11 | **Map/video interactivity regressions** — playback slider, wall rotation, geofence draw gestures are tightly coupled to MUI controls' event shapes | Medium | Medium | keep hooks (`useTrackPlayback`, `useWallRotation`, `useStreamSession`) untouched; port controls with identical callback contracts; e2e playback spec is the gate |
| R12 | **Full-bleed layout contract** (`position:absolute; inset:0` in Map/VideoWall vs padded main) | Low | Medium | new shell must provide an explicit full-bleed variant from day 1 |
| R13 | **Coverage blindness during migration** — no coverage tooling; regressions in untested components may pass CI | Medium | Medium | Phase 2 prerequisite: add `@vitest/coverage-v8` + baseline; lean on e2e for the 3 REBUILD pages |
| R14 | **ToastProvider/ThemeRegistry cutover** — root providers are MUI; swapping them affects every page at once | High | Low | sequence last; single PR; full unit+e2e run; keep Snackbar API (`useToast`) identical across the swap |

---

## 13. Recommended migration order

Strangler pattern — MUI and TailAdmin coexist (they already do) until a final cutover. Each step must keep `pnpm lint && typecheck && build && test` green and change zero routes/logic.

**Stage 0 — Safety net (prerequisite)**
1. Add coverage tooling + baseline report (no thresholds yet). 
2. Optional but recommended: enable React Router lazy imports (behavior-neutral perf win that also de-risks later page swaps).

**Stage 1 — Foundation (no page changes)**
3. Extend `tailwind-ui` with the missing primitives in dependency order: Skeleton/Spinner/Alert → Input/Select/Checkbox/Switch (+RHF wrappers) → Tabs/Toggle → Table (port `DataTable` API verbatim) → Menu/Dropdown → Dialog/Drawer (focus-trap; pick Radix or hand-rolled with tests). Keep MUI versions importable in parallel (`ui/` stays).
4. Port shared `ui/` kit presentational pieces onto tailwind-ui (PageHeader, Panel, Toolbar, StatusBadge, EmptyState, Breadcrumb, SectionLabel) with identical props.
5. Extract MUI out of logic files: `ProtectedRoute` spinner, `PermissionDeniedState`, inline 404 → tailwind-ui versions (same behavior).

**Stage 2 — Shell**
6. Sidebar → TailAdmin (`.fv-sidebar-link` CSS already staged), Topbar, NotificationBell, LanguageSwitcher; keep nav.config IA and permission filtering untouched.
7. AuthLayout → TailAdmin; then the 5 auth pages (Login → Forgot → Reset → Register; MfaVerify pending R10 decision).
8. Port ConfirmDialog, ToastProvider internals can wait (R14).

**Stage 3 — Pages low→high complexity (each = one PR, tests updated in-PR)**
9. Dashboard widgets (glass cards already CSS-based; StatCard/KpiCard/EChart re-skin).
10. TripsPage → TripDetailPage (DataTable + Skeleton ports; playback e2e as gate).
11. ReportsPage + 6 sections (they already use app-owned testids — safest DOM assertions).
12. CommandCenterPage (Autocomplete primitive required).
13. GeofencePage (map engine untouched; dialog/table/toolbar port).
14. AlarmCenterPage (AlarmLiveIndicator already Tailwind — use as the style reference).
15. MapPage (panels/toolbar/playback controls; full-bleed variant of the shell).
16. VideoWallPage (tile overlays, dock, toolbar; player untouched).
17. ProfilePage.
18. **REBUILD trio** (highest risk, do after primitives are battle-tested): NotificationCenterPage → AssetManagementPage → AdminPage.

**Stage 4 — Cutover (single coordinated release)**
19. ToastProvider → non-MUI toast; ThemeRegistry → Tailwind-only theme provider (keep `.dark` + `dir` + language persistence semantics); remove MUI `styleOverrides` reliance.
20. Delete now-unused MUI imports per file; flip Tailwind preflight ON; audit global.css resets.
21. Remove deps: `@mui/material`, `@mui/icons-material` (already unused), `@emotion/*`, `stylis-plugin-rtl`; delete `theme/rtl.ts`, `theme.ts`, `dark.theme.ts` (keep `palette.ts` as token source); prune dead `.fv-*` CSS.
22. Full regression: unit + e2e + manual RTL/dark walkthrough of every route.

**Explicit non-goals for Phase 2:** no permission-gate additions (R9), no MFA decisions (R10), no API/auth/hook refactors, no route changes.

---

## 14. Files that MUST NOT be modified

*(Anything not listed under §15. During Phase 2, touching these requires an explicit exception + review.)*

**Zero-modification zone (behavior contracts):**

- `src/api/**` — all 15 modules (`client.ts` interceptors, `errors.ts`, `query-client.ts`, `query-keys.ts`, every `*.api.ts`)
- `src/auth/auth.store.ts`, `src/auth/token.storage.ts`, `src/auth/useSilentRefresh.ts`, `src/auth/auth.context.tsx` — session logic
- `src/auth/permissions.tsx` — *logic only*; the exported `PermissionDeniedState` markup MAY be re-skinned in Stage 1 step 5 without touching evaluation logic (`permissionSatisfies`, `usePermissions`, `PERMISSIONS`)
- `src/auth/auth.guard.tsx` — *logic only*; the loading spinner markup may be swapped (Stage 1 step 5); redirect/hydration semantics frozen
- `src/hooks/**` — `useRealtimeSocket`, `useLiveTracking`, `useAlarmRealtime`, `useNotificationRealtime`, `useAuth`
- `src/lib/**` — `map-cluster`, `map-markers`, `track-utils`, `mock-gate`, `relative-time`, `use-cursor-pagination`, `validation`, `video-stream`, `errors`
- `src/router/index.tsx` — **route tree, paths, guards, redirects, 404 placement are frozen** (only the inline 404's markup swaps)
- `src/components/shell/nav.config.tsx` — nav IA + permission filters frozen (icons/labels may change only with a separate UX decision)
- `src/i18n/**` — no key removals/renames; additions allowed
- `src/types/**`, `src/mock/**` — domain contracts & fixtures
- `src/main.tsx`, `src/App.tsx` provider order — unchanged until Stage 4 cutover
- `src/components/map/useTrackPlayback.ts`, `src/components/trips/useTripPlayback.ts`, `src/components/video/useStreamSession.ts`, `useWallRotation.ts` — playback/stream engines
- `src/components/video/LiveVideoPlayer.tsx` — UI-lib-free by design; do not regress srcObject handling
- `src/components/tailwind-ui/**` existing 7 primitives' public APIs (extend, don't break)
- All `data-testid`s in every file (test contract)
- `package.json` scripts, `vite.config.ts` proxy table, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts` (Stage 0 coverage tooling is the only sanctioned addition)
- All backend services, `packages/*`, `infra/**` — out of scope entirely

---

## 15. Files that can be safely migrated

Presentation-layer files whose logic must be preserved but whose markup/styles may be ported (each under its Stage-2/3 PR, with tests updated in the same PR):

- `src/layouts/AuthLayout.tsx` (AppLayout is already Tailwind — minor polish only)
- `src/components/shell/Sidebar.tsx`, `Topbar.tsx`, `NotificationBell.tsx`, `LanguageSwitcher.tsx`
- `src/components/ui/**` (the whole shared kit — port behind identical props)
- `src/components/feedback/ConfirmDialog.tsx`; `ToastProvider.tsx` internals **only at Stage 4** (`useToast` API frozen)
- `src/components/form/FormAlert.tsx`, `PasswordTextField.tsx` (RHF contracts frozen)
- All 5 auth pages; ProfilePage; DashboardPage + `components/dashboard/**` (chart *config* logic frozen, wrappers/tooltip DOM portable)
- `components/reports/**`, `components/trips/{TripSummary,TripTimeline}.tsx` + SpeedGraph tooltip, `components/commands/**`, `components/alarms/{AlarmList,AlarmTimeline,AlarmMap,AlarmDetailDrawer,AlarmStatusBadge}.tsx`, `components/geofences/{GeofenceFormDialog,GeofencePreviewMap}.tsx` (GeofenceDrawMap gesture logic frozen — only its dialog chrome ports)
- `components/map/{DeviceListPanel,DevicePopup,MapToolbar,PlaybackControls,RoutePlannerDialog}.tsx` (FleetMap internals: only container sizing)
- `components/video/{VideoTile,WallGrid,WallToolbar,ChannelDock}.tsx`
- `components/assets/**`, `components/admin/**` (Stage 3 tail — REBUILD tier)
- `src/pages/**` all 19 + inline 404 markup
- `src/theme/palette.ts` — may be *extended* as the shared token source (values frozen); `theme.ts`/`dark.theme.ts`/`rtl.ts`/`ThemeRegistry.tsx` only at Stage 4
- `src/styles/tailwind.css`, `src/styles/global.css` — additive changes anytime; preflight flip only at Stage 4
- Unit/e2e specs — **only** the 7 selector couplings in §10.3, in the same PR as their component

---

## 16. Recommended target architecture

Proposed end-state (do **not** create yet — Phase 2+ implements incrementally; current paths keep working throughout via re-exports/moves that don't change behavior):

```
apps/web-dashboard/src/
├── app/                        # app entry composition (App.tsx, providers, router bootstrap)
├── layouts/                    # AppLayout (TailAdmin shell + full-bleed variant), AuthLayout
├── components/
│   ├── ui/                     # tailwind-ui primitives (Button, Card, Badge, Input, Select,
│   │                           #   Dialog, Drawer, Table/DataTable, Tabs, Toggle, Menu, Tooltip,
│   │                           #   Skeleton, Spinner, Alert, Avatar, StatusBadge, …)
│   ├── layout/                 # Sidebar, Topbar, NotificationBell, Breadcrumb, PageHeader
│   ├── maps/                   # FleetMap, markers, clustering, playback controls, geofence draw
│   ├── charts/                 # EChart wrapper, KpiCard/StatCard charts, SpeedGraph
│   ├── video/                  # LiveVideoPlayer, tiles, wall grid, channel dock
│   └── feedback/               # ToastProvider (non-MUI), ConfirmDialog, ErrorState, EmptyState
├── features/                   # feature-sliced: pages + their private components/hooks colocated
│   ├── dashboard/
│   ├── fleet/                  # summary/KPIs
│   ├── tracking/               # MapPage, TripsPage, TripDetail, playback
│   ├── geofences/
│   ├── monitoring/             # AlarmCenter, NotificationCenter (+ realtime hooks wrappers)
│   ├── video/                  # VideoWall composition
│   ├── reports/
│   ├── maintenance/            # placeholder
│   ├── assets/                 # fleets/vehicles/devices registry
│   ├── admin/                  # users/roles/permissions/settings/audit
│   └── auth/                   # login/register/reset/mfa pages (UI only; logic stays in src/auth)
├── services/                   # api clients (from src/api), query-client, query-keys, realtime sockets
├── hooks/                      # cross-feature hooks
├── router/                     # route tree (unchanged paths), guards
├── theme/                      # palette tokens + Tailwind theme wiring (MUI files deleted post-cutover)
├── i18n/ · types/ · lib/ · mock/ · styles/
```

**Principles carried into Phase 2:**
1. `tailwind-ui` barrel is the single presentation entry point (its stated intent).
2. Feature folders own their pages + private components; shared pieces graduate to `components/*`.
3. `services/` (API) and `src/auth` logic remain exactly where behavior lives today — moves are re-export shims, never rewrites.
4. Dark mode = `.dark` class + `palette.ts`/`@theme` shared tokens; RTL = logical utilities + `dir` on `<html>`; no runtime CSS-in-JS post-cutover.
5. Every route's `data-testid`s and semantic roles are part of the public contract — tests gate each migration PR.

---

## Appendix A — Audit method & verification

- Full-tree inspection of `apps/web-dashboard/src` (216 files) + `e2e/` + configs (`package.json`, `vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts`, `Dockerfile`, `nginx.conf`, CI workflow).
- Mechanical counts verified by grep: 97 `@mui/*` imports (93 `@mui/material` in 90 non-test tsx files), 647 `sx` across 85 files, 0 `styled()`, 0 `@mui/icons-material` imports, 108 lucide icons in 59 files, 28 `--mui-palette-*` refs.
- Test counts: 192 unit cases (24 files, per-file `it/test` sum), 12 e2e cases (5 specs).
- Prior art consulted: `docs/frontend-audit.md` (2026-08-08), `docs/frontend-theme-migration.md` (Limitless reskin).

## Appendix B — Quick metrics (terminal summary)

```
files inspected ............ 216 src/e2e + 10 configs
pages found ................ 19 (+1 inline 404) → KEEP 1 · MIGRATE 16 · REBUILD 3
component files ............ ~92 (tailwind-ui kit: 8 staged, 0 consumers)
MUI dependency count ....... 97 imports / ~92 files / 57 runtime components / 647 sx props
zustand stores ............. 1 (auth) · react-query domains: 9
api modules ................ 15 → 8 backend services + 2 WS channels
unit tests ................. 192 (24 files; 14 logic / 9 dom / 2 mixed)
e2e tests .................. 12 (5 files; 7 UI-lib-coupled selectors total)
coverage ................... not configured (Stage-0 prerequisite)
```
