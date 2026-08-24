# UI/UX Audit — FleetVision Web Dashboard (Baseline, BEFORE Redesign)

> **Audit date:** 2026-08-24 · **Scope:** `apps/web-dashboard` (React 19 + Vite + Tailwind CSS v4 + custom `tailwind-ui` kit)
> **Method:** full read of every page + design-system primitive + theme layer; three independent audit passes (dashboard/trips/reports, assets/admin/auth/alarms/events, map/MUI surface). No code was modified for this document.
> **Purpose:** this is the *before* picture. `UI_UX_REDESIGN_REPORT.md` records what changed against this baseline.

---

## 0. Executive summary

The Tailwind migration (phases 0–5) built a genuinely solid foundation: 26 primitives, logical-property RTL everywhere, full dark-mode pairs, per-card loading/empty triads on the dashboard. **But measured as a product, not a migration**, the app still has enterprise-quality gaps:

| # | Systemic problem | Where |
|---|---|---|
| 1 | **Errors masked as empty states** — failed queries render "no data" UI in 10+ surfaces | Trips, TripDetail, Admin (users/roles/permissions/audit), CommandCenter (3 queries), FleetHealthPanel, FleetComparisonChart, ReportsOverview distribution chart |
| 2 | **Three competing KPI tile systems** — `KpiTile` (rich) vs `TripSummary` (flat) vs `ReportsOverviewSection.Kpi` (raw div, no icon/tone) | values render at 3 different sizes |
| 3 | **Five hand-rolled segmented controls** — no `SegmentedControl` primitive | TrendChartsRow, TripsPage, TripTimeline, ReportsPage, MfaVerify, AlarmCenter view switcher (6th) |
| 4 | **Design-system bypasses** — hand-rolled filter bars duplicating `Toolbar`+`Select`, a hand-rolled 30-line drawer ignoring the shared `Drawer`, hand-rolled LoadMore, raw `<div>` cards | AlarmCenter, EventCenter, AlarmDetailDrawer, ReportsOverview |
| 5 | **MUI not fully removed** — `DeviceListPanel`, `MapSettingsPanel` + `MuiProvider` bridge + 7 deps + 58 lines of `.fv-dark-glass` MUI-override CSS | Map page |
| 6 | **Interaction honesty gaps** — mutations without confirm/toast (Admin user status, alarm transitions), a fake "Saved" button, settings mutating per keystroke | Admin |
| 7 | **Two parallel severity color systems** — semantic `Badge` tokens vs inline hex from `palette.ts` | all alarm components |
| 8 | **Four relative-time implementations** — two hardcoded English | DevicesTab, UsersSection, AlarmList, lib |
| 9 | **RTL defects** — timeline ticks positioned with physical `left:%`, un-flipped `ArrowLeft` back icons, `→` literals | TripTimeline, auth pages, TripDetail, ReportRangePicker |
| 10 | **404 is a 6-line throwaway** — hardcoded English, no action, no primitives | router |

**Strong points to preserve** (do not regress): dashboard hero + sectioned console anatomy; `DashboardCard` state triad; Assets page as the repo's gold standard; `KpiTile` honesty policy (null ≠ 0); `AlarmLiveIndicator` connection honesty; OTP auto-advance UX; URL-synced filters/tabs everywhere.

---

## 1. Design system (`components/tailwind-ui/`)

**What's already enterprise-grade:** `Button` (6 variants × 3 sizes, loading, focus-visible ring, per-variant disabled), `DataTable` (column-def API, sort, sticky header, skeleton, empty, keyboard rows), `PageHeader`, `Drawer`, `Modal`, `ListboxSelect` (WAI-ARIA combobox), `Toolbar`, `Tabs` (with `aria-controls`), `Badge`, `Skeleton`, `ConfirmDialog`, `ToastProvider`.

**Gaps:**

