# FleetVision Frontend — Limitless-Inspired Theme Migration

This documents the v3 redesign of the `@fleetvision/web-dashboard` React frontend to
adopt the visual language of the **Limitless** admin template (default Layout 1),
while preserving 100% of FleetVision's existing architecture, routes, domain models,
API contracts, and business logic.

**Reference:** <http://limitless-layout-default.laravel.themesbrand.com/index>

This is a **UI/UX transformation**, not an application rewrite. No functionality was
removed or faked.

---

## 1. Existing architecture preserved

The redesign touched only the **design/presentation layer**. Everything below is
unchanged in behavior:

| Layer | Status |
|---|---|
| **Routing** (`src/router/index.tsx`) | ✅ All routes intact; same path structure |
| **Authentication** (`src/auth/*`, `ProtectedRoute`) | ✅ Unchanged |
| **API layer** (`src/api/*`, axios client, React Query keys) | ✅ Unchanged |
| **State management** (Zustand auth store, React Query, hooks) | ✅ Unchanged |
| **Realtime** (`useRealtimeSocket`, `useAlarmRealtime`, `useLiveTracking`) | ✅ Unchanged |
| **Maps** (MapLibre, clustering, markers, trip replay) | ✅ Unchanged |
| **Video** (WebRTC stream sessions, wall rotation, tiles) | ✅ Unchanged |
| **Forms & validation** (react-hook-form + zod) | ✅ Unchanged |
| **i18n** (react-i18next, en/fa locales) | ✅ Extended (new keys), none removed |
| **Types** (`src/types/*`), **Mock data** (`src/mock/*`) | ✅ Unchanged |
| **Tests** (`src/__tests__/*`) | ✅ 107/107 passing |

The provider hierarchy (`ThemeRegistry → AuthProvider → QueryClientProvider →
RouterProvider`) and the Emotion RTL cache mechanism (`src/theme/rtl.ts`) are
unchanged.

---

## 2. New design system (Limitless-inspired)

### 2.1 Design tokens — `src/theme/palette.ts`

Adopted the Limitless **Material-derived** system palette so the UI reads
"Limitless", while FleetVision identity is carried by the brand mark + domain UX.

| Token | Value | Limitless basis |
|---|---|---|
| Primary | `#2196F3` (Material Blue 500) | Limitless primary |
| Success | `#4CAF50` | Material Green 500 |
| Danger | `#F44336` | Material Red 500 |
| Warning | `#FF5722` | Limitless deep-orange |
| Info | `#00BCD4` | Material Cyan 500 |
| Secondary | `#3F51B5` (Indigo) | Limitless indigo |
| Slate | `#607D8B` | Material Blue Grey 500 |
| Body text | `#333333` | Bootstrap/Limitless body |
| Muted text | `#777777` | Limitless muted |
| Borders | `#EEEEEE` / `#DDDDDD` | Limitless neutrals |
| Table head border | `#B7B7B7` | Limitless table head |
| Page bg (light) | `#F5F5F5` | Limitless Layout 1 content |
| Card (light) | `#FFFFFF` | Limitless card |
| **Sidebar** | `#263238` (Blue Grey 900) | **Signature Limitless dark sidebar** |

The dark slate sidebar (`palette.ts → sidebar`) stays **constant across light and
dark modes** — the recognizable Limitless Layout 1 silhouette. Legacy palette
aliases (`status.green/amber/red/blue`, `primary.gradient`) are preserved so the
many existing color-helper maps keep working.

### 2.2 Typography

- **Roboto** is the base font (loaded via Google Fonts in `index.html`), with
  **Vazirmatn** for Persian (`[dir="rtl"]` in `global.css`).
- **13px (0.8125rem)** dense body text — the Limitless signature density.
- Heading scale h1–h6 ≈ 25/23/21/19/17/15px at weight 500–600 (Limitless favors
  medium headings, not heavy bold).
- Uppercase 12px tracked labels (`overline`) for section/card group headers.

### 2.3 Shape & elevation

- **3px border radius** on cards, inputs, buttons, menus, dialogs — Limitless's
  crisp, slightly-technical house radius.
- **100px pill radius** for badges/chips/rounded controls.
- Cards are **near-flat** (`0 1px 2px rgba(0,0,0,0.05)`); elevation is opt-in for
  drawers/popovers/dialogs.

### 2.4 Shared UI primitives — `src/components/ui/`

A thin design-system layer (no duplicate concepts; existing components adapted):

