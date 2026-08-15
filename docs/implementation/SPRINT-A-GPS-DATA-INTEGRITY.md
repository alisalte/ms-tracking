# Sprint A — GPS Engine Data Integrity & Persistence Hardening

**Scope:** `apps/gps-engine-service` only (code, migrations, tests, config).
**Status:** Complete. typecheck ✓ · build ✓ · test ✓ (72 tests, incl. 10 PostgreSQL integration) · lint ✓.

This sprint fixed every P0 data-integrity defect in `gps-engine-service`. During
the work, four additional root-cause defects were discovered that **blocked the
stated goals** (the persistence layer could not run at all); each is documented
below with its fix. No other service was modified.

---

## 1. Problems Found & Root Causes

### A. `completeTrip()` used `UPDATE … ORDER BY … LIMIT` (invalid in PostgreSQL)
The repository built the close query with `.orderBy('started_at','desc').first().update(...)`,
which Knex compiles to `UPDATE … ORDER BY … LIMIT` — a MySQL-ism PostgreSQL
rejects. Any trip close would throw.

### B. Orphan ACTIVE micro-trips
The trip FSM emitted `trip.started` (→ an `ACTIVE` row) on movement, then
discarded micro-trips (below `min-trip-distance`) **silently** — emitting *no*
event. The `ACTIVE` row was therefore never reconciled and stayed `ACTIVE`
forever.

### C. Engine-hours were computed then discarded
`advanceEngineHours` produced a flush value on each ignition-off edge, but
`TripEngine` did `void engineHoursFlushed;` and there was no durable sink.
Engine hours were not persisted anywhere.

### D. No TimescaleDB retention / compression on `vehicle_positions`
The hypertable (Sprint 7) had no compression or retention policy, so the
append-only time-series grew unbounded (spec 03 §11.1/§11.2 mandates both).

### E–H. Root-cause defects that blocked goals A–D (discovered during Sprint A)

These four pre-existing defects meant **the gps-engine migrations had never
successfully applied to any database** (the running `fleetvision` DB had no
`tracking` schema), so none of the persistence layer actually functioned:

| # | Defect | Effect | Fix |
|---|--------|--------|-----|
| E | `t.doublePrecision(...)` is not a knex pg method (MySQL-only) | Position + trip migrations throw at `createTable` | Replaced with `t.double(...)` → identical SQL `double precision` |
| F | `vehicle_positions` PK was `event_id` alone; hypertable partitioned by `captured_at` | TimescaleDB: "cannot create a unique index without the column captured_at" — `create_hypertable` fails | Composite PK `(event_id, captured_at)` (idiomatic Timescale) |
| G | FSM state is JSON-serialized to Redis; `Date` fields (`tripStartAt`, `lastMovingAt`, `idleStartAt`, `parkedAt`) return as ISO strings | `state.*.getTime()` throws on the **2nd position of every trip** → caught/swallowed by the engine → trips never close (root cause of orphans, goal B) and engine-hours never flush (goal C) | Revive `Date` fields at the cache-hydration boundary in `TripEngine` |
| H | TimescaleDB forbids compression on a table with Row-Level Security enabled | Sprint 7 attached a *permissive* (`USING true / WITH CHECK true`) RLS policy to `vehicle_positions`; enabling compression throws "columnstore cannot be used on table with row security" | The Sprint A policies migration drops the no-op RLS stub + disables RLS so compression can apply (down() restores it) |

---

## 2. Implementation

### `completeTrip` — deterministic, tenant-safe, PostgreSQL-correct (`trip.repository.ts`)
Now targets a single row by `id` selected via a tenant-scoped subquery:

```sql
UPDATE tracking.trip_events SET …
WHERE id = (
  SELECT id FROM tracking.trip_events
   WHERE tenant_id = ?::uuid AND vehicle_id = ?::uuid AND status = 'ACTIVE'
   ORDER BY started_at DESC, id DESC   -- deterministic tie-break
   LIMIT 1
)
```

- Tenant-safe (tenant_id in both outer + subquery filters).
- Deterministic (`started_at DESC, id DESC` tie-break — correct when multiple
  `ACTIVE` rows exist; closes the newest).
- Transaction-safe: the single `UPDATE` is atomic in PostgreSQL (no explicit
  transaction needed).
- No SQL injection (bound parameters).
- Returns `TripTransitionResult { updated }` — `updated: 0` is the graceful
  "no active trip found" result (no throw).
- **Concurrency-safe (§14):** the outer `WHERE status = 'ACTIVE'` guard makes a
  close robust against a concurrent duplicate close. Under READ COMMITTED, a
  second worker that selected the same row before the first commits re-checks
  this predicate at row-lock time, finds the row already `COMPLETED`, and updates
  0 rows instead of overwriting — exactly-once close even under Kafka
  redelivery/rebalance. (`discardTrip` uses the same guard.)

