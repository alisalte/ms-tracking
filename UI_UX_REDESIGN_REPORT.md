# UI/UX Redesign Report — FleetVision Web Dashboard

> **Date:** 2026-08-24 · **Scope:** the full "Product UI Quality Upgrade" task (NOT a migration)
> **Baseline:** `UI_UX_AUDIT.md` (written BEFORE any change)
> **Verification (all executed):** `vitest` **276/276 PASS** (31 files) · `tsc -b --noEmit` **clean** · `biome check` on all 79 touched files **clean** (pre-existing legacy-file errors untouched, unchanged policy) · `vite build` production **PASS** · Playwright visual baselines **8/8 PASS** (5 honest skips — live stack down) · `grep -R "@mui" src` → **ZERO** · i18n **en=fa=1220 keys** (verified parity).

---

## 0. What this was

Per the task's core instruction, this was executed as a **product quality upgrade**, not a Tailwind conversion. The audit (`UI_UX_AUDIT.md`) found 10 systemic problems (masked errors, three KPI systems, six hand-rolled segmented controls, a hand-rolled drawer, MUI remnants, silent mutations, parallel color systems, four relative-time implementations, RTL defects, a throwaway 404). Every item was addressed. Numbers:

| Metric | Value |
|---|---|
| Files changed (web-dashboard) | **~85** (src + tests + e2e) |
| New design-system primitives | `SegmentedControl`, `Meter` (+ `CHECKBOX_INPUT_CLASS` export, `ListboxSelect tone="onGlass"`, `Input.endAdornment`, `PageHeader eyebrow/divider`) |
| MUI/Emotion/stylis packages removed | **8** (`@mui/*` ×2, `@emotion/*` ×3, `stylis`+plugin+types) |
| Error states unmasked | **12 surfaces** (TripsPage, TripDetail, Admin users/roles/permissions/audit, CommandCenter ×3, FleetHealthPanel, FleetComparisonChart, ReportsKpiRow, Reports distribution chart) |
| Hand-rolled patterns retired | segmented ×6 → SegmentedControl · meter ×2 → Meter · drawer ×1 → shared Drawer · load-more ×1 → LoadMoreButton · filter bars ×2 → Toolbar+Select · raw selects ×4 · `✓`-glyph badge · fake save button |
| RTL defects fixed | TripTimeline tick `left:` → `insetInlineStart` (REAL bug), 6 un-flipped back arrows, `→` literals ×2, PlaybackControls `left/right` → logical, chevron flips |
| Relative-time implementations | 4 → **1** (`lib/relative-time`, i18n-aware) |
| New i18n keys | **+51** (1212→1220 total? — see note)¹ |
| Component gallery | `/dev/ui-gallery` — public, backend-free, 26 primitives × states |
| Visual regression | `e2e/visual-regression.e2e.spec.ts` — 8 baselines (login+gallery × light/dark × ltr/rtl), 5 stack-gated page shots |

¹ Final verified count: en=fa=**1220** (was 1169).

---

## 1. Per-page report

Format per the task spec: Problems → TailAdmin Pattern → Changes → UX → Responsive/RTL/Dark/A11y → Tests → Remaining.

### Dashboard
- **Problems:** stats error card raw div; 7-KPI ragged wrap; FleetHealthPanel/FleetComparisonChart/ReportsKpiRow masked failures as fake zeros/`—`; hardcoded `TZ_OFFSET_MIN=210` (wrong buckets outside Tehran); off-palette hexes; `DashboardCard` header/flush padding misalignment; KpiTile Space-scroll + no focus ring.
- **TailAdmin pattern:** information-rich KPI tiles (icon+value+label+real footer chip), sectioned widget grid, honest state triad per card.
- **Changes:** KPI grid `lg:4/2xl:7`; error cards → `Card`; **any joined-source failure surfaces as the card's error with retry-all** (never fabricated zeros — the one deliberate exception is FleetHealthPanel's stale-tile which has a REAL fallback, documented inline); viewer-local timezone buckets; `dangerDeep` palette token replaces raw hex; `Meter` primitive replaces both duplicated meter implementations; KpiTile a11y + typography scale (text-xs / text-3xl); px alignment `px-4 sm:px-5` across all flush chart children.
- **Responsive/RTL/Dark/A11y:** grid collapses 2/3/4/7; logical utilities; full dark pairs; progressbars focusable+labeled.
- **Tests:** dashboard.spec green (error-retry case updated — duplicate-error surfaced a REAL double-render, fixed in product code).
- **Remaining:** RecentEventsPanel rows all deep-link to `/map` (should link the alarm); relative-time freezes between polls.

