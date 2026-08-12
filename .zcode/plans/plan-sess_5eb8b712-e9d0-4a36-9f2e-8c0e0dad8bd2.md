# FleetVision × TailAdmin Integration — Pass 1: Foundation, Shell & Dashboard

## Strategy (confirmed by you)
Introduce **Tailwind CSS alongside MUI** (coexistence), rebuild the **app shell, shared primitives, and Dashboard** in TailAdmin's visual language this pass. The other 14 pages keep working on MUI (now indigo-branded) and get ported incrementally in later passes. **No logic changes** — API/auth/router/i18n/RBAC/RTL all preserved.

## Key technical decisions

1. **Tailwind v4** via the official `@tailwindcss/vite` plugin (CSS-first config with `@theme`). It's the current version, has first-class Vite 6 / React 19 support, no PostCSS config needed.
2. **Preflight OFF** — Tailwind's base reset would break MUI components globally; disabling it is the documented coexistence path. Our new Tailwind classes won't rely on preflight.
3. **Dark-mode bridge**: update `ThemeRegistry` so the existing MUI toggle *also* flips `document.documentElement.classList.toggle('dark')`. One toggle drives both MUI and Tailwind.
4. **RTL bridge**: Tailwind v4 logical utilities (`ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`) honor `<html dir>`, which the app already sets. New Tailwind components use logical utilities → RTL works automatically.
5. **Brand → Indigo/Violet** (task §18): shift the global primary token from Material Blue `#2196F3` to TailAdmin Indigo (`#465FFB` / `#3C50E0`). Because this token feeds the MUI theme, *every* existing MUI page rebrands automatically. Gradients restrained.
6. **Replace-in-place** for shell/layout/dashboard files (same export names & props → zero router/import churn), plus a **new `src/components/tailwind-ui/`** barrel for shared TailAdmin-style primitives.

## Files changed this pass

### A. Toolchain & tokens (new)
- `apps/web-dashboard/package.json` — add `tailwindcss@4`, `@tailwindcss/vite@4`.
- `apps/web-dashboard/vite.config.ts` — add `tailwindcss()` plugin.
- `apps/web-dashboard/src/styles/tailwind.css` (new) — `@import "tailwindcss"` + `@theme` tokens + dark-mode variant + component classes (`.fv-sidebar-link`, etc.).
- `apps/web-dashboard/src/main.tsx` — add `import '@/styles/tailwind.css'`.

### B. Theme bridge (minimal edits to existing files)
- `src/theme/ThemeRegistry.tsx` — in the existing `useEffect` that sets `<html dir>`, also toggle `.dark` class from `mode`. (MUI theme swap unchanged.)
- `src/theme/palette.ts` — `primary.main` `#2196F3`→`#465FFB`, `brandGradient`→indigo/violet. Sidebar palette stays dark (TailAdmin signature).

### C. New shared primitives (`src/components/tailwind-ui/` barrel)
`Button.tsx`, `Card.tsx`, `Badge.tsx`, `StatusBadge.tsx`, `IconButton.tsx`, `Avatar.tsx`, `Tooltip.tsx`, `index.ts`. Used by the shell + dashboard; reusable by future pages.

### D. Shell — rebuild in Tailwind (replace-in-place)
- `src/layouts/AppLayout.tsx` — Tailwind flex shell. Keeps `PAGE_PADDING`, mobile/collapsed state, full-bleed detection.
- `src/components/shell/Sidebar.tsx` — TailAdmin dark sidebar: brand header, grouped nav, active pill, collapse-to-icons, mobile off-canvas. Keeps `NAV_GROUPS` + `filterNavByPermissions` + `useAuth().permissions`.
- `src/components/shell/Topbar.tsx` — TailAdmin header: global search, notifications, theme toggle, `LanguageSwitcher`, user dropdown. Keeps `useThemeContext`, `logout()`.
- `src/layouts/AuthLayout.tsx` — TailAdmin split-panel (indigo gradient brand panel + form panel), RTL-safe.

### E. Dashboard — rebuild in Tailwind (replace-in-place)
- `src/components/dashboard/DashboardGrid.tsx` — Tailwind grid, header row. Keeps `useFleetStats()`.
- `KpiCard.tsx`, `WidgetCard.tsx`, `LiveBadge.tsx`, `StatCard.tsx` — Tailwind versions.
- Sub-widgets keep their **existing logic** (TanStack Query hooks), markup restyled: `ActiveAlertsPanel`, `FleetActivityChart`, `AlertTypeBreakdownChart`, `FleetUtilizationPanel`, `FleetPerformanceChart`, `VehiclesAttentionList`, `WeatherWidget`, `FleetMapPreview`.
- ECharts containers restyled (dark-mode-aware option text) — no chart-logic changes.
- Map components: **not** restyled (MapLibre + clustering untouched); dashboard map preview keeps current working impl.

### F. Auth pages
`LoginPage`/`RegisterPage`/etc. sit inside the rebuilt `AuthLayout` — they get the new shell for free. Their internal forms stay MUI this pass. Full Tailwind restale deferred to a later pass.

## Explicitly NOT in this pass (deferred, tracked in report)
- Internals of the 14 non-dashboard pages (Assets, Alarms, Trips, Video, Reports, Admin, Maintenance, Geofences, Commands, Profile, Map detail) — remain MUI, fully functional, rebranded indigo.
- A Tailwind `DataTable` (current MUI `DataTable.tsx` stays).
- Removing MUI/Emotion (coexistence continues until all pages ported).
- New routes/features/backend (none invented).
- Lazy-loading/code-splitting (separate perf pass).

## Validation (run before "done")
1. `pnpm install` (workspace root).
2. `pnpm --filter @fleetvision/web-dashboard typecheck`.
3. `pnpm lint` (Biome, root).
4. `pnpm --filter @fleetvision/web-dashboard test` — all 17 existing specs must still pass.
5. `pnpm --filter @fleetvision/web-dashboard build` — Vite production build must succeed.
6. Manual checks (dev server): Login → Dashboard renders; sidebar collapse; mobile drawer; dark-mode toggle flips both MUI + Tailwind; FA/RTL flips layout + chevrons; notifications; user menu; dashboard KPIs/charts/map render.

## Docker / `pnpm stack:up`
I'll run the frontend-local checks above. Full `pnpm stack:up` requires backend services + Postgres + Redis; I'll leave that as a verification step for you (or I can attempt it if you want — slower, depends on full stack health).

## Risk notes
- **Preflight off** → a few Tailwind defaults (e.g. default border color) differ from TailAdmin's demo; I'll set explicit borders/colors in component classes.
- **MUI `CssBaseline`** still owns body resets — confirmed compatible.
- **Indigo rebrand** changes the look of all 14 MUI pages at once (intended per §18). If you'd rather keep them blue until each is ported, say so and I'll scope the token change to Tailwind-only.