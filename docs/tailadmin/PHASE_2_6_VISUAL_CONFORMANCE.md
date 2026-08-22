# Phase 2.6 — Full Visual Conformance Report

**Date:** 2026-08-22 · **Scope:** `apps/web-dashboard` · **Source of truth:**
`VISUAL_DESIGN_SYSTEM.md` (TailAdmin React)

Method: mechanical **code sweeps** for every rule category (§6–§16), fixes
applied in P0→P4 order, then **browser screenshot validation** — 39 captures:
13 routes × desktop light/dark, 5 key pages × mobile 390 light/dark, and 4
pages in RTL (Persian) — via the real UI login against the live stack.

---

## Scorecard (§26)

| Metric | Value |
|---|---|
| Total pages/routes | 21 (16 protected + 5 public) |
| Compliant | **21** |
| Partially compliant | 0 |
| Non-compliant | 0 |
| Pages fixed this phase | 12 (headers normalized) + 6 components (tokens) |
| Duplicate components removed | 1 (KpiTile's local card chrome → shared `Card`) |
| Raw colors removed | 9 literals → `theme/palette.ts` tokens (`status`/`mapAccents`/`neutral`) |
| Dead palette exports removed | 8 (`primary`, `sidebar`, `lightSurface`, `darkSurface`, `shadows`, `pillRadius`, `glass`×nested) — zero consumers |
| Arbitrary spacing removed | 0 found outside specialized map/video components (allowed) |
| RTL issues fixed | 1 (`GeofenceDrawMap` overlay `left-8` → `start-2`; draw-map controls + status line to logical/Tailwind classes) |
| Dark-mode issues fixed | 2 (VideoTile REC chip rose→danger; live-dot glow moved into `.fv-live-dot` token) |
| Responsive issues fixed | 0 blocking (verified 390/768/1440; see known issues) |
| Remaining MUI usage | **0 imports, 0 dependencies** (verified by grep + lockfile) |

## Fixes applied

1. **PageHeader normalization (§4/§13)** — 11 pages hand-rolled
   `text-xl font-bold` headers; all converted to the shared `PageHeader`
   (`text-[1.5rem]` + description + actions): AlarmCenter, AssetManagement,
   CommandCenter, EventCenter, Geofences, Notifications, Trips, TripDetail
   (id + route meta + status badge slots), Reports, Profile, and **Admin**
   (restructured: header above the nav/content split, aside now nav-only).
   Map/Video keep their overlay chrome (canvas-domain layout, by design).
2. **Color tokenization (§9/§10)** — `TripDetailPage` EVENT_COLOR,
   `TripTimeline` TICK_COLOR, `ActivityStatusChart` STATES,
   `GeofencePage` toggle icon → `theme/palette.ts` (`status`,
   `mapAccents`, `neutral`). `VideoTile` REC chip rose-400 → `danger-400`.
3. **Legacy removal (§22)** — palette pruned to the three live registries
   (`neutral`, `status`, `mapAccents`); v5 glassmorphism/gradient tokens
   deleted (they served the dashboard hero removed in Phase 2.5).
4. **Component normalization (§7)** — `KpiTile` now composes the shared
   `Card` (identical visuals, no parallel card implementation).
5. **Inline-style removal (§10)** — `ErrorBoundary` fallback rebuilt with
   design-system classes (was raw inline CSS); `GeofenceDrawMap` status line
   + control buttons → Tailwind classes (dynamic map height stays inline —
   third-party rendering requirement).
6. **Verified already-compliant** (no changes needed): §6 page padding (zero
   violations — auth cards' inner `p-6 sm:p-8` is legitimate card padding),
   §8 tables (only shared `Table`/`DataTable`/`ReportsTable` exist — zero
   raw `<table>`), §11 arbitrary spacing (none outside specialized
   components), §12 RTL utilities (only intentional physical positioning in
   `Tooltip` side-placement API and symmetric map overlays), §16 empty/loading
   states (no bare strings), status system (§9 registries intact).

## Screenshot validation (§24) — performed

39 captures (desktop 1440 light+dark × 13 routes, mobile 390 light+dark × 5,
RTL × 4) reviewed: flat PageHeader with consistent title/description/action
placement confirmed across pages; dark mode shows no white-background or
invisible-border defects on any capture; mobile stacks single-column with
2-up KPI grid; RTL mirrors correctly (sidebar right, header mirrored, table
columns flipped) with directional chevrons rotating.

## Testing (§27)

- `pnpm typecheck` (app) — clean
- `pnpm test` (app) — **266/266 passed** (31 files)
- `pnpm lint` (biome, repo) — all files touched in Phase 2.6 pass;
  pre-existing repo-wide format drift (~446 diagnostics, untouched files,
  also present before Phase 2.5) remains — tracked below as debt
- `pnpm build` (app) — succeeds; bundle contains no MUI/Emotion

## Remaining technical debt

1. **Biome format drift** — ~446 pre-existing diagnostics in untouched files
   across apps; needs a dedicated repo-wide `lint:fix` pass.
2. **Tooltip keyboard nav** — no arrow-key roving focus (Phase 2 known gap;
   `ListboxSelect`/`MultiSelect` do support it).
3. **Map dark-mode history markers** — subtle contrast dip (unchanged from
   Phase 2.5 observation).
4. **e2e (Playwright) not run this session** — contracts preserved
   (testids, combobox/option roles, admin `?section=` routing unchanged).
5. **Tenants / API Keys / Work Orders pages** — no product surface exists
   yet (not visual debt; future feature work).
6. **Mobile header density** — title + breadcrumb area is tight on 390px;
   acceptable, but a future pass could shrink the page title to `text-xl`
   under `sm:` inside `PageHeader`.

**STOP after Phase 2.6** — no further phase started.
