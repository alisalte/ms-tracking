# Implementation plan

## Slice 1 — Persistence + manual (foundation)

1. Migration `fuel.fuel_events` (+ grants/RLS).
2. Domain + repository + `POST/GET` events on fleet-service.
3. Permissions catalog + identity backfill.
4. Unit tests for create/list/tenant isolation.

## Slice 2 — Device ingest + summary report

1. Kafka consumer: `FUEL_*` → fuel_events (volume null).
2. `GET /reports/fuel` joining distance.
3. Dedup / idempotency for redelivered alarms.

## Slice 3 — UI

1. Reports section `fuel` + FuelSection (list, KPIs, manual form, CSV export optional).
2. i18n + permission gates + empty state.
3. Dashboard tests (vitest) for section render.

## Out / later

- Tank % decode in Meitrack IO.
- Threshold anomaly without device event.
- fuel-management-service / cards.
- Dedicated `/fuel` page.

## Suggested order of work

Slice 1 → 2 → 3 (can overlap UI mock with Slice 1 API).

## Effort

~M (medium): one Nest domain + report endpoint + one report section; **no** new microservice.
