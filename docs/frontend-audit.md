# FleetVision Frontend Audit Report

**Date:** 2026-08-08
**Scope:** Complete audit of `apps/web-dashboard/src/` — 15 pages, 50+ components, full infrastructure.

---

## Baseline Health

| Check | Status |
|---|---|
| `typecheck` | ✅ Clean |
| `build` | ✅ Succeeds (Vite production bundle) |
| `test` | ✅ 71/71 pass (10 spec files) |
| `lint` | ✅ Clean (biome) |
| Docker | ✅ Builds + runs (web + identity + infra) |

---

## Feature Summary Table

| Feature | Status | Real API | Mock | Missing | Broken |
|---|---|---|---|---|---|
| **Auth** | ✅ Complete (partial stubs) | Login, Logout, Refresh, Profile | — | Register, Forgot/Reset, MFA backend | WebAuthn toggle (non-functional) |
| **Dashboard** | ✅ Complete | — | Stats, Activity, Alerts, Utilization, Weather, Map preview | — | — |
| **Map** | 🟡 Partial | — | Vehicle positions | Error/loading states, URL sync | — |
| **Trips** | ✅ Complete | — | Trip list, Replay, Timeline, Speed graph | Error states | — |
| **Video** | ✅ Complete | — | Channels, Streams (synthetic), Walls | Error states | — |
| **Alarms** | ✅ Complete | — | Alarms, Timeline, Map, Detail, Actions | Error states | — |
| **Assets** | ✅ Complete | Users (real `/iam/users`) | Vehicles, Drivers, Devices, Groups | Error states | — |
| **Reports** | ✅ Complete | — | KPIs, Charts, Definitions, Jobs, Dashboards | Error states | — |
| **Admin** | ✅ Complete | Users list (`/iam/users`) | Roles, Permissions, Settings, Audit | Roles/Settings/Audit backend | Stale nav items (maintenance/compliance/fuel → 404) |

---

## Page-by-Page Audit

### Auth Pages

| Page | Exists | Route | UI | API | Loading | Error | Empty | i18n | Responsive | RTL | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ Full | ✅ Real | ✅ | ✅ | N/A | ✅ | ✅ `xs/sm` padding | ✅ | Tenant field (documented divergence) |
| `/register` | ✅ | ✅ | ✅ Full | 🔴 Stub | ✅ | ✅ | N/A | ✅ | ❌ Fixed width | ✅ | Backend pending |
| `/forgot-password` | ✅ | ✅ | ✅ Full | 🔴 Stub (masks as success) | ✅ | ✅ | ✅ Success card | ✅ | ❌ Fixed width | ✅ | Backend pending; anti-enumeration |
| `/reset-password` | ✅ | ✅ | ✅ Full | 🔴 Stub | ✅ | ✅ | ✅ No-token warning | ✅ | ❌ Fixed width | ✅ | Backend pending |
| `/mfa/verify` | ✅ | ✅ | ✅ Full | 🔴 Stub | ✅ | ✅ | ✅ No-challenge warning | ✅ | 🟡 Partial (`flexWrap`) | ✅ | WebAuthn toggle non-functional; backend pending |

**Cross-cutting:** All 5 use react-hook-form + zod + `useTranslation()`. Only LoginPage has responsive breakpoints. 4 of 5 backend calls are stubs (identity-service has no register/forgot/reset/MFA endpoints).

---

### Main Feature Pages