| Primitive | Gap |
|---|---|
| *(missing)* `SegmentedControl` | 6 hand-rolled copies across pages (see §0.3) |
| *(missing)* `Meter` | duplicated verbatim in FleetHealthPanel + AlarmStatusChart |
| *(missing)* `ErrorState` export | exists inside dashboard components only — pages reimplement it |
| `DataTable` | no row-selection / bulk actions; no error state; rows lack `focus-visible`; Space key scrolls page (no `preventDefault`) |
| `KpiTile` | `onKeyDown` Space without `preventDefault`; no focus-visible ring on interactive cards; arbitrary text sizes (`text-[1.7rem]`, `text-[0.68rem]`, `text-[0.64rem]`) |
| `PageHeader` | no `eyebrow` slot (TailAdmin pattern); no divider variant |
| `Avatar` | no children slot (icon avatars hand-rolled as spans) |
| `DashboardCard` | header `px-5` vs flush children `px-4` → 4px misalignment in every flush chart card |

**Typography drift (repo-wide):** `text-[0.64rem]`, `text-[0.68rem]`, `text-[0.7rem]`, `text-[0.6875rem]`, `text-[13px]`, `text-[1.7rem]` — six arbitrary sizes outside any scale.

---

## 2. Page-by-page findings

### Dashboard — grade B+ → closest to enterprise
- **FleetDashboard:** excellent hero + 8 permission-gated sections. Raw error div instead of `Card` (`:116`); `bg-gradient-to-l` physical (decorative); 7-KPI row wraps raggedly at `lg` (`xl:grid-cols-7`).
- **KpiTile:** strong (icon chip, tone, footer chip, honest `—`); a11y nits above.
- **ReportsKpiRow:** error card raw; `speed`/`alarms` query failures silently render `—` with a misleading "0 vehicles" context chip.
- **FleetHealthPanel:** `useDeviceStatuses`/`useFleetStats` ignore `isError` → `0/0` meters presented as truth.
- **FleetComparisonChart:** 4 queries ORed for loading but only 1 surfaces errors — failures become fake zeros.
- **FleetMapPreviewCard:** hand-rolled retry button; legend `bg-white/75` has no dark variant; `attributionControl:false` hides required OSM attribution; popup `setHTML` interpolates unescaped label.
- **HourlyActivityChart:** hardcoded `TZ_OFFSET_MIN = 210` — wrong hour buckets for any non-Tehran user.
- **RecentEventsPanel:** every row links to `/map` (not the alarm); relative time frozen between polls.
- Charts: hardcoded hexes `#912018`, `#F79009`, `'#fff'` bypass `palette.ts`; `EChart` wrapper claims RTL support but only reads `mode`.

### Assets — grade A (repo gold standard)
- Complete states, ConfirmDialog with per-entity copy, toasts, URL-synced tabs, permission-gated actions.
- Nits: `maxHeight="calc(100vh - 320px)"` magic number ×3; empty-state description reuses the search-placeholder key (reads "Search fleets…" on zero-data); `relTime()` hardcoded English; drawer closes on backdrop with unsaved form (no dirty guard).

### Admin — grade C (weakest functional area)
- **AdminPage:** PageHeader is title-only (no description/actions — every other page does better); `users/roles/permissions` have **no error handling**; fixed `aside w-60` never collapses → ~135px content on phones; nested `p-2` inside `p-4` breaks gutter rhythm.
- **SettingsSection:** **mutates per keystroke** (`update.mutate` on every `onChange`); **fake save button** (no `onClick`, permanently "Saved"); mutation errors silent.
- **UserDetailDrawer:** suspend/activate/deactivate fire with **no confirmation and no toast**; `deactivated` is irreversible-ish.
- **RolesSection:** no empty state; **RoleDetailDrawer renders `PERMISSION_CATALOG` from `@/mock/admin-data`** while PermissionsSection renders the live API catalog — they can disagree.
- **AuditSection:** integrity badge hardcoded `success` regardless of actual status; no query error state.
- **UsersSection:** `✓` glyph inside Badge (should be labelled/icon); hardcoded English `rel()`.