### Orphan ACTIVE micro-trips — `trip.discarded`
- New domain event `TripDiscardedEvent` (`domain/trip/trip-types.ts`).
- `closeTrip()` now **emits `trip.discarded`** (reason `MICRO_TRIP`) instead of
  emitting nothing. This reuses the `DISCARDED` status **already present** in the
  `trip_events` check constraint — no new status or schema column was introduced
  (the discard *reason* is carried in the domain event but not persisted to a
  column; today the only reason is `MICRO_TRIP`).
- New `TripRepository.discardTrip()` transitions the newest `ACTIVE` row to
  `DISCARDED` using the same deterministic subquery as `completeTrip`. Idempotent
  (a repeat discard finds no `ACTIVE` row → `updated: 0`).
- `TripEngine` persists `trip.discarded` but does **not** signal it to WebSocket
  clients (internal bookkeeping); only `trip.started`/`trip.ended` are signaled.

### Engine-hours durable persistence — `tracking.engine_hours`
- New domain event `EngineHoursFlushedEvent` (`durationSec`, `windowStart`,
  `windowEnd`, `engineHours`, `sourceEventId`).
- `TripEngine` builds the event on flush. `window_start` is **exact**: the Δt
  accumulator telescopes, so `windowStart = windowEnd − durationSec`.