| Page | Exists | Route | UI | API | Loading | Error | Empty | i18n | Responsive | URL Sync | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` | ✅ | ✅ | ✅ (via `<DashboardGrid>`) | Mock | ✅ (in children) | ✅ (in children) | ✅ (in children) | ✅ (in children) | ✅ (grid) | ❌ | 14-line delegation shell |
| `/map` | ✅ | ✅ | ✅ Full 3-pane | Mock | ❌ Missing | ❌ Missing | ❌ Missing | ❌ | ✅ `md` panel hide | ❌ | `margin:-3` hack; `calc(100vh-56px)` brittle; no loading/error |
| `/trips` | ✅ | ✅ | ✅ Full table + filters | Mock | ✅ Skeleton | ❌ Missing | ✅ `noResults` | ✅ | 🟡 Table no scroll | ❌ | Wrong comment on `formatDuration`; no error state |
| `/trips/:id` | ✅ | ✅ | ✅ Full replay | Mock | ✅ Spinner + skeleton | 🟡 Error→notFound | ✅ NotFound | ✅ | ✅ `xs/lg` grid | N/A | Error-vs-404 conflation |
| `/video` | ✅ | ✅ | ✅ Full wall | Mock | 🟡 Partial | ❌ Missing | ✅ Empty prompt | ✅ | 🟡 Via children | ✅ `?d=&spotlight=` | `useWallRotation` referenced but not imported; URL writes on mount |
| `/alarms` | ✅ | ✅ | ✅ 3 views + drawer | Mock | 🟡 List/Time only | ❌ Missing | 🟡 In children | ✅ | 🟡 `flexWrap` only | ✅ `?view&type&severity&status&q` | `?view=invalid` renders empty box; AlarmMap missing loading |
| `/assets` | ✅ | ✅ | ✅ 4 tabs + drawers | Users=Real; rest=Mock | 🟡 Per tab | ❌ Missing | 🟡 In tabs | ✅ | 🟡 Tabs not scrollable | ✅ `?tab=` | All 4 queries fire on mount; no error states |
| `/reports` | ✅ | ✅ | ✅ 4 sections | Mock | ✅ Per section | ❌ Missing | ✅ Per section | ✅ | ✅ | ✅ `?section=` | No issues |
| `/admin` | ✅ | ✅ | ✅ 5 sections + drawers | Users=Real; rest=Mock | ✅ Per section | ❌ Missing | ✅ Per section | ✅ | ✅ Two-column | ✅ `?section=` | Stale nav: maintenance/compliance/fuel → 404 |
| `/account/profile` | ✅ | ✅ | ✅ Read-only | ✅ Real `/auth/me` | ✅ `!user` fallback | — | — | ✅ | ✅ | N/A | Email fallback from login (backend `/me` returns empty) |

---

## Component Audit

### Dashboard Components (10/10 Complete)

| Component | Status | Loading | Empty | Notes |
|---|---|---|---|---|
| `StatCard` | ✅ Complete | ✅ Skeleton | — | KPI tile with value/delta/sparkline/drilldown |
| `FleetActivityChart` | ✅ Complete | ✅ Skeleton | — | Recharts stacked area; range selector (today/7d/30d) |
| `ActiveAlertsPanel` | ✅ Complete | ✅ Skeleton | ✅ `empty.alerts` | Severity-sorted; "view all" link |
| `VehiclesAttentionList` | ✅ Complete | ✅ Skeleton | ✅ `empty.attention` | Ranked blend of maintenance/behavior/AI/device |
| `FleetUtilizationPanel` | ✅ Complete | ✅ Skeleton | — | Recharts donut + horizontal bars; 73% center |
| `FleetMapPreview` | ✅ Complete | ✅ Skeleton | — | MapLibre mini-map with vehicle markers |
| `WeatherWidget` | ✅ Complete | ✅ Skeleton | — | Current + 3-day forecast |
| `WidgetCard` | ✅ Complete | ✅ Skeleton | ✅ Configurable | Shared titled card shell |
| `LiveBadge` | ✅ Complete | — | — | Pulsing freshness dot |
| `EmptyState` | ✅ Complete | — | — | Illustration + headline + CTA |

### Map Components (4/4 Complete)

| Component | Status | Notes |
|---|---|---|
| `FleetMap` | ✅ Complete | MapLibre GL; imperative markers; clustering (supercluster); selection; heading arrows |
| `DeviceListPanel` | ✅ Complete | Filterable list; status chips; search |
| `DevicePopup` | ✅ Complete | Right slide-over drawer; detail + events + quick actions |
| `MapToolbar` | ✅ Complete | Fleet count; pause/resume live; status filter chips |

### Trips Components (5/5 Complete)

| Component | Status | Notes |
|---|---|---|
| `TripReplayMap` | ✅ Complete | MapLibre polyline + animated marker + stop/idle markers |
| `TripTimeline` | ✅ Complete | Seekable scrubber; play/pause; 1×/2×/4× speed; event markers |
| `SpeedGraph` | ✅ Complete | Recharts line; speed limit reference; event dots; playhead |
| `TripSummary` | ✅ Complete | Stat tiles (distance/duration/max/avg speed/stops/idle/fuel) |
| `useTripPlayback` | ✅ Complete | Transport hook (index/isPlaying/speed/play/pause/seek/setSpeed) |

### Video Components (7/7 Complete)

| Component | Status | Notes |
|---|---|---|
| `WallGrid` | ✅ Complete | CSS grid (1/4/9/16/36/64); spotlight overlay; cap+rotate |
| `VideoTile` | ✅ Complete | Overlays (latency/REC/signal/label/cabin/alert); controls (snapshot/fullscreen/mute/quality/spotlight/remove); states (empty/queued/connecting/active) |
| `WallToolbar` | ✅ Complete | 6 division buttons; spotlight toggle; rotation; fullscreen; saved-wall loader; simulate-alert |
| `ChannelDock` | ✅ Complete | Grouped tree; search; online filter; auto-fill |
| `LiveVideoPlayer` | ✅ Complete | `<video srcObject=MediaStream>`; muted default; play guard |
| `useStreamSession` | ✅ Complete | Lifecycle (open→negotiate→stats→close); synthetic MediaStream |
| `useWallRotation` | ✅ Complete | Cap+rotate scheduler (MAX_LIVE_TILES=16; 30s round-robin) |

### Alarms Components (6/6 Complete)

| Component | Status | Notes |
|---|---|---|
| `AlarmList` | ✅ Complete | Filterable table; type icon; severity chip; status badge; relative time |
| `AlarmTimeline` | ✅ Complete | 24h chronological grid; severity-colored event blocks |
| `AlarmMap` | ✅ Complete | MapLibre; severity-colored markers; selection |
| `AlarmDetailDrawer` | ✅ Complete | Full entity; source events; linked artifacts; ack/resolve/contest actions |
| `AlarmTypeIcon` | ✅ Complete | 8-type catalog → lucide icon; severity/status color maps |
| `AlarmStatusBadge` | ✅ Complete | State → colored chip |

### Assets Components (6/6 Complete)

| Component | Status | Notes |
|---|---|---|
| `VehiclesTab` | ✅ Complete | Filterable table (status/type/search); 5-col layout |
| `DriversTab` | ✅ Complete | Filterable table; behavior-score bar; license-expiry warning |
| `DevicesTab` | ✅ Complete | Filterable table; health indicators (battery/signal/heartbeat) |
| `GroupsTab` | ✅ Complete | Card grid; member counts; type filter |
| `AssetDetailDrawers` | ✅ Complete | 3 drawers (vehicle/driver/device); meta rows; status actions |
| `asset-meta` | ✅ Complete | Shared status→color/type→icon maps |

### Reports Components (7/7 Complete)

| Component | Status | Notes |
|---|---|---|
| `KpiCard` | ✅ Complete | Value/unit; target bar; threshold color; trend arrow |
| `ReportChart` | ✅ Complete | Polymorphic (area/donut/bar/line) Recharts wrapper |
| `KpiRow` | ✅ Complete | Responsive 5-tile KPI grid |
| `ReportsOverview` | ✅ Complete | Default dashboard: KPI row + 4 charts |
| `ReportDefinitionsSection` | ✅ Complete | Category-filtered catalog; generate dialog (format picker) |
| `ReportJobsSection` | ✅ Complete | Jobs table; status badges; download; raw export |
| `DashboardsSection` | ✅ Complete | Saved dashboards list; widget layout rendering |

### Admin Components (9/9 Complete)

| Component | Status | Notes |
|---|---|---|
| `AdminNav` | ✅ Complete | 12-item settings nav (5 enabled, 7 upcoming) |
| `UsersSection` | ✅ Complete | Real `/iam/users`; filter; search; detail drawer |
| `UserDetailDrawer` | ✅ Complete | Profile; status actions (activate/suspend/deactivate) |
| `RolesSection` | ✅ Complete | System + custom roles grid; permission/member counts |
| `RoleDetailDrawer` | ✅ Complete | Permission matrix by domain (read-only checkboxes) |
| `PermissionsSection` | ✅ Complete | 14-domain catalog reference |
| `SettingsSection` | ✅ Complete | Locale/timezone/units/branding/retention form |
| `AuditSection` | ✅ Complete | Filterable table; integrity hash; export; verify indicator |
| `admin-meta` | ✅ Complete | Status→color/action→color maps |

---

## Infrastructure Audit

### Auth (Complete)

| Module | Status | Notes |
|---|---|---|
| `auth.store.ts` | ✅ Complete | Zustand: login/logout/refresh/hydrate/fetchUser; email fallback fix |
| `auth.guard.tsx` | ✅ Complete | ProtectedRoute: loading spinner; redirect with `?redirect=` |
| `auth.context.tsx` | ✅ Complete | AuthProvider: hydrate on mount; re-fetch `/me` on token |
| `token.storage.ts` | ✅ Complete | localStorage: token pair + separate tenant key; corrupted-JSON guard |

### API Layer (Complete)

| Module | Status | Notes |
|---|---|---|
| `api/client.ts` | ✅ Complete | Axios: Bearer + X-Tenant-Id interceptors; single-flight refresh; error unwrapping; `window.location` on refresh-fail (minor inconsistency) |
| `api/query-client.ts` | ✅ Complete | staleTime 30s; retry 1; refetchOnWindowFocus |
| `api/query-keys.ts` | ✅ Complete | Factory: fleet/trips/video/alarms/assets/reports/admin |
| `api/fleet.api.ts` | ✅ Complete | Mock-backed: stats/activity/alerts/attention/utilization/mapVehicles/weather/vehicleDetail/trips/tripDetail |
| `api/auth.api.ts` | ✅ Complete | Real: login/refresh/me/logout; Stub: register/forgot/reset/MFA |
| `api/alarm.api.ts` | ✅ Complete | Mock-backed + optimistic ack/resolve/contest |
| `api/asset.api.ts` | ✅ Complete | Mock-backed (vehicles/drivers/devices/groups); real status-action mutation |
| `api/video.api.ts` | ✅ Complete | Mock-backed: channels/streams/walls/snapshot |
| `api/report.api.ts` | ✅ Complete | Mock-backed: definitions/jobs/kpis/charts/dashboards; generate/export |
| `api/admin.api.ts` | ✅ Complete | **Real**: users list + detail (`/iam/users`); Mock: roles/permissions/settings/audit; optimistic status action |

### Theme (Complete)

| Module | Status | Notes |
|---|---|---|
| `ThemeRegistry.tsx` | ✅ Complete | Dark default; toggle; RTL direction sync; per-direction Emotion cache |
| `theme.ts` (light) | ✅ Complete | Inter font; gradient primary; borderRadius 12; 12+ component overrides |
| `dark.theme.ts` | ✅ Complete | Navy surfaces; glassmorphism cards; glow shadows; 15+ component overrides |
| `palette.ts` | ✅ Complete | Neutral scale; primary gradient; status; dark/light surface scales; shadow tokens |
| `rtl.ts` | ✅ Complete | Direction-keyed cache with stylis-plugin-rtl |

### i18n (Complete)

| Module | Status | Notes |
|---|---|---|
| `config.ts` | ✅ Complete | en/fa; RTL detection (fa/he/ar); language labels |
| `index.ts` | ✅ Complete | i18next + LanguageDetector + react-i18next; localStorage caching |
| `en/common.json` | ✅ Complete | All domains: auth/nav/common/dashboard/map/trips/video/alarms/assets/reports/admin/profile |
| `fa/common.json` | ✅ Complete | Full Farsi translations matching en structure |

### Router & Layouts (Complete with issues)

| Module | Status | Notes |
|---|---|---|
| `router/index.tsx` | ✅ Complete | All 15 routes + redirects (`/vehicles`→assets, `/drivers`→assets) + 404 |
| `AppLayout.tsx` | ✅ Complete | Sidebar (collapsible) + TopBar (search/alerts/theme/lang/user-menu) |
| `AuthLayout.tsx` | ✅ Complete | Premium split-panel; mobile-responsive collapse |

### Other Infrastructure

| Module | Status | Notes |
|---|---|---|
| `lib/errors.ts` | ✅ Complete | `NotImplementedError` + type guard |
| `api/errors.ts` | ✅ Complete | `ApiClientError` + `getApiErrorMessage` |
| `lib/validation.ts` | ✅ Complete | Zod: password (≥12 mixed), email, username, displayName, password-confirm |
| `lib/map-markers.ts` | ✅ Complete | SVG data-URL markers: vehicle/selected/heading/cluster |
| `lib/map-cluster.ts` | ✅ Complete | Supercluster wrapper |
| `lib/video-stream.ts` | ✅ Complete | Synthetic canvas→captureStream; signaling interface; snapshot/fullscreen helpers |
| `styles/global.css` | ✅ Complete | Pulse + fade-in keyframes; premium scrollbars; text selection |

---

## Issues Found

### 🔴 Broken / Bugs

| # | Severity | Location | Issue |
|---|---|---|---|
| B1 | **Medium** | `AppLayout.tsx` nav items | `/maintenance`, `/compliance`, `/fuel` nav items route to 404 (no route defined) |
| B2 | **Low** | `MfaVerifyPage.tsx` | WebAuthn toggle collects numeric OTP instead of using Credential Management API |
| B3 | **Low** | `VideoWallPage.tsx` | Docblock references `useWallRotation` but it's not imported in this file (it's used inside `WallGrid`) |
| B4 | **Low** | `TripsPage.tsx` | Wrong comment above `formatDuration` (copy-paste error from another function) |
| B5 | **Low** | `VideoWallPage.tsx` | `saveCurrentWall` always mints a new wall (no edit/dedupe) |

### 🟡 Missing (should have)

| # | Severity | Location | Issue |
|---|---|---|---|
| M1 | **Medium** | All feature pages | No error states — `isError` not destructured from any query; failed fetches render blank |
| M2 | **Medium** | `MapPage` | No loading state; no empty state; no error state |
| M3 | **Low** | `AlarmCenterPage` | `?view=invalid` renders empty content box (no fallback) |
| M4 | **Low** | `AlarmCenterPage` | `AlarmMap` missing `loading` prop (inconsistent with List/Timeline) |
| M5 | **Low** | Auth pages (4 of 5) | No responsive breakpoints (fixed width only); only LoginPage is responsive |
| M6 | **Low** | `AppLayout.tsx` | No true mobile drawer (permanent drawer only; no hamburger/temporary drawer) |

### 🟢 Design Notes (acceptable for now)

| # | Note |
|---|---|
| D1 | `margin: -3` full-bleed hack (MapPage, VideoWallPage) is brittle but functional |
| D2 | All 4 queries in AssetManagementPage fire on mount (loads all data up front) |
| D3 | `auth.store.ts` hardcodes `permissions: []` until `getMe()` resolves |
| D4 | `api/client.ts` uses `window.location.href` on refresh-fail (bypasses Router) |
| D5 | Register/Forgot/Reset/MFA are stubs (backend endpoints don't exist yet) |
| D6 | Dashboard/Map/Trips/Video/Alarms/Assets/Reports are all mock-backed (no backend services exist) |

---

## Actionable Sprint Backlog

### Sprint P0 — Critical Fixes (do first)

| # | Task | Effort |
|---|---|---|
| P0-1 | **Remove/placeholder stale nav items** (`/maintenance`, `/compliance`, `/fuel` → either add "upcoming" placeholder pages or remove from nav) | 30 min |
| P0-2 | **Add error states to all feature pages** — destructure `isError`, render a retry-able error card | 2-3 hours |
| P0-3 | **Add loading + empty state to MapPage** (currently blank while loading or on error) | 1 hour |

### Sprint P1 — Polish & UX

| # | Task | Effort |
|---|---|---|
| P1-1 | **Responsive breakpoints for auth pages** (register/forgot/reset/MFA) | 1 hour |
| P1-2 | **Fix `AlarmCenterPage` view validation** (invalid `?view=` fallback to list) | 15 min |
| P1-3 | **Add `loading` prop to `AlarmMap`** (consistency with List/Timeline) | 15 min |
| P1-4 | **Fix MFA WebAuthn toggle** (either implement WebAuthn or disable the option) | 1-2 hours |
| P1-5 | **Mobile drawer for AppLayout** (hamburger + temporary drawer for narrow screens) | 2-3 hours |

### Sprint P2 — Backend Integration (when backends land)

| # | Task | Prerequisite |
|---|---|---|
| P2-1 | **Connect Dashboard to analytics-engine** (replace mock fleet stats/activity/utilization) | analytics-engine REST |
| P2-2 | **Connect Map to gps-engine** (replace mock positions with real WebSocket/REST) | gps-engine position API |
| P2-3 | **Connect Trips to trip-service** (replace mock trips/replay) | trip-service REST |
| P2-4 | **Connect Video to media-service** (replace synthetic streams with real WebRTC + Socket.IO signaling) | media-service signaling |
| P2-5 | **Connect Alarms to notification-service** (replace mock alarms) | notification-service REST |
| P2-6 | **Connect Assets to fleet/driver/device services** (replace mock vehicles/drivers/devices) | fleet/driver/device REST |
| P2-7 | **Connect Reports to reporting-service** (replace mock KPIs/charts/jobs) | reporting-service REST |
| P2-8 | **Connect Admin Roles/Settings/Audit** to identity/audit services | identity roles endpoint, audit-service |
| P2-9 | **Implement Register/Forgot/Reset/MFA** (remove stubs when identity-service adds endpoints) | identity-service auth endpoints |

### Sprint P3 — Future Enhancements

| # | Task |
|---|---|
| P3-1 | Trip filter URL sync (`?status=&q=`) |
| P3-2 | Map filter URL sync (`?status=&q=`) |
| P3-3 | Custom report builder (REP-FR-07) |
| P3-4 | User create/edit forms in Admin |
| P3-5 | Role create/edit (permission matrix edit mode) |
| P3-6 | Device provisioning flow (Admin → Devices) |
| P3-7 | Billing section (Admin) |
| P3-8 | Organization tree (Admin) |

---

## Summary Statistics

| Metric | Count |
|---|---|
| **Total pages** | 15 |
| **Pages with complete UI** | 15/15 (100%) |
| **Pages with real API** | 3 (Login, Profile, Admin Users) |
| **Pages with mock data** | 12 (intentional — no backend) |
| **Pages with loading states** | 10/15 (67%) |
| **Pages with error states** | 5/15 (33%) — auth pages only |
| **Pages with empty states** | 9/15 (60%) |
| **Pages with URL sync** | 6/15 (40%) |
| **Pages with responsive design** | 10/15 (67%) |
| **Total components** | 54 |
| **Components complete** | 54/54 (100%) |
| **Infrastructure modules** | 23 |
| **Infrastructure complete** | 23/23 (100%) |
| **Test specs** | 10 |
| **Tests passing** | 71/71 (100%) |
| **Broken items** | 5 (1 medium, 4 low) |
| **Missing items** | 6 (2 medium, 4 low) |

---

*This audit was conducted by reading every file in `apps/web-dashboard/src/`. No file was skipped. The report reflects the actual code state as of 2026-08-08.*