### Assets
- **Changes:** empty-state descriptions no longer reuse search placeholders (dedicated keys); `relTime()` deleted → `lib/relative-time` (translated); **AssetFormDrawer dirty-guard**: backdrop-close disabled while dirty + discard-confirmation modal before Esc/Cancel/X close.
- **Tests:** assets.spec green.

### Admin (was the weakest area — full overhaul)
- **Problems:** title-only header; fixed 240px sidebar crushing phones; users/roles/permissions/audit swallowed errors; SettingsSection mutated **per keystroke** + a passive fake "Saved" button; user status actions fired with no confirmation/toast; RoleDetailDrawer rendered the MOCK permission catalog while PermissionsSection rendered the live one; integrity badge hardcoded success; no permissions loading state; no roles empty state; `✓` glyph.
- **Changes:** `PageHeader` with eyebrow+description; **mobile horizontal nav strip** (`AdminNav orientation="horizontal"`) + desktop sidebar; per-section `ErrorState` with retry at page level; **SettingsSection rewritten as a real form** (local draft → dirty diff → Save/Reset; one request; Alert on failure; success toast; unsaved hint); **status actions confirmed via ConfirmDialog** (danger tone for irreversible deactivate) + toasts + inline failure Alert; RoleDetailDrawer on the **live `usePermissions()` catalog**; permissions loading skeleton; roles `EmptyState`; audit query error state; integrity badge now an honest "Hash-chained" gray badge with tooltip (a live chain-verification endpoint does not exist — stated, not faked); single gutter owner (p-2 wrappers removed).
- **Responsive/RTL/Dark/A11y:** collapses below md; aria-current nav; focus rings.
- **Tests:** admin.spec green (nav label now asserted via getAllByText — rendered by both nav variants).

