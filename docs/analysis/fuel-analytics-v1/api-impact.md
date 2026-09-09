# API impact

## fleet-service

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET | `/api/v1/fleet/fuel/events` | fuel.read | Filters: vehicleId, from, to, kind |
| POST | `/api/v1/fleet/fuel/events` | fuel.write | Manual refill (volume required) |
| GET | `/api/v1/fleet/fuel/summary` | fuel.read | Optional; or only on reporting |

Internal: Kafka consumer on alarm.raw → insert device fuel events (idempotent by tenant+device+code+occurredAt±window).

## reporting-service

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET | `/api/v1/reports/fuel` | fuel.read **or** report.read+fuel.read | Per-vehicle: litersIn, distanceKm, lPer100km, dropCount |

Prefer requiring **`fuel.read`** so report section is gated correctly.

## identity / auth package

- Add `fuel.read`, `fuel.write` to permission-catalog + fleet-admin seed + backfill migration.

## Gateway

- Route `/api/v1/fleet/fuel/**` and `/api/v1/reports/fuel` (if not already covered by prefixes).
