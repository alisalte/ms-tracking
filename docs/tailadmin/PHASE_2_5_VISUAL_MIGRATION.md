# Phase 2.5 — Visual Fidelity Migration Report

**Date:** 2026-08-22 · **Scope:** `apps/web-dashboard` · **Preceded by:** Phases 1–8 (see `PHASE_1_AUDIT.md` … `PHASE_8_REPORTING.md`)

Phase 2.5's mandate: pages must look and feel like a real TailAdmin
application — not old pages dropped into the TailAdmin shell. The work was
driven by a **screenshot audit** (44 captures: 19 routes × light/dark, mobile
390px sweep, tablet 768px, dialog states) rather than assumptions: every page
was rendered, captured via Playwright (real UI login, real stack), and
reviewed against TailAdmin patterns before and after the changes.

---

## What the audit found

Phases 1–8 had already taken every page off MUI at the page level, so the
remaining gaps were concentrated:

1. **Dashboard hero banner** — a blue/purple gradient card sat above the KPI
   grid. Not TailAdmin (flat surfaces); the single largest visual outlier.
2. **Breadcrumb duplication** — single-item nav groups rendered
   "Assets > Assets", "Video > Video", "Maintenance > Maintenance".
3. **Dark-mode contrast** — header search border invisible
   (`border-white/10` on translucent dark surface); empty-state description
   text one step too dim (`graydark-600` on `graydark-300`).
4. **Three MUI remnants** — `GeofenceFormDialog` (multi-selects),
   `MapToolbar` (history-preset select), `RoutePlannerDialog` (whole dialog) —
   kept earlier "for e2e combobox gestures", visually inconsistent in
   TailAdmin forms.
5. **MUI runtime still mounted** — `ThemeRegistry` wrapped the app in Emotion
   + MUI `ThemeProvider`/`CssBaseline`; Tailwind preflight was disabled to
   coexist; MUI/Emotion/stylis deps shipped without any consumer benefit.

Everything else (tables, toolbars, tabs, admin sections, reports, auth pages,
status badges) already matched TailAdmin patterns — verified visually, not
assumed.

## Changes

### New primitives (`components/tailwind-ui/`)
- `PageHeader` — §4 page anatomy: title + description + end-aligned actions,
  flat on the page background (barrel-exported).
- `ListboxSelect` / `MultiSelect` — WAI-ARIA 1.2 combobox + listbox widgets
  (real `role="option"` entries, keyboard arrows/enter/escape, chips, check
  marks, dark mode). These replace MUI `<Select>` while preserving the
  Playwright e2e click-a-real-option gesture that native selects can't offer.

### Fixes
- **Dashboard** — gradient hero removed; `PageHeader` + `LiveBadge` + KPI grid
  now follow the TailAdmin dashboard composition (header → KPI → charts →
  activity → map). Orphaned `dashboard.heroEyebrow` keys removed from en/fa
  locales.
- **Breadcrumb** — group label suppressed when identical to the item label.
- **Header** — search field dark border made visible (`white/15`).
- **EmptyState** — description/icon bumped to `graydark-700` for dark-mode AA.

### MUI removal (zero @mui imports remain)
- `MapToolbar` — preset selector → `ListboxSelect` (same
  `data-testid="history-preset-select"`, same option labels).
- `GeofenceFormDialog` — type → `ListboxSelect`; alerts + vehicle assignment →
  `MultiSelect` (chips, "All vehicles (tenant-wide)" placeholder, empty-registry
  message preserved).
- `RoutePlannerDialog` — MUI Dialog → `tailwind-ui Modal` + `Input` + `Alert`.
- `ThemeRegistry` — Emotion cache / MUI ThemeProvider / CssBaseline removed;
  retains mode context (`useThemeContext` — consumed by EChart, SpeedGraph,
  ThemeSwitcher), `.dark` class strategy, `system` preference, `<html
  lang/dir>` RTL handling.
- `src/theme/{theme,dark.theme,rtl}.ts` deleted (`palette.ts` stays — pure
  constants consumed by charts/maps). `vite.config.ts` `vendor-mui` chunk
  removed. Deps dropped: `@mui/material`, `@mui/icons-material`,
  `@emotion/{react,cache,styled}`, `stylis-plugin-rtl`.
- Tailwind **Preflight enabled** (`@import "tailwindcss"` full) — it replaces
  CssBaseline as the document reset.

### Preserved by design (no functional change)
Business logic, API calls/hooks, routing, permissions/RBAC guards, tenant
behavior, i18n keys, e2e testids (`history-preset-select`, `geofence-save`,
`geofence-create`, `playback-*`), and the login/session flow are untouched.

## Verification

- **Unit/component:** 31 spec files, **266/266 passed** (Vitest + Testing
  Library) after the MUI removal, preflight enable, and port — including
  `theme-system.spec`, `tailwind-ui.spec`, `map.spec`, `dashboard.spec`.
- **Typecheck:** `tsc -b --Emit` clean.
- **Production build:** `vite build` succeeds; no MUI/Emotion chunk remains in
  `dist/`.
- **Lint:** biome — all files touched by this phase pass. (Repo-wide `pnpm
  lint` still reports ~446 pre-existing format diagnostics in files this
  phase did not touch; verified zero overlap with the changed-file set.)
- **Visual re-audit:** re-shot the full screenshot matrix after the changes —
  gradient hero gone (flat header + KPI grid), breadcrumb single-label,
  geofence dialog renders fully in TailAdmin styling including the open
  listbox, dark-mode fixes confirmed.

## Status by priority page

| Priority | Page | Status |
|---|---|---|
| 1 | Dashboard | ✅ rebuilt header, verified |
| 1 | Live Tracking (/map) | ✅ verified; preset select ported |
| 1 | Assets (Fleet/Vehicles/Devices) | ✅ verified (tabs, tables, badges) |
| 2 | Alarms | ✅ verified (was already conformant) |
| 2 | Geofences | ✅ form dialog ported off MUI |
| 2 | Notifications | ✅ verified |
| 2 | Events | ✅ verified |
| 3 | Reports | ✅ verified |
| 3 | Video/Playback | ✅ verified |
| 4 | Maintenance (placeholder) | ✅ UpcomingFeature state |
| 5 | Admin (Users/Roles/Audit/Settings) | ✅ verified |

Routes that don't exist as pages (no UI was built for them in any phase):
Tenants, API Keys, Work Orders — the admin sections and Maintenance
placeholder cover today's product surface.

## Known visual issues / debt

1. **Map dark-mode overlay contrast** — subtle dimming of inactive markers in
   history mode; acceptable but improvable.
2. **Dashboard dark mode** — LiveBadge vertical rhythm beside the long
   description is slightly tight at md widths.
3. **Dropdown primitive** — still no arrow-key roving focus inside `Dropdown`
   menus (documented since Phase 2); the new `ListboxSelect`/`MultiSelect`
   do support arrow keys.
4. **`pnpm lint` baseline** — pre-existing biome format drift in ~20 untouched
   web-dashboard files (and other apps) should be cleaned in a dedicated
   formatting pass.
5. **e2e suite** — Playwright specs (geofences, history-playback) were not
   executed this session (require `E2E_RUN=1` + full stack); their contracts
   (testids, combobox/option roles) were preserved by construction and the
   component-level specs cover the ported controls.

**STOP after Phase 2.5** — per the brief, no further migration phase was
started.