### Alarms / Events
- **Changes:** AlarmCenter filter bar rebuilt on `Toolbar`+3×`Select` (hardcoded aria-labels gone — Toolbar's built-in search is accessible); view switcher → `SegmentedControl`; StatChip → `Badge`; **AlarmDetailDrawer rebuilt on the shared `Drawer`** (scroll-lock, Esc, dialog role); **invalid `<Button><Link>` nesting fixed** (navigate via useNavigate); ack/resolve now toast + inline Alert on failure; severity hex pills → `Badge` tokens everywhere (List/StatusBadge/Timeline); keyboard focus-visible on rows/segments; EventCenter: same Toolbar/Select pattern, hand-rolled load-more → `LoadMoreButton` (testid preserved), severity pills → Badge, duplicated `severityTone()` deleted.
- **Tests:** alarms.spec (2 queries updated to radio/dialog semantics), event-center.spec (searchbox role) — green.
- **Remaining:** type-filter options derive from the loaded page only.

### Trips / Trip Detail
- **Changes:** TripsPage query failures render `ErrorState` (retry) — never "empty"; toolbar stays mounted on empty rosters; status chips → `SegmentedControl`; row arrow flips in RTL. TripDetail: 404 vs error distinguished; **layout-preserving skeleton** replaces the bare spinner; **human-readable title** (vehicle · date, not the raw id); section headers on `CardHeader`; back arrow + route separator flip in RTL. TripSummary: distinct icons (`Route` distance / `CircleStop` stops). **TripTimeline RTL bug FIXED** (`insetInlineStart` — ticks mirrored correctly under `dir=rtl` now); speed selector → SegmentedControl.
- **Tests:** trips.spec green (REAL-mode cases now assert the honest network-ErrorState — the §22 empty copy only applies to the api layer's intentional empty resolution).

### Reports
- **Changes:** hand-rolled tab bar → `Tabs` primitive (real `aria-controls`; `TabItem.testid` added to preserve contracts); **the third KPI system is gone** — `KpiTile` everywhere (11 tiles, icons+tones+footer chips); `ChartCard` → `Card`+`CardHeader`; **all chart series/legend labels translated** (`reports.labels.*` — the page no longer renders English charts inside Farsi); distribution chart got its missing empty state; fabricated `new Error('no data')` → `EmptyState`; spinners → skeletons; range-picker `→` → flipping icon.
- **Tests:** reports.spec green (value formatting assert updated for KpiTile's locale formatting).

### Command Center
- **Changes:** all three queries got error states (picker/catalog/history) with retry; deep-link via `useSearchParams` (live SPA navigation).
- **Tests:** unchanged contract, green.

### Auth / Profile / 404
- **Changes:** **real 404 page** (`EmptyState`+`Button`+i18n+action, replaces the 6-line inline throwaway); LoginPage reuses `PasswordTextField` (eye toggle via the new `Input.endAdornment` slot — no more `top-[30px]` hack) + `Checkbox` primitive; Register/Forgot/Reset back arrows flip in RTL; Profile loading is a layout-mirroring skeleton (`role=status`); change-password is a real `Button variant=outline` + navigate.
- **Tests:** auth-rbac.spec green (label wiring preserved).

### Map (visual + UX, post-MUI)
- **MUI zero:** `DeviceListPanel` + `MapSettingsPanel` fully rewritten on Tailwind/tailwind-ui (glass tones via the new `ListboxSelect tone="onGlass"`); `MuiProvider` deleted; `.fv-dark-glass` MUI-override CSS block deleted; **grep `@mui` in src = 0**.
- **UX upgrades:** **zoom+compass NavigationControl** (lifted above the playback bar via scoped CSS); **live geofence layer** (ACTIVE fences as dashed brand outlines + faint fill — circles converted to rings via `circleToPolygonRing`; basemap swap respects layer order); **mobile roster** — below md the roster is a slide-in overlay with backdrop + floating toggle (roster stays mounted so selection sync + tests hold); settings FAB **raises above the playback transport** while history playback runs; hover popup dark-aware (`.fv-map-popup` light+dark CSS, inline hex removed); `PlaybackControls` logical positioning + mirrored chevrons.
- **Tests:** map.spec 12/12 (fleet-filter gesture updated to the ListboxSelect click), map-history/live-tracking-shell green.

---

## 2. Design system changes

- **New:** `SegmentedControl` (WAI-ARIA radiogroup, arrow/Home/End keys, wrap+skip-disabled, `onGlass` tone), `Meter` (semantic tones, `value/max` readout, focusable progressbar).
- **Upgraded:** `DataTable` (row selection + indeterminate header + **bulk-action bar** + `errorState` slot + per-column `hidden` + row `focus-visible` + Space `preventDefault`); `PageHeader` (`eyebrow`, `divider`); `Checkbox` (`CHECKBOX_INPUT_CLASS` shared); `ListboxSelect` (`tone="onGlass"`); `Input` (`endAdornment`); `KpiTile` (a11y + scale); `DashboardCard` (padding scale).
- **Gallery:** `/dev/ui-gallery` (public, backend-free) renders every primitive × states + composed patterns (selection table, KPI tiles, overlays, toolbar) — the zero-dependency Storybook equivalent and the visual-regression target.

## 3. Final scorecard

| Page | Before | After | Quality /10 | Remaining issues |
|---|---|---|---|---|
| Dashboard | B+ | A− | **9** | event rows deep-link to /map; relative-time poll freeze |
| Assets | A | A+ | **9.5** | — |
| Admin | C | A− | **8.5** | permissions matrix still read-only (documented follow-up) |
| Alarms | B | A− | **8.5** | type filter from loaded page only |
| Events | B | A− | **8.5** | same |
| Trips | B− | A− | **8.5** | — |
| Trip Detail | B− | A− | **8.5** | fixed h-90 cards on mobile (improved, not perfect) |
| Reports | C+ | A− | **8.5** | CSV/alert deep-links unchanged (fine) |
| Command Center | B+ | A− | **9** | — |
| Auth | B+ | A | **9** | MFA factor switcher now on SegmentedControl ✓ |
| Profile | B+ | A− | **9** | — |
| Map | B (bridged) | A− | **8.5** | map search matches label only (placeholder promises driver/id); basemap tiles are external (screenshot-masked) |
| 404 | D | A | **9** | — |
| Design system | B+ | A | **9** | Drawer/Modal still no focus trap (documented limitation) |

**Overall: ~8.9/10** — TailAdmin visual language + FleetVision domain UX, verified by tests, typecheck, lint, build, and screenshot baselines.

## 4. Honestly not done (per the task's "don't hide it" rule)

| Problem | Root cause | Recommended | Risk |
|---|---|---|---|
| Authenticated-page baselines not captured | live docker stack (identity+DB) was down in this session; tier SKIPS by design | boot the stack, run `npx playwright test e2e/visual-regression.e2e.spec.ts --update-snapshots` | low — the tier is wired and self-skips honestly |
| Baselines are platform-specific | font rasterization per OS (files are `-win32.png`) | regenerate on the baseline-owning machine | low |
| Map search only matches `label` | MapPage's filter implementation | extend to driver/plate/id fields | low |
| Drawer/Modal focus trap | primitives predate this task | add focus-trap util to both primitives | medium (a11y) |
| Speed heat map / live geofence TOOLTIPS | deferred before this task | hover popup with fence name | low |
