# Proposed design

## Placement

| Concern | Owner |
|---------|--------|
| `fuel_events` (+ optional `fuel_anomalies`) | **fleet-service**, schema `fleet` or dedicated `fuel` schema owned by fleet-service for v1 |
| Kafka consumer: alarm raw → fuel event rows for `FUEL_*` | fleet-service (or shared consumer) |
| Manual refill CRUD | fleet-service REST |
| Summary + L/100km | fleet-service **or** reporting-service calling fleet repo / SQL; prefer **reporting-service** `GET /reports/fuel` that reads fuel tables + trip distance (same pattern as geofences) |
| UI | `/reports?section=fuel` |

Do **not** create `fuel-management-service` in v1.

## Event model (v1)

```
FuelEvent {
  id, tenantId, vehicleId, deviceId?,
  kind: 'refill' | 'drop' | 'level' | 'manual',
  source: 'device' | 'manual',
  deviceCode?: 'FUEL_THEFT' | 'FUEL_FILLING' | 'FUEL_LOW' | 'FUEL_FULL',
  volumeLiters?: number | null,   // null for device markers without tank decode
  odometerKm?: number | null,
  cost?: number | null,
  occurredAt, createdAt, createdBy?
}
```

Mapping device → kind:
- `FUEL_FILLING` / `FUEL_FULL` → `refill`
- `FUEL_THEFT` / `FUEL_LOW` → `drop`
- Manual API → `manual` (counts as refill for summaries)

## Summary

- `litersIn` = sum(manual + refill with volume) in range  
- `litersDropped` = sum(drop with volume) if any  
- `distanceKm` = reporting distance aggregate  
- `lPer100km` = `(litersIn / distanceKm) * 100` when both &gt; 0 (document: without tank sensor this approximates “filled per distance”, not true burn rate)

## Anomaly

- Every ingested `FUEL_THEFT` is an anomaly row or flagged event; UI deep-links Notification Center / alarms filter `fuel-theft`.
- Threshold-based detection without tank samples is **deferred** (no level time series).

## Permissions

- `fuel.read` — list events, summaries, report section  
- `fuel.write` — manual entry  
- Seed fleet-admin both; optional viewer read