- New `TripRepository.insertEngineHours()` inserts the window. **Idempotent**:
  `source_event_id` (the flush-trigger position's `messageId`) is the unique key
  → Kafka redelivery inserts nothing on the second pass (`ON CONFLICT DO NOTHING`).

### TimescaleDB retention + compression (env-configurable)
New migration `20260813110000_add_vehicle_positions_timescale_policies.js`:
- `ALTER TABLE … SET (timescaledb.compress, compress_segmentby='vehicle_id',
  compress_orderby='captured_at DESC')`.
- `add_compression_policy(…, INTERVAL '7 days', if_not_exists => TRUE)`.
- `add_retention_policy(…, INTERVAL '180 days', if_not_exists => TRUE)`.
- Drops the permissive RLS stub + disables RLS first (defect H).
- Intervals default to the spec's 7d / 180d but honor
  `GPS_POSITIONS_COMPRESS_AFTER_DAYS` / `GPS_POSITIONS_RETENTION_DAYS` (validated
  positive integers; the inlined value is coerced → injection-safe). Intervals
  apply at first run; changing them later requires `alter_job` or a new migration.
- Validated against TimescaleDB 2.29 (the `timescale/timescaledb-ha:pg16` image).

### FSM Date revival (defect G)
`TripEngine` now revives `Date` fields when hydrating FSM snapshots from Redis
(`reviveTripState` / `reviveIdleState` / `reviveParkingState` + `asDate`). The
pure FSMs are unchanged and continue to work with `Date` objects.

### Observability (§17)
`TripEngine.persistEvents` emits structured logs (Nest `Logger`, no
secrets/payloads) for the two noteworthy non-error cases: a micro-trip discard
(`debug`) and a `completeTrip` that found no `ACTIVE` trip (`warn`). Database
failures (failed close / engine-hours insert) propagate as throws to
`TripEngine.process`'s existing per-position handler, which logs the error and
lets the pipeline's offset advance — the project's established resilience
convention (§18). No errors are swallowed inside the repository.

### Transaction boundaries (§13)
No new transactions were introduced. Each repository write is a single atomic
statement (`UPDATE … WHERE id = (subquery)`, or an idempotent `INSERT … ON
CONFLICT DO NOTHING`), so it is inherently atomic. Trip-close and engine-hours
flush are independent events and intentionally not wrapped in a shared
transaction (the engine's persist contract is best-effort per event).

---

## 3. Database Changes

### New table: `tracking.engine_hours` (migration `20260813100000`)
| column | type | notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid | tenant scope |
| `vehicle_id` | uuid | device id (Sprint 7 naming) |
| `window_start` | timestamptz | exact (`window_end − duration_s`) |
| `window_end` | timestamptz | flush-trigger position `captured_at` |
| `duration_s` | integer | authoritative engine-on seconds |
| `engine_hours` | decimal(10,4) | derived hours (`duration_s/3600`) |
| `source_event_id` | uuid | idempotency key (UNIQUE) |
| `created_at` | timestamptz | |

Indexes: `UNIQUE(source_event_id)`; `(tenant_id, vehicle_id, window_end DESC)`.
RLS enabled with a permissive policy (matches sibling projection tables).

### New policies on `tracking.vehicle_positions` (`20260813110000`)
Compression (`segmentby vehicle_id`, `orderby captured_at DESC`) + 7-day
compression policy + 180-day retention policy. Permissive RLS stub removed.

### Corrected existing migrations
- `20260806100000` (position): `t.doublePrecision` → `t.double`; PK is now
  composite `(event_id, captured_at)`.
- `20260806110000` (trip): `t.doublePrecision` → `t.double`.
- `PositionRepository.insert`: conflict target is now the composite PK
  `(event_id, captured_at)`.

> **Deployment note:** because the gps-engine migrations had never applied, no
> data migration of existing rows is needed — the schema is created fresh. If a
> partial/non-standard deployment exists, run `knex migrate:rollback` / `latest`.

---

## 4. Test Coverage

All gps-engine tests pass: **12 suites / 72 tests**.

New / changed tests:
- `trip-fsm.spec.ts` — micro-trip now asserts `trip.discarded` is emitted (with
  `reason MICRO_TRIP`, correct distance/started/ended fields); still asserts no
  `trip.ended`/`stop.detected`.
- `trip-engine.spec.ts` *(new)* — unit-tests the engine's persistence wiring with
  hand-rolled fakes (repo, caches): micro-trip → `discardTrip` (not
  `completeTrip`); engine-hours flush → `insertEngineHours` with exact fields;
  `trip.discarded` is persisted but not signaled.
- `__tests__/integration/trip-persistence.integration.spec.ts` *(new)* — real
  PostgreSQL + TimescaleDB, via a throwaway database (`fleetvision_gps_int_test`)
  created inside the running Postgres; applies the real migrations and **skips
  gracefully** when no DB is reachable. Covers all required scenarios:
  1. start trip → complete trip (ACTIVE→COMPLETED, fields written);
  2. multiple ACTIVE trips → newest closed, older left ACTIVE;
  3. no active trip → `completeTrip` returns `updated:0` (no throw);
  4. **(concurrency/idempotency, §14)** repeat `completeTrip` with a different
     `ended_at` → `updated:0` and the row is not overwritten;
  5. **(timestamps)** completion preserves `started_at`, writes `ended_at`;
  6. micro-trip → `discardTrip` leaves no orphan ACTIVE (→ DISCARDED);
  7. (idempotency) repeat `discardTrip` → `updated:0`;
  8. engine-hours flush → durable persistence with exact fields;
  9. (idempotency) repeated engine-hours insert → 1 row;
  10. tenant isolation → tenant B's `completeTrip` never touches tenant A.

Run integration explicitly:
```bash
pnpm --filter @fleetvision/gps-engine-service test -- --testPathPattern='integration'
```
Point at a different server with `GPS_TEST_DBURL`.

---

## 5. Architectural Decisions

- **DISCARDED over DELETE for micro-trips.** The `DISCARDED` status was already
  in the `trip_events` check constraint, so it is the model's natural fit and
  preserves audit history (a trip candidate started but was discarded). No new
  status or column was introduced.
- **Engine-hours stored as both integer seconds and decimal hours.** `duration_s`
  is the exact authoritative value; `engine_hours` (decimal(10,4)) is a
  convenience for reporting. No precision is lost.
- **Retention/compression via env vars at migration time.** Migrations run once,
  so the intervals are baked at first apply (the documented source-of-truth is
  7d/180d). Runtime tuning uses `alter_job`; a new migration is the audited path.
- **Local PostgreSQL integration tests over Testcontainers.** The repo already
  runs the exact `timescale/timescaledb-ha:pg16` image; the "smallest correct
  setup" is a throwaway database in that instance with graceful skip elsewhere —
  no new dependency added.

---

## 6. Remaining Limitations

- **Genuine hypertable tenant isolation is deferred.** A hypertable cannot have
  *both* RLS and compression. Today tenant isolation for `vehicle_positions` is
  enforced at the repository layer (every query filters by `tenant_id`); the
  permissive RLS stub was removed to enable compression. Real RLS-based
  isolation for the hypertable is a later cross-cutting concern.
- **Engine-hours `window_start` depends on continuous Δt.** It is exact when
  positions stream continuously while ignition is on; a long unobserved gap
  inside an ignition-on window is counted only between observed positions (the
  Δt accumulator's inherent behavior).
- **Space partitioning drift (pre-existing).** The position hypertable still
  omits the spec's `number_partitions`/`partitioning_column` space partitioning;
  adding it to an existing hypertable is not supported in place — left for a
  future sprint (out of Sprint A scope).
- **`tsconfig.json` root references** still omit `apps/gps-engine-service`
  (pre-existing). `pnpm -r run typecheck`/`test`/`build` still cover it; root
  `pnpm build` does not. Not changed to avoid unrelated edits.
