# FleetVision TailAdmin Migration — Phase 8: Reporting & Analytics

**Date:** 2026-08-18
**Scope:** `apps/web-dashboard` reporting (`/reports`)
**Result:** 264/264 unit tests · typecheck ✅ · lint ✅ (all touched files) · production build ✅. `api/report.api.ts` byte-unchanged — every number remains a backend KPI.

---

## 1. Report categories (exactly what the backend ships — nothing invented)

| Backend report (`/reports/*`) | Section / tab | Notes |
|---|---|---|
| `fleet-overview` | Overview — 11 KPI cards + 3 charts | totals, telemetry coverage, moving/idle/parked, distance, trips, alarms (incl. open), geofence events, avg utilization (null → "—", never a fake 0) |
| `trend` | Overview — distance/trips combo + stacked alarm trend | per-day series |
| `vehicle-utilization` | Vehicles → Utilization (+ detail modal, CSV export) | moving/idle/parking/observed seconds |
| `distance` | Vehicles → Distance | mileage: total/avg/max trip km, discarded trips |
| `speed` | Vehicles → Speed | avg/max speed + speeding alarms |
| `idle-parking` | Vehicles → Idle & Parking | IDLE/PARKING kind filter |
| `trips` | Trips | cursor-bounded rows, View-on-Map deep link, CSV export |
| `alarms` | Alarms | severity summary chips, severity filter, View Alarm link, CSV export |
| `geofences` | Geofences | enter/exit/dwell counts + time inside |
| `activity` | Activity | unified event timeline (source domains never conflated) |

**Not present in the backend (deliberately not built):** driver-activity and device-status reports — the reporting service exposes no such endpoints; no client-side substitute was fabricated.

## 2. What was built

- **`ReportsTable`** (new shared TailAdmin table): same column-def contract as the legacy MUI DataTable (`id`/`headerKey`/`header`/`render`), rendered with the tailwind Table kit, plus **client-side sorting** (header click toggles asc/desc on the rendered value; the server remains the source of truth for rows), keyboard-activatable rows (`onRowClick`), and the honest empty state.
- **All 8 files ported to TailAdmin:** `ReportsPage` (section tabs with `report-section-*` testids), `ReportRangePicker` (preset chips + custom UTC datetime, `report-range-custom/apply` testids), `ReportsOverviewSection` (KPI cards `report-kpi`, freshness line, ECharts unchanged), `VehiclesSection` (4 sub-tabs incl. `report-tab-utilization`, detail modal, `report-export-utilization`), `TripsSection` (vehicle select, `report-export-trips`, `report-trip-view-map`), `AlarmsSection` (summary badges, `report-severity-filter`, `report-export-alarms`, `report-alarm-view`), `GeofencesSection`, `ActivitySection` (`report-activity-list`).
- **Export = backend only.** `exportReportCsv` (authenticated blob from `/reports/export/*`) unchanged — no client-side export was added. **New:** every export button is now wrapped in `PermissionGate requires={PERMISSIONS.reportExport}` — the export buttons reflect the permission the backend enforces on the export endpoints.
- **Every report keeps its four states:** loading (spinner/loading line), empty (`reports.empty`), error (ErrorState + retry), generated; export adds its own exporting state.

## 3. Analytics visualizations

Overview keeps the three real charts (distance+trips combo, stacked alarm trend by type, vehicle-state distribution donut) via the shared theme-aware `EChart` wrapper — dark-mode adaptive, loading/empty/error states per chart.

## 4. Tests (264/264; +2 this phase, 10 ported)

| Area | Assertions |
|---|---|
| Wire hooks (3) | preset param, custom from/to + vehicle filter (never both), CSV blob with filters — unchanged, green |
| Overview (3) | real KPI numbers on cards, null utilization honesty, error state |
| Range picker (2) | preset switching, custom UTC ISO + from≥to rejection |
| Trips (2) | rows + View-on-Map href (exact deep link), CSV export with active filter |
| **Phase 8 sorting (new)** | header click sorts asc, second click desc (DOM order asserted) |
| **Phase 8 permissions (new)** | export button hidden without `report.export`, revealed when granted |
| e2e compatibility | all `report-*` testids preserved (`kpi`, `freshness`, `range-apply`, `range-custom`, `severity-filter`, `trip-view-map`, `export-trips`) — the e2e CSV byte-for-byte download test is unaffected |

Two spec adjustments moved with their components (native select options now render in the DOM → `getAllByText`; export requires `report.export` → granted in `beforeEach`, gate itself now tested).

## 5. Security

Route stays gated `report.read`; exports now additionally gated `report.export` in the UI (backend re-checks on every call); tenant isolation unchanged (same API tenant header); no permissions hardcoded.

**STOP after Phase 8.**