### Command Center — grade B+
- Permission fallback, dispatch confirm with device context, dynamic param form with mirrored validation — all good.
- **No error states** for devices/catalog/history queries; deep-link reads `window.location.search` once (stale on SPA navigation); `Card p-3` strips where `Toolbar` belongs.

### Alarms / Events — grade B
- **AlarmCenterPage:** excellent PageHeader with live indicator + tone-coded stat chips; but `FilterSelect` is a raw `<select>`, search box hand-rolls `Toolbar` search, view switcher hand-rolled, `StatChip` reimplements `Badge`; hardcoded aria-labels `"alarm search"`.
- **AlarmDetailDrawer:** the biggest bypass in the repo — fully hand-rolled drawer (no scroll-lock, no shared pattern); **`<Button><Link>` invalid nesting**; ack/resolve mutations silent (no toast/error).
- **AlarmList/AlarmTimeline:** severity pills use inline hex `style` — parallel color system vs `Badge` tokens; rows lack `focus-visible`.
- **EventCenterPage:** raw selects/search duplicating Toolbar+Select (a *second* copy of the same filter bar); hand-rolled LoadMore despite the exported primitive; severity pills inline-class.

### Trips — grade B−
- **TripsPage:** status filter chips hand-rolled; **`isError` ignored** (failure → "API not available" empty state); toolbar vanishes when list empty; `ArrowRight` doesn't flip in RTL; magic `calc(100vh - 280px)`.
- **TripDetailPage:** **title is the raw trip ID**; error masked as "not found"; loading is a bare spinner (no skeleton); `ArrowLeft`/`→` un-flipped in RTL; both replay cards fixed `h-90` → 2 screens stacked on mobile.
- **TripSummary:** weakest KPI system (no tone/footer); `MapPin` used for both distance *and* stops; `formatDuration` copy-pasted.
- **TripTimeline:** great transport metaphor; **real RTL bug** — tick overlay positioned with inline `left:%` while the range input mirrors under `dir=rtl`; 4th hand-rolled speed segmented control.
- **SpeedGraph:** axis colors duplicate `EChart` wrapper tokens (fragile shallow-merge contract); `loading` prop never passed.

### Reports — grade C+ (weakest visual area)
- **ReportsPage:** tab bar hand-rolled with `role="tab"` but no `aria-controls`/keyboard nav — the `Tabs` primitive exists unused → **two tab languages in one product**.
- **ReportsOverviewSection:** third KPI system (`Kpi` raw div — no icon/tone/footer); `ChartCard` duplicates `DashboardCard` minus states; **state-distribution chart has no loading/empty/error**; fabricated `new Error('no data')`; **chart legends/series hardcoded English** — the whole page renders mixed-language charts in Farsi (`'distance (km)'`, `'moving'/'idle'/'parked'`, `'speeding'`…); Spinner-vs-Skeleton loading inconsistency vs dashboard.
- **ReportRangePicker:** chip factory + raw `datetime-local` inputs bypass Input; `→` literal; invalid custom range silently ignored.

### Auth / Profile — grade B+
- Login: solid, but eye-toggle is a raw button with magic `top-[30px]`; remember-device is a raw `<input type=checkbox>` instead of the `Checkbox` primitive (inconsistent with Register/Reset which use `PasswordTextField`).
- Register/Forgot/Reset: consistent; back `ArrowLeft` icons don't flip in RTL (EventCenter does it right with `rtl:rotate-180`).
- MfaVerify: high-quality OTP UX (auto-advance, paste-distribute); factor switcher is hand-rolled segmented control.
- Profile: bare `<p>loading</p>` instead of skeletons; change-password link re-implements Button outline variant as an anchor.

