# Database impact

## New (Slice B)

`fleet.driver_assignments`:

- `id`, `tenant_id`, `driver_id`, `vehicle_id`
- `started_at`, `ended_at` (null = current)
- `changed_by` (user id, nullable)
- indexes: `(tenant_id, driver_id, started_at)`, `(tenant_id, vehicle_id, started_at)`, unique open row per driver / per vehicle (partial unique where `ended_at is null`)

## Backfill

- One open row per driver with `assigned_vehicle_id` today (`started_at = assigned_at` or `now()`).

## Alarms (Slice D)

- Add nullable `driver_id` on alarm occurrence (notification / alarm store) + backfill best-effort from history if available.
