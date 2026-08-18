# FleetVision TailAdmin Migration — Phase 4: Fleet Overview Dashboard

**Date:** 2026-08-18
**Scope:** `apps/web-dashboard` dashboard (`/dashboard`)
**Result:** 245/245 unit tests · typecheck ✅ · lint (all touched files) ✅ · production build ✅. Zero API changes — every section renders from the existing hooks.

---

## 1. What was built

The generic MUI/glass dashboard (`DashboardGrid`) was replaced by **FleetDashboard**, a TailAdmin composition with per-section loading/empty/error isolation. No new endpoints, no mock hardcoding — every widget consumes the existing TanStack Query hooks (mock mode keeps falling back to the same deterministic fixtures).

| Phase-4 section | Implementation | Data source (existing) |
|---|---|---|
| **KPI cards** — Total Vehicles, Moving, Idle, Parked, Offline, Active Alarms, Active Devices | `KpiTile` ×7 (`FleetDashboard`) | `useFleetStats` (fleet-mgmt `/summary` × gps device statuses); Moving/Idle/Parked derived client-side from `useMapVehicles` (registry × status × latest-position join); Active Alarms = `useActiveAlarms` count; Active Devices = `useDeviceStatuses` ONLINE count |
| **Live Fleet Map** | `FleetMapPreviewCard` (Tailwind chrome port) | `useMapVehicles` → MapLibre, presence-tinted markers, popups, glass legend, link to `/map`. Clustering stays on the full tracking map (supercluster) — preview is marker-only by design |
| **Vehicle Activity** | `ActivityStatusChart` — ECharts donut (driving/idle/stopped/offline + center total) | Same `useMapVehicles` join; `countStates()` shared with the KPI row |
| **Alarm Summary** | Severity chips (Critical / Warning / Info counts) in the events panel header | `useActiveAlarms` |
| **Recent Events** | `RecentEventsPanel` — severity-sorted feed (type, vehicle, detail, relative time), rows deep-link `/map`, **View all → /alarms** | `useActiveAlarms` (notification-service) |
| **Fleet Health** | `FleetHealthPanel` — meters: device connectivity (ONLINE/total), GPS reporting (vehicles with fresh `updatedAt`/total), stale positions, offline devices | `useDeviceStatuses`, `useMapVehicles`, `useFleetStats` |

## 2. Components

**New (7):** `FleetDashboard.tsx` (composition), `DashboardCard.tsx` (TailAdmin widget chrome: header + loading/empty/error slots — replaces MUI `WidgetCard`), `KpiTile.tsx` (stat tile, tabular values, skeleton while loading), `ActivityStatusChart.tsx` (+ exported `countStates`), `FleetHealthPanel.tsx` (a11y meters), `RecentEventsPanel.tsx` (+ exported `sortAlerts`), `FleetMapPreviewCard.tsx`.

**Ported (1):** `AlertTypeBreakdownChart` — identical ECharts option; chrome → `DashboardCard`.

**Deleted (6):** `DashboardGrid`, `KpiCard`, `WidgetCard`, `ActiveAlertsPanel`, `StatCard` (unused recharts consumer), `FleetMapPreview` — all had no consumers outside the dashboard after the swap.

**Modified:** `pages/DashboardPage.tsx` (renders `FleetDashboard`), locales (new keys: `dashboard.stats.{moving,parked,activeDevices,activeAlarms}`, `dashboard.sections.{activity,health,events}`, `dashboard.health.*`, `dashboard.severities.{critical,warning,info}` — en+fa).

**Kept:** `EChart` wrapper (theme-aware), `LiveBadge` (already Tailwind; used by map chrome), `lib/map-markers`, all API modules.

## 3. API dependencies (unchanged)

`useFleetStats` (`fleet.stats` key) · `useMapVehicles` (`fleet.mapVehicles`) · `useActiveAlarms` (`fleet.alerts`) · `useDeviceStatuses` (`fleet.deviceStatuses`). Because FleetHealthPanel and the KPI row request the same query keys, React Query dedupes — the dashboard still issues the same small set of requests the old grid did (no N+1, no polling added).

## 4. Charts & maps

- **Charts:** ECharts via the existing theme-aware `EChart` wrapper (activity donut + alert-type rose). Dark-mode adaptation comes from the wrapper's `useThemeContext` integration. Recharts usage on the dashboard dropped to zero (`StatCard` deleted).
- **Maps:** MapLibre GL with free OSM raster tiles; the preview's init/marker/popup logic is byte-identical to the previous implementation — only the surrounding chrome changed. Markers tint by real presence; legend pairs color + label.

## 5. Tests — `dashboard.spec.tsx` (13, rewritten)

| Area | Assertions |
|---|---|
| Rendering | title/subtitle/live badges; KPI values for all 7 tiles from fixture query shapes |
| Loading | skeletons replace values while the summary loads |
| Errors | summary failure → ErrorState + Retry (click-through asserted); map-join failure → "Connection error" in activity + health + map (per-section isolation); alarm feed 403 → "Access denied" |
| Empty | no alarms → placeholder in events + type chart; no vehicles → placeholder in map + donut |
| KPI derivation | Moving/Idle/Parked counted from the map join (1/1/1 fixture) |
| Map | one MapLibre `Marker` per vehicle; legend labels render |
| Permissions | renders identically for empty-permission and `*` principals (dashboard deliberately ungated — backend authorizes each query; Phase-1 R9) |

**Suite: 245/245** (241 from Phase 3 + 13 new − 9 replaced old dashboard tests).

## 6. Performance considerations

- **No premature optimization**: no new memoization beyond `useMemo` on chart options and the `countStates` aggregation (O(n) per render of the vehicles array).
- **Query caching**: identical keys to before — React Query's 30s `staleTime` and dedupe apply; the dashboard issues no polling.
- **Map rendering**: imperative marker diffing unchanged (remove-and-recreate on data change — bounded by preview size); clustering intentionally left to the full map (supercluster, `lib/map-cluster`).
- **Lazy loading**: dashboard still statically imported like every page (Phase-1 monolithic-bundle note; route-level `React.lazy` remains a separate cross-cutting optimization).
- **Animations**: minimal — meter bar width transitions only; the aurora/glass animations of the old grid were dropped (calmer enterprise UX, fewer repaints).
- **Accessibility**: meters expose `role="progressbar"` with values; legends pair color+label; skeletons are aria-hidden; error/empty states announced.

## 7. Known limitations

1. **"Moving/Idle/Parked" are point-in-time** (current movement states), not a 24h series — no time-bucketed activity backend exists (`ActivityBucket` type has no fetcher). The donut is the honest view; a trend chart lands when the backend ships one.
2. **GPS availability** = "vehicle has a position timestamp" (fresh vs never-reported); a true GPS-signal-quality metric needs backend support.
3. **Export button removed** (was an inert placeholder on the old grid) — no backend export endpoint exists; will return wired to reporting-service CSV when enabled there.
4. **Recent Events = active alerts** (notification-service). Device/timestamped telemetry events beyond alarms aren't exposed by an API yet.
5. Map preview clusters nothing by design (see §4).

**STOP after Phase 4 — Phase 5 (Live Tracking) not started.**
