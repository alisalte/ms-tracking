# Proposed design — how to implement each

High-level approach only. Per-feature SRS/analysis still required before coding. Prefer reuse of existing services; spin new bounded contexts only when domain isolation demands it.

## F-01 Driver Behavior

1. Approve `docs/requirements/driver-behavior-safety/` + resolve assignment-at-event-time (`driver-work-device-alarms`).
2. **Sprint 1:** Normalize hard-brake (D79 / accel) + overspeed + idle into `DrivingEvent` (or alarm-derived facts); store with `driver_id` when resolvable; compute daily Driver Score.
3. **Sprint 2:** Ranking, driver dashboard widgets, notification hooks via existing notification path.
4. **Sprint 3:** Attach DMS/evidence + coaching after F-07 auto-capture lands.
5. Services: extend `notification-service` / `reporting-service` + fleet driver APIs; avoid new service until volume/ML justify `analytics-engine`.

## F-02 Fleet Health Score

1. Keep `FleetHealthPanel` as **connectivity** KPI.
2. Define score formula v1: connectivity freshness + open alarms severity + maintenance overdue (when CMMS exists) + optional DTC.
3. Persist `vehicle_health_score` snapshots (daily); fleet rollup = weighted average.
4. Ship **rule-based** score before ML; expose on Fleet Dashboard + vehicle detail.

## F-03 Fuel Analytics

1. New Fuel context per `docs/modules/Fuel-Management.md` (transactions, tank level events, exceptions).
2. Wire existing device fuel codes → fuel events + alerts (already labeled in alarm path).
3. Reports: consumption per km, refill anomalies; theft heuristic from drop-without-refill.
4. Hardware dependency: fuel sensor / CAN / card integration — product must pick data sources.

## F-04 Geofence Intelligence

1. Keep enter/exit/dwell as baseline (done).
2. Add **corridor / route geofences** + off-route detection once trips have planned polylines.
3. Analytics: dwell heat, time-in-zone by vehicle/driver, SLA breach rates.
4. Extend geofence report + Alarm Center filters; no separate product unless corridor model grows large.

## F-05 Report Builder

1. Phase A: **scheduled delivery** of existing fixed reports (cron + email/webhook) — highest ROI.
2. Phase B: template parameters (date range, fleet filter, columns) without full drag-drop.
3. Phase C: visual builder (REP-FR-07) + PDF/XLSX job factory — defer until templates prove demand.
4. Own in `reporting-service`; reuse auth `report.read` / new `report.schedule`.

## F-06 Predictive Maintenance + CMMS

1. **First:** replace `MaintenancePage` stub with work orders / DVIR / service schedules (`vehicle-maintenance-service` or deep CMMS sync).
2. Partner integrations (Pargar/Alka links already in UI) as interim write-path.
3. **Then:** feature extraction from GPS/engine hours/alarms → RUL / failure probability in analytics pipeline.
4. Do not market “predictive” until work-order history exists.

## F-07 AI Video Events

1. Approve & implement `md300-dms-alarm-media-capture` (auto photo + clip + retention + UI).
2. Ensure every DMS/ADAS alarm can show evidence without operator hunting files.
3. Optional later: cloud re-inference / quality scoring (`video-ai-engine`) — after on-device reliability is proven.
4. Keep privacy policy: persist frames only on alert (`VideoPlatform` / vision).

## F-08 Digital Twin

1. Product-define twin: **ops twin** (live state aggregate) vs **simulation twin**.
2. Recommended first slice: read-model aggregating vehicle + device + last trip + open alarms + health score into one API (`VehicleTwin` projection).
3. Full physics/sim twin is out of scope until ops twin + analytics exist.
4. Likely last among the eleven unless a specific customer demands it.

## F-09 AI Fleet Assistant

1. Guardrailed RAG over reporting + fleet + alarm query APIs; no free-form DB access.
2. Actions limited to existing commands (e.g. “show top risk drivers”) with RBAC.
3. Depends on F-01/F-05 data quality; ship after trusted metrics APIs.
4. New thin `assistant-service` or BFF; audit every prompt/action.

## F-10 ETA Prediction

1. Require active trip with destination / route polyline.
2. Recompute ETA on GPS ticks using OSRM live + historical speed factors; publish `tracking.route.eta.updated.v1`.
3. UI: live map + trip detail countdown.
4. ML ETA only after enough labeled arrival data.

## F-11 Optimization Engine

1. Requires stops, constraints, vehicle capacity/time windows (Trip/Route domain).
2. Start with external solver (OR-Tools / OSRM trip) behind `OptimizeRoute` API; store plans as trips.
3. Closed-loop re-optimize on traffic/ETA only after F-10.
4. Separate from map-engine’s single `GET /route`.