### Map — grade B (functionally rich, visually bridged)
- **MUI inventory (exact):** DeviceListPanel uses `Box/OutlinedInput/InputAdornment/TextField-select/MenuItem/ToggleButtonGroup/ToggleButton/Typography/Divider/List/ListItem/ListItemButton/ListItemAvatar/Avatar/ListItemText/Chip` + 9 `@mui/icons-material` glyphs; MapSettingsPanel uses `Box/Fab/Popover/MenuList/MenuItem/Typography` + 2 icons. Visual identity comes from `.fv-dark-glass` CSS overrides on MUI classnames (`tailwind.css:195–249`).
- **Map UX:** search/filters/presence counts/fleet filter/basemaps/history+playback/map-matching/popup-drawer all real. **Missing:** no geofence layer on the live map (`mapAccents.geofence` token unused), no alarm indicators on map surface, search only matches label (placeholder promises driver/id), no zoom/geolocate/fullscreen controls, roster hidden entirely below `md` with no alternative, layers-FAB collides with playback bar.
- **Dark/RTL:** FleetMap hover popup hardcodes light `#64748B`; GeofenceDrawMap hardcodes `#2563eb/#16a34a/#dc2626` and its overlay buttons are light-only; `PlaybackControls` uses physical `left-2 right-2`; `DeviceListPanel` `pr: 9` physical (stylis flips it today — a Tailwind port must use `pe-*`).
- **Test contract to preserve:** `map-vehicle-card`, `map-settings-button`, `radiogroup` "Basemap style" + 4 `radio` options, presence buttons named `Online · N`, search placeholder, fleet filter options.

### 404 — grade D
Hardcoded English, no translation, no action, no primitives, lives inline in `router/index.tsx:49–58`.

---

## 3. Cross-cutting consistency matrix

| Dimension | Status |
|---|---|
| Dark mode | ✅ near-universal `dark:` pairs; gaps: map preview legend, GeofenceDrawMap overlay buttons, FleetMap hover popup |
| RTL | ✅ logical properties everywhere (grep-verified: zero `ml-/mr-/pl-/pr-` classes); defects: TripTimeline ticks, auth back arrows, `→` literals, `bg-gradient-to-l` |
| Responsive | ⚠️ Dashboard/Assets fine; Admin two-column never collapses; map roster gone below `md`; TripDetail fixed heights |
| Keyboard/a11y | ⚠️ DataTable/AlarmList rows activatable but no `focus-visible`; Drawer/Modal documented "no focus trap"; `✓` glyph badges |
| i18n | ⚠️ 1,169-key parity, but: Reports chart labels English, `relTime` ×2 English, 2 hardcoded aria-labels, 404 untranslated |
| States | ⚠️ Dashboard A / Assets A; Admin, CommandCenter, Trips mask errors; Reports distribution chart stateless |
| Spacing | ⚠️ page `gap-4` consistent; admin nested padding; `maxHeight calc(100vh-N)` varies 280/300/320/420 |

---

## 4. Prioritized fix list (drives the redesign)

1. **Honesty:** unmask errors everywhere (§0.1); kill the fake save button; real confirm+toast for destructive mutations.
2. **MUI zero:** port both map panels, delete `MuiProvider` + `.fv-dark-glass` + 7 deps.
3. **One KPI system, one segmented control, one meter, one error state** — new/extracted primitives, all consumers migrated.
4. **Admin overhaul:** responsive collapse, error states, settings form semantics, drawer confirmations, live permission catalog.
5. **Reports overhaul:** `Tabs` primitive, `KpiTile`-based KPIs, translated charts, distribution-chart states.
6. **Alarms/Events:** shared Drawer + Toolbar/Select/LoadMoreButton, Badge-token severity, toasts on transitions.
7. **Map:** port panels + dark-aware popup + zoom controls + geofence layer + mobile roster + FAB/playback collision + logical positioning.
8. **RTL sweep:** timeline ticks, back arrows, separators.
9. **404 page** + i18n sweep (relative-time consolidation, chart labels, aria-labels).
10. **Visual regression + component gallery** (see VISUAL_REGRESSION_REPORT.md).
