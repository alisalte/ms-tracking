# Current state

## Device / alarms

| Piece | State |
|-------|--------|
| Meitrack codes 52/53/54/82 | Mapped to `FUEL_FULL` / `FUEL_LOW` / `FUEL_THEFT` / `FUEL_FILLING` in `meitrack.codes.ts` |
| Kafka | `fleetvision.telemetry.alarm.raw` via device-gateway |
| Catalog type | All four → dashboard `fuel-theft` in notification-service |
| Tank % / liters in decode | **Not parsed** (AAA IO has odometer/battery, not fuel level) |
| C49 command | Configures device theft window/% in fleet-management catalog — does not store platform fuel rows |

## Services / data

| Piece | State |
|-------|--------|
| `fuel-management-service` | **Absent** under `apps/` |
| Fuel schema / migrations | Paper only (`fuel_cards`, `fuel_transactions`, …) |
| Distance aggregate | `GET /reports/distance`, `/reports/vehicle-meters` (trip `distance_km`) |
| Fuel UI | Alarm type label only; no report section |

## Patterns to reuse

- Domain events API: **fleet-service** (driver behavior style).
- Report section: `report-sections.ts` + `*Section.tsx` + reporting-service GET (geofences/schedules).
- Permissions: catalog + identity backfill (like `report.schedule`).