| Primitive | Purpose |
|---|---|
| `Panel` | Limitless card with optional header (title + icon + actions + live badge + divider) |
| `PageHeader` | Page title + subtitle + right-aligned actions + optional breadcrumb |
| `Breadcrumb` | Limitless breadcrumb (home + chevron trail, RTL-mirrored separator) |
| `SectionLabel` | Uppercase tracked group label (sidebar + card groups) |
| `StatusBadge` | Unified pill badge — solid / soft / outlined — accepts raw color (wraps existing `*StatusColor` maps) or semantic tone |
| `DataTable` | One consistent table pattern: sticky header, hover, selection, loading skeleton, empty state |
| `Toolbar` | Limitless filter/action row with optional built-in search |
| `EmptyState` | Icon + title + description placeholder |

Barrel export: `src/components/ui/index.ts`.

---

## 3. Theme changes — `src/theme/`

### 3.1 `theme.ts` (light) & `dark.theme.ts`

Both rebuilt to the Limitless system: dense Roboto typography, 3px corners,
near-flat cards, Material status colors, uppercase tracked table headers with a
`#B7B7B7` bottom rule, hover/selection row states, pill chips, underline tabs,
3px inputs with `#ced4da`-family borders.

### 3.2 `ThemeRegistry.tsx`

- **Default color mode changed from `dark` → `light`** — the Limitless Layout 1
  reference is a light UI. Dark mode remains fully supported via the toggle and
  is persisted to `localStorage` as before.
- Emotion RTL cache + `<html dir>` sync logic unchanged.

### 3.3 `styles/global.css`

Roboto + Vazirmatn font stacks (RTL branch), tuned scrollbars/selection, retained
keyframes (`fv-pulse`, `fv-fade-in`), and the RTL breadcrumb chevron mirror
(`html[dir="rtl"] .fv-breadcrumb .fv-breadcrumb-sep { transform: scaleX(-1) }`).

### 3.4 `index.html`

Google Fonts link now loads **Roboto** (300/400/500/700) + **Vazirmatn**
(300/400/500/700) + JetBrains Mono.

---

## 4. Layout / shell changes — `src/layouts/` + `src/components/shell/`

### 4.1 `AppLayout.tsx` (rewritten)

Composes `Sidebar` + `Topbar` + content area. Content padding is **20px** (Limitless)
exposed as `PAGE_PADDING`; full-bleed pages (Map, Video Wall) neutralize it via
`margin: -2.5` (replacing the old `m: -3` contract).

### 4.2 New: `components/shell/Sidebar.tsx`

The signature Limitless **dark slate** (`#263238`) navigation drawer:
- **270px expanded / 64px collapsed** (mini icons + tooltips).
- Brand mark (blue→indigo gradient + truck + "FleetVision") at the top.
- **Grouped navigation** with uppercase section labels on a darker strip
  (`palette.sidebar.groupBg`).
- Nav rows: icon + label, **active = left accent bar + tinted background**,
  hover lift; `0.15s ease-in-out` transitions (Limitless cadence).
- **Mobile (< lg):** temporary off-canvas drawer (overlay); **desktop (≥ lg):**
  permanent. Collapse toggle direction flips in RTL.

### 4.3 New: `components/shell/nav.config.tsx`

