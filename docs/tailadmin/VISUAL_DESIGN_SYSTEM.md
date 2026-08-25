# FleetVision Visual Design System

**Source of truth:** TailAdmin React (Tailwind CSS v4). This document is the
visual contract for every FleetVision page — when a page or component needs a
style decision, TailAdmin's pattern wins (§17 of the Phase 2.5 brief: TailAdmin
visual language + FleetVision functionality, never "some modern dashboard").

Related: `PHASE_2_5_VISUAL_MIGRATION.md` (what changed and why),
`src/styles/tailwind.css` (token definitions), `src/components/tailwind-ui/`
(the implementation of everything below).

---

## 1. Tokens & palette

All tokens live in `src/styles/tailwind.css` under `@theme` and MUST be used
via Tailwind utilities — never raw hex in components (charts/maps import the
mirrored constants from `src/theme/palette.ts`).

| Role | Token family | Notes |
|---|---|---|
| Brand / primary | `brand-25…900` | TailAdmin indigo, primary `#465FFB` |
| Light surfaces | `gray-25…950` | page background `gray-50` |
| Dark surfaces | `graydark-200…900` | sidebar `graydark-200`, cards `graydark-300` |
| Semantic | `success / warning / danger / info` 50–700 | statuses & alerts |
| Charts | `meta-1…9` | echarts series ramp |

Fonts: `--font-sans` Roboto (+ Vazirmatn in RTL), `--font-persian`
Vazirmatn-first, `--font-mono` JetBrains Mono.

## 2. Dark mode

- Class strategy: `.dark` on `<html>`, toggled by `ThemeRegistry`
  (`fleetvision_theme_mode` = `light | dark | system`, persisted).
- Every surface/text/border pairs a base utility with a `dark:` partner.
- MUI is REMOVED (Phase 2.5): Tailwind Preflight owns the document reset.
- Forbidden in dark mode: white/near-white backgrounds without a `dark:`
  partner, invisible borders (`border-white/10` on `bg-white/5`-style
  translucent dark surfaces), unreadable placeholders.

## 3. Layout & spacing

- Shell: dark sidebar rail (270px, collapses to 64px; off-canvas < lg) +
  sticky 64px header + scrollable `<main>`.
- Page padding: owned by `MainContent` (`PAGE_PADDING`) — pages never add
  their own outer margins.
- Spacing scale: Tailwind steps only (`2/3/4/5/6`). Page-level rhythm:
  `gap-4` between cards, `mb-5` after a page header. No arbitrary values
  (`mt-[13px]`) in page layouts.
- RTL: logical utilities only (`ps-/pe-/ms-/me-/start-/end-`), never
  `pl/pr/ml/mr`. Icons that imply direction flip with `rtl:rotate-180`.

## 4. Typography hierarchy

| Level | Classes |
|---|---|
| Page title (h1) | `text-[1.5rem] font-bold tracking-tight` — via `PageHeader` |
| Section/card title (h3) | `text-base font-semibold` — via `CardHeader` |
| Sub-section (h4) | `text-sm font-semibold` |
| Body | `text-sm` |
| Secondary/muted | `text-sm text-gray-500 dark:text-graydark-600` |
| Label (forms) | `text-sm font-medium` |
| KPI label | `text-[0.68rem] font-bold tracking-[0.12em] uppercase` |
| Table header | `text-xs font-semibold uppercase tracking-wide` |

## 5. Page anatomy (§4 standard)

```
Breadcrumb (header)            ← derived from nav config
PageHeader                     ← title + description + actions (end-aligned)
Filters / Toolbar              ← search left, filters, actions right
Main content                   ← cards / tables / map
```

`PageHeader` (`components/tailwind-ui/PageHeader.tsx`) renders this — flat on
the page background. **Colored/gradient hero banners are not part of the
system** (removed from the dashboard in Phase 2.5).

## 6. Cards

`Card` + `CardHeader`: `fv-surface rounded-2xl border p-4 sm:p-5`. One card
look everywhere — `interactive` adds hover lift. No page-local card variants.

## 7. Tables

`Table/THead/TBody/TH/TD` (simple) or `DataTable` (column defs, sorting,
pagination). Requirements: uppercase header row, row hover, zebra optional,
status badges in cells, `NumberedPagination`/`LoadMoreButton` underneath,
`EmptyState` when zero rows, `Skeleton` rows while loading. Reports-style
tables may use the shared `ReportsTable` (client-side sorting).

## 8. Badges & the status system (§9)

- `Badge` — neutral chip with `color` + optional `dot`.
- `StatusBadge` — the ONLY place domain status→color mapping lives for
  generic statuses (`critical/high/medium/low/info/online/offline/idle/
  moving/stopped/open/acknowledged/resolved`).
- Domain registries (also single-source, `Badge`-colored):
  - Assets: `components/assets/asset-meta.tsx` (fleet/vehicle lifecycle,
    device registry status, ingest protocol).
  - Alarms: `components/alarms/AlarmStatusBadge.tsx` (wraps StatusBadge).
- Rule: pages NEVER define their own status colors. Colors always pair with
  a dot and/or text (never color alone).

## 9. Forms

`Input`, `Textarea`, `Select` (native), `ListboxSelect`/`MultiSelect` (custom
comboboxes for e2e-driven gestures), `Checkbox`, `Switch`. Label above,
`text-sm font-medium`; errors `text-xs text-danger-600` under the field;
`focus-visible:ring-2 ring-brand-500/30` everywhere. `h-9` control height.

## 10. Modals & drawers

`Modal` (header/body/footer, ESC + backdrop close) and `Drawer` (end-anchored
panel). Footer: secondary `Close` left of the primary action. Validation
errors render inline above the footer.

## 11. Buttons

`Button` variants `primary | secondary | outline | ghost | danger | success`,
sizes `sm(h-8) | md(h-9) | lg(h-11)`, `loading` spinner. One primary action
per view. `IconButton` for icon-only actions (mandatory `aria-label`).

## 12. Alerts, toasts, empty & loading states

- Inline messages: `Alert` (`info/success/warning/danger`).
- Transients: `ToastProvider` (top-end stack).
- Zero data: `EmptyState` (icon circle + title + description + optional
  action) — never a bare "no rows".
- Loading: `Skeleton` blocks/rows or `Spinner` for actions.
  Errors: `ErrorState` with retry.

## 13. Responsive rules

Breakpoints follow Tailwind. Verified widths: 1440 / 1280 / 1024 / 768 / 390.

- ≥ lg: sidebar rail + multi-column grids (`lg:grid-cols-12`).
- md: sidebar collapses (hamburger → off-canvas), grids stack to 2-up.
- < sm: single column; tables collapse to card rows or horizontal scroll;
  toolbars wrap; KPI grid `grid-cols-2`.

## 14. Charts & maps

- echarts via the theme-aware `EChart` wrapper (reports / trip speed graph)
  and ApexCharts via `ApexChart` on the fleet dashboard. Series colors from
  `@/theme/palette` (`status`/`mapAccents`/`meta`).
- MapLibre dark style in dark mode; markers generated from the same palette
  (`lib/map-markers.ts`). Map overlays use translucent surfaces
  (`bg-white/90 dark:bg-graydark-300/90` + `backdrop-blur`).
