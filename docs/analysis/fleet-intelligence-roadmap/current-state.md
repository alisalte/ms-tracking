# Current state

Evidence from apps, modules, and project-memory (2026-09-08).

## Building blocks that exist

| Layer | Reality |
|-------|---------|
| Telemetry ingest | `device-gateway-service` (Meitrack / GT06 / JT808 → Kafka) |
| Positions / idle / trips | `gps-engine-service` FSMs |
| Geofences | CRUD + assign + enter/exit/**dwell** + geofence report |
| Alarms | `notification-service` (overspeed, idle, geofence, ignition, offline, DMS mapping, fuel-* device codes) |
| Fixed reports + CSV | `reporting-service` + `ReportsPage` |
| Drivers | CRUD + current `assigned_vehicle_id` only (no assignment history) |
| MDVR / DMS | Event 126 decode; C90 Parameter; opt-in D00/AB4 evidence |
| Map routing | OSRM `GET /route` → distance + `durationSec` (plan, not live ETA) |
| Maintenance UI | Stub + partner deep-links (`MaintenancePage`) |

## Per-capability status

| ID | Capability | Status | What exists today |
|----|------------|--------|-------------------|
| F-01 | Driver Behavior | **PARTIAL** | Overspeed + prolonged idle alarms; D79 harsh config on device; draft SRS `docs/requirements/driver-behavior-safety/`; no DrivingEvent store / Driver Score |
| F-02 | Fleet Health Score | **PARTIAL** | `FleetHealthPanel` = ONLINE/STALE/OFFLINE + reporting meters — **not** a scored health index |
| F-03 | Fuel Analytics | **MISSING** | Device codes + alarm type labels (`fuel-theft`, …); no fuel domain/service/tables (`FULL_PROJECT_FEATURE_MATRIX`: NOT STARTED) |
| F-04 | Geofence Intelligence | **PARTIAL** | Enter/exit/dwell + analytics report; **no** route/corridor compliance |
| F-05 | Report Builder | **PARTIAL** | Fixed KPI sections + CSV; **no** visual builder, schedule, PDF/XLSX job factory |
| F-06 | Predictive + CMMS | **MISSING** | UI stub; module docs only; no `vehicle-maintenance-service` / CMMS app |
| F-07 | AI Video Events | **PARTIAL** | DMS/ADAS decode + Alarm Center + manual evidence; auto capture SRS not approved; no cloud `video-ai-engine` |
| F-08 | Digital Twin | **MISSING** | No product/docs; live map/status is operational state only |
| F-09 | AI Fleet Assistant | **MISSING** | No requirements or code |
| F-10 | ETA Prediction | **PARTIAL** | Static OSRM duration in Route Planner; no live ETA events |
| F-11 | Optimization Engine | **MISSING** | OSRM point routing only; no VRP/dispatch optimizer |

## Explicit non-apps (still design-only)

Fuel, Compliance/ELD, Billing, native CMMS, `analytics-engine`, `video-ai-engine`, ClickHouse-backed ML feature store — see matrix + architecture docs.

## Related in-flight work (project-memory)

- Driver Behavior SRS — draft, blocked on approval
- MD300 DMS alarm media capture — SRS waiting approval
- Driver work / device / alarms — analysis waiting questions
- MDVR Parameter config — Alarm/Network/Tracking/Alerts/Media/AI slices shipped (partial)
