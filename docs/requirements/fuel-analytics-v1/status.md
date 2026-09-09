# Status

| Field | Value |
|---|---|
| Feature | fuel-analytics-v1 (F-03 / Phase 2) |
| Phase | **Requirements Approved** |
| Complete? | Yes (SRS locked) |
| Analysis allowed? | **Yes** |
| Implementation allowed? | **No** (wait analysis approval) |

## Locked scope (stakeholder 2026-09-09)

- Events: refill / sudden drop / manual entry
- Consumption summary + L/100km when distance available
- Rapid-drop anomaly aligned with existing `FUEL_*` codes
- UI: Reports / Fuel surface; **no** WEX cards, stations, billing
- Phase 2 remainder: Fuel → Geofence corridor → ETA → Behavior Sprint 3

## Locked defaults

| # | Decision |
|---|----------|
| 1 | Data source: **device `FUEL_*` events + manual refill** (CSV later) |
| 2 | UI: **`/reports?section=fuel`** (+ catalog entry); dedicated `/fuel` optional later |
| 3 | Volumes: liters; cost optional; viewer `fuel.read` |
| 4 | Anomaly thresholds: refine in analysis — device `FUEL_THEFT` is primary signal (no tank % in decode today) |

## Changelog

- 2026-09-09: Requirements Approved (scope paste lock).
- 2026-09-09: Draft SRS created after CMMS skip.
