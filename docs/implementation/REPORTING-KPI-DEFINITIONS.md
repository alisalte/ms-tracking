# Reporting KPI Definitions

Authoritative formulas for every Sprint J report/KPI. Every frontend number maps to one
of these backend definitions. Reporting is a **read layer** — sources are the
authoritative domain projections; nothing is re-derived from raw GPS except where
explicitly stated.

## Global conventions

- **Time range** — every report takes `preset=today|yesterday|7d|30d` XOR `from`/`to`
  (both → 400). Bound: `REPORT_MAX_RANGE_DAYS` (default **92**, documented deviation
  from the 31-day *history-track* policy: quarter-scale daily/weekly/monthly trends;
  still bounded). `from < to` enforced.
- **Boundaries** — start **inclusive**, end **exclusive** (`[from, to)`). No 23:59:59 hacks.
- **Timezone** — no tenant/user timezone column exists anywhere in the schema
  (verified). All bucketing/aggregation runs in **UTC** (`time_bucket('1 day', ts)` =
  UTC midnight boundaries); the UI labels timestamps as UTC and the date-picker
  converts the user's local wall-clock selection to UTC ISO before sending.
  Documented UI behavior, no silent mixing.
- **Tenant** — always from the verified JWT (`@CurrentTenant`); request tenantId is
  never read. Vehicle authorization = tenant scope (the platform's only
  vehicle-visibility model; no per-user vehicle ACL exists — no new membership invented).
- **Freshness** — every response carries `dataAsOf` (query start timestamp) and
  `freshness: 'AGGREGATED'` (or `NEAR_REALTIME` for overview, cached ≤30 s).
- **Missing vs zero** — a vehicle with no telemetry in range yields
  `observedDurationSec: null` and `utilizationPct: null` (never 0). Metrics derived
  from absent sources are `null`, not zero.
- **Retention** — positions are dropped after 180 days (Timescale policy). Reports
  that depend on live telemetry coverage cannot see beyond retention; trip/alarm/
  event projections are retained indefinitely (they are ordinary tables).

## Distance
`SUM(trip_events.distance_km)` over trips with `status='COMPLETED'` and
`started_at ∈ [from, to)`. Authoritative source: the GPS Engine trip FSM's
haversine accumulation with jump filter (`filteredDistanceStep`, cap 300 km/h,
dedupe < 1 m) — reporting never sums raw GPS deltas. `DISCARDED` micro-trips
(< 250 m) are excluded by definition of the FSM and counted separately as
`discardedTrips` where shown.

## Moving duration
`SUM(trip_events.duration_s)` over the same COMPLETED-trip set. Known
approximation (documented): a trip's duration includes stationary gaps shorter
than the trip stop-threshold (`GPS_TRIP_MIN_STOP_DURATION_S`, 300 s); these gaps
are not idle (ignition-off not observed) and not parking.

## Idle duration
`SUM(idle_periods.duration_s)` where `ended_at ∈ [from, to)` (only closed periods;
an in-progress idle window is excluded from historical sums). Source: idle FSM
(ignition on + speed ≤ 1 km/h ≥ 180 s).

## Parking duration
`SUM(parking_periods.duration_s)` where `status='ENDED'` AND
`ended_at ∈ [from, to)`. `TAMPER` periods are listed in the idle/parking report
but excluded from the duration sum.

## Offline duration
**Not reported.** No authoritative offline-period projection exists
(`tracking.device_status` is current-state only). Never approximated from
telemetry gaps.

## Observed duration (telemetry coverage)
Per vehicle: `LEAST(to, max(captured_at)) − GREATEST(from, min(captured_at))`
over valid positions (`quality = 1`) in range, clamped to the range; `null`
when the vehicle has no positions in range. Estimated gaps inside coverage are
not modeled — observed duration treats coverage as continuous between first and
last fix (documented limitation).

## Utilization
`utilizationPct = movingDurationSec / observedDurationSec × 100`, computed only
when `observedDurationSec > 0`, else `null`. Never divided by calendar time.

## Average speed
`SUM(distance_km COMPLETED) / (SUM(duration_s COMPLETED) / 3600)` (trip-derived,
distance-over-time — not the mean of instantaneous samples). `null` when no
completed trips.

## Maximum speed
`MAX(trip_events.max_speed_kmh)` over COMPLETED trips in range.

## Trip count
Count of `trip_events` with `status='COMPLETED'` and `started_at ∈ [from, to)`.
(DISCARDED counted separately; ACTIVE-in-progress excluded from historical counts.)

## Alarm count
Count of `notification.alerts` rows with `raised_at ∈ [from, to)` (Alarm Engine
records only — notification deliveries are never counted). Breakdowns by
`type`, `severity` (INFO/LOW/MEDIUM/HIGH/CRITICAL), `status`
(OPEN/ACKNOWLEDGED/RESOLVED), `vehicle_id`, and day (`raised_at`).

## Speeding event count
Count of `notification.alerts` with `type='overspeed'` in range. Reporting never
re-evaluates speed thresholds. "Time above limit" is **not reported** (no
authoritative per-point speeding-duration source).

## Geofence events
From `notification.fleet_events` (`event_type ∈ ('geofence.entered',
'geofence.exited', 'geofence.dwell')`, `occurred_at ∈ [from, to)`) — the Sprint I
authoritative pipeline (the evaluator's FleetEvents; raw
position-inside-geofence checks are never counted).
- ENTER/EXIT/DWELL counts by geofence (`metadata->>'geofenceId'`, name joined
  read-only from `tracking.geofences`), vehicle, day.
- **Time inside geofence** = `SUM((metadata->>'dwellSec')::numeric)` over
  `geofence.exited` events (the evaluator stamps each EXIT with the occupancy
  seconds; open occupancies are excluded).

## Activity timeline
Chronological UNION (bounded, keyset-paginated) of, per vehicle:
`trip_events` (TRIP_STARTED/TRIP_ENDED), `idle_periods` (IDLE),
`parking_periods` (PARKING), `fleet_events` geofence.* (GEOFENCE_ENTER/
GEOFENCE_EXIT/GEOFENCE_DWELL), `notification.alerts` (ALARM). Every row carries
`source` = the owning domain (`gps-engine.trips`, `gps-engine.idle`,
`gps-engine.parking`, `notification.fleet_events`, `notification.alerts`).
Where event sources do not exist (e.g., generic MOVING samples), they are
omitted rather than synthesized.

## Fleet overview state counts (period semantics)
- `totalVehicles` — `fleet.vehicles` with `status='ACTIVE'` (fleet registry).
- `vehiclesWithTelemetry` — distinct vehicles with ≥1 valid position in range.
- `noTelemetryVehicles = totalVehicles − vehiclesWithTelemetry` (labeled
  "No telemetry", not "offline" — no offline semantics claimed).
- `movingVehicles` — vehicles with ≥1 COMPLETED trip in range.
- `idleVehicles` / `parkedVehicles` — vehicles with ≥1 closed idle / parking
  period in range.
- `activeVehicles` — fleet-management's own notion is registry-status based;
  the overview reports `vehiclesWithTelemetry` and labels it exactly that.

## Cache
Fleet overview + trends: Redis, key `report:<report>:<tenantId>:<sha(filters)>`
(bounded 30 s TTL, includes tenant+filters). Cache = stale ≤ 30 s, documented;
everything else is computed on demand (AGGREGATED freshness).