Limitless-style **grouped IA** (only existing routes exposed — no fake pages):
Dashboard · **Tracking** (Map, Trips) · **Video** (Video Wall) · **Operations**
(Alarms, Commands, Geofences) · **Assets** · **Reporting** (Reports) ·
**Maintenance** · **Administration** (Admin). Legacy `/vehicles` & `/drivers`
redirect to `/assets`, so they're omitted from the sidebar. Includes
`filterNavByPermissions()` for RBAC (non-breaking — items without a permission
always show, preserving today's behavior).

### 4.4 New: `components/shell/Topbar.tsx`

Limitless Layout 1 **50px top navbar**: mobile hamburger + pill global search
(left); notifications bell with badge → `/alarms`, help, theme toggle,
`LanguageSwitcher`, user dropdown with email + tenant (right). Logo lives in the
sidebar per Limitless L1.

### 4.5 `AuthLayout.tsx`

Branded split panel retained but retuned to the navy/slate Limitless dark family
(`#1A2733 → #263238 → #37474F`); feature pills use the new primary tint. Form
panel reads as Limitless (clean light surface, 3px cards). RTL-safe via logical
properties.

---

## 5. Component changes

| Component | Change |
|---|---|
| `dashboard/WidgetCard` | Weight-700 header, 20px body, near-flat 3px card (theme-driven) |
| `dashboard/StatCard` | Uppercase tracked label, weight-700 tabular value, refined sparkline |
| `dashboard/DashboardGrid` | `PageHeader` with live badge + export action |
| `assets/VehiclesTab` | `Toolbar` + unified `StatusBadge` (was ad-hoc Chip) |
| `assets/DriversTab` / `DevicesTab` | Unified `StatusBadge` |
| `assets/AssetDetailDrawers` | Drawer badges → `StatusBadge` |
| `admin/UsersSection` | `Toolbar` + unified `StatusBadge` |
| `reports/ReportJobsSection` | Unified `StatusBadge` |
| `common/ErrorState` / `UpcomingFeature` | Restyled via theme (3px, near-flat) |

---

## 6. Pages redesigned

Every page now uses the `PageHeader` primitive (title + subtitle + actions) so they
share one rhythm. Breadcrumbs are reserved for detail/sub-pages (e.g. Trip Detail)
to avoid duplicating the title on top-level sections.

| Page | Route | Key changes |
|---|---|---|
| Dashboard | `/dashboard` | `PageHeader`, restyled StatCards/widgets |
| Live Map | `/map` | `m:-2.5` full-bleed (was `m:-3`); restyled toolbar/list |
| Trips | `/trips` | `DataTable` + `Toolbar` + `StatusBadge` |
| Trip Detail | `/trips/:id` | `PageHeader`-style back + header (logic intact) |
| Video Wall | `/video` | Full-bleed preserved; restyled toolbar/dock via theme |
| Alarm Center | `/alarms` | `PageHeader` with live badge + stat chips |
| Assets | `/assets` | `PageHeader` + tabbed tables unified on `StatusBadge` |
| Reports | `/reports` | `PageHeader` + section tabs (KPI cards/charts restyled) |
| Admin | `/admin` | `PageHeader` + unified users table |
| Profile | `/account/profile` | `PageHeader` + restyled identity/roles/security cards |
| Geofences | `/geofences` | `PageHeader` with create action |
| Commands / Maintenance | `/commands`, `/maintenance` | Restyled `UpcomingFeature` via theme |
| Login / Register / Forgot / Reset / MFA | `/login`, etc. | Restyled via theme (3px cards, Material inputs) |

All query/filter/drawer/URL-sync logic is **verbatim**.

---

## 7. RTL / Persian changes

- All new shell code uses **logical CSS properties** (`borderInlineEnd`,
  `borderInlineStart`, `insetInlineStart`, `paddingInline`, `marginInline`) so the
  sidebar border, active accent bar, map device-list border, and admin nav border
  flip correctly in RTL.
- Sidebar collapse chevron direction branches on `theme.direction`.
- Breadcrumb separator is mirrored via `html[dir="rtl"]` CSS
  (`transform: scaleX(-1)`).
- Vazirmatn font stack applied for `[dir="rtl"]`.
- The Emotion `stylis-plugin-rtl` cache (per-direction) is unchanged and continues
  to mirror logical properties globally.

## 8. Dark mode changes

- Default is now **light**, but dark mode is fully restyled to the same system
  (layered slate surfaces `#1F2730/#2A333D/#323D48`, lighter Material accents for
  contrast, matching 3px radius and dense type).
- Every new surface (`Panel`, `Sidebar`, `Topbar`, `StatusBadge`, tables) has a
  deliberate dark variant — no inverted-random colors.

## 9. Responsive changes

- Sidebar: **off-canvas drawer below `lg`** (~992px+), permanent at/above `lg`.
  Hamburger appears in the Topbar below `lg`; collapse toggle above.
- Dashboard grids, card grids, and tables collapse cleanly to one column on `xs`.
- Map and Video Wall remain full-bleed and usable on all sizes.

---

## 10. Validation results

| Command | Result |
|---|---|
| `pnpm --filter @fleetvision/web-dashboard typecheck` | ✅ 0 errors |
| `pnpm test:web` | ✅ 107/107 tests pass (14 files) |
| `pnpm build:web` | ✅ Builds successfully |
| `pnpm lint` | ✅ 0 web-dashboard rule diagnostics (repo-wide CRLF formatter notices + 3 pre-existing media-service warnings are unrelated to this change) |

---

## 11. Known limitations

- **Sidebar collapse is desktop-only.** On mobile the sidebar is always a full
  off-canvas drawer (no mini mode) — standard for the breakpoint.
- **Global search** in the Topbar is presentational (no command-palette wiring)
  — matching the prior shell, which also had a non-functional search input.
- **Nav RBAC** is wired (`filterNavByPermissions`) but no nav item currently
  declares a `permission`, so behavior matches the pre-redesign shell (all items
  visible). Adding `permission` fields to `nav.config.tsx` items will activate
  hiding per the principal's permissions.
- **MapLibre/Video controls** are third-party widgets styled by their own CSS;
  they adopt the app palette where MUI wraps them but are not fully re-skinned.
- The production bundle chunk-size warning is pre-existing (large map/chart
  deps); no code-splitting was added in this UI-only change.
- The Limitless Laravel demo site itself had an invalid TLS cert during research,
  so the design-language values were verified against the identical SCSS core of
  the original Limitless kit and the Themesbrand docs.
