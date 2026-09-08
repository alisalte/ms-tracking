# Proposed design

## Principle

**Driver ↔ device is always via vehicle.** Device never “belongs” to a driver; assignment history is driver↔vehicle; device at time T = devices bound to that vehicle at T (or current binding if device history is out of scope).

## Slice A — Truthful current view (fast)

- Driver detail: current vehicle + device list + link to map/alarms filtered by vehicle.
- Fix report copy to say metrics are for **currently assigned vehicle**, not true driver-hours — or hide until Slice B.

## Slice B — Assignment history (foundation)

- Table `fleet.driver_assignments` (or append-only events): `driver_id`, `vehicle_id`, `started_at`, `ended_at`, `changed_by`.
- Assign/unassign closes previous open interval and opens a new one.
- API: `GET /fleet/drivers/:id/assignments?from&to`.
- UI: timeline on driver detail.

## Slice C — Work attributed to driver

- For range `[from,to]`, intersect assignment intervals with trip/meter segments (vehicle-time series already exist).
- Aggregate movingSec, idleSec, distanceKm, trips **per driver**.
- Report Drivers section switches to this aggregation.

## Slice D — Alarms attributed to driver

- Prefer: on alarm raise, stamp `driverId` from active assignment for `vehicleId` (denormalized).
- Fallback query: alarms for vehicles in assignment intervals overlapping `raisedAt`.
- UI: “Alarms” tab/section on driver detail + Alarm Center filter `driverId`.

## Slice E (optional) — Duty / HOS

Only if product requires regulatory duty clocks; otherwise treat “work” as moving/idle/distance from tracking.
