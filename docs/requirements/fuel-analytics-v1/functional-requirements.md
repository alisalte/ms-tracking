# Functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | System SHALL persist fuel events with tenant, vehicle, time, kind, and volume or level delta when known. | Must |
| FR-02 | System SHALL accept fuel events from the **approved data source(s)** (see open questions). | Must |
| FR-03 | Authorized users SHALL create **manual refill** entries (volume, time, vehicle, optional cost/odometer). | Must |
| FR-04 | System SHALL list fuel events with filters: vehicle, date range, kind. | Must |
| FR-05 | System SHALL provide a **per-vehicle consumption summary** for a date range (liters in / estimated used / optional L/100km when distance available). | Must |
| FR-06 | System SHALL flag or list **rapid fuel drops** as anomalies (threshold configurable or documented default). | Must |
| FR-07 | Existing device codes `FUEL_THEFT` / `FUEL_LOW` / `FUEL_FULL` / `FUEL_FILLING` SHALL remain mappable to alarms; analytics SHOULD correlate or store matching fuel events when ingested. | Should |
| FR-08 | UI SHALL expose a Fuel analytics view (dedicated page or Reports section) — not alarm labels only. | Must |
| FR-09 | Users SHALL export summary (CSV) for the filtered range. | Should |
| FR-10 | All APIs SHALL enforce tenant isolation. | Must |
| FR-11 | Vehicles with no fuel data SHALL show empty state, not errors. | Must |

## Changelog

- 2026-09-09: Draft F-03 v1.
