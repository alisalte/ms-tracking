# Sprint G — Alarm & Event Engine + Infrastructure Verification

**Status: COMPLETE** (with documented deferrals — see Known Limitations)
**Date: 2026-08-15**
**Scope: EVENT → RULE → ALARM → ALARM STATE → ALARM HISTORY → FRONTEND, on the real telemetry pipeline.**

---

## 0. What existed vs. what Sprint G did

The pre-sprint audit (Part 1) found the Alarm Engine **already exists** in
`notification-service` (rules/evaluators/occurrences/WS/REST, from the parallel-line
integration) — so Sprint G did **not** duplicate it. The audit found the engine was
**unwired and partially broken**:

| Finding (pre-Sprint-G) | Resolution |
|---|---|
| gps-engine trip/idle/parking FSM events never left the process (WS only) | **NEW** `TrackingEventProducer`: FSM signals → CloudEvents `tracking.event.v1` on `fleetvision.tracking.events`, deterministic ids |
| notification-service consumed only position + session topics — trip/idle/parking rules could never fire | Consumer subscribes the tracking-events topic; trip/idle/parking evaluators wired |
| Consumer used `deviceId` as vehicle identity (ignored the registry-sourced `vehicleId`, Sprint D §5) | Parser prefers `vehicleId`, falls back to `deviceId` (gps-engine semantics) |
| Raw gateway session states (`AUTHENTICATED`/`DISCONNECTED`) never matched the evaluator's `ONLINE` check → **device-recovery resolution could never fire** | Session states canonicalized at the parse boundary (integration-test finding) |
| No consumer-boundary validation; a malformed event was `JSON.parse`-cast | Strict envelope validation; `EventEnvelopeValidationError` → DLQ (non-retryable) |
| No retry/DLQ in the alarm consumer | Bounded retry + `<topic>.dlq` with forensic headers (Sprint D pattern) |
| `alerts` table missing the `version` column the repository writes; migration used `t.doublePrecision` (nonexistent in knex 3.1.0) — **the migration had never successfully executed anywhere** | Migration fixed; verified by the real-Postgres integration suite |
| Dedup was a time-window only — a 10-minute speed run could open an alarm per window | One-OPEN-alarm gate: while an OPEN alarm exists for (rule, vehicle, type), further detections **update its detail** (occurrenceCount/lastSeenAt) |
| No speeding recovery / device-online recovery | Auto-resolve (system actor, audited) when the condition clears |
| `notification.*` permissions absent from the shared catalog (only tenant-admin wildcard worked) | 8 permissions added + granted to fleet-admin/viewer system roles; frontend gating |
| Frontend WS hook dropped every alarm event (expected nested payload; gateway emits flat) | Hook maps the flat payload; ack/resolve buttons permission-gated |
| Geofence creation form-only (Sprint F deferral) | Map drawing UI (polygon + circle-as-polygon) on MapLibre |
| map-engine/OSRM/Nominatim absent from docker-compose (Sprint F §13) | map-engine service + opt-in OSRM/Nominatim compose profiles (G-0) |

---

## 1. Architecture

```
Device ──▶ device-gateway ──Kafka──▶ gps-engine ──┬─▶ positions hypertable (TimescaleDB)
                                   │             ├─▶ trip/idle/parking FSMs (Redis state)
                                   │             └─▶ SignalBus ──▶ TrackingEventProducer ──Kafka──┐
                                   │                                                              │
                                   └──(position.raw, session.lifecycle)──Kafka──▶ notification-service
                                                                                   │           ▼
                                                                       AlarmKafkaConsumer ◀──────┘
                                                                         (validation → idempotency
                                                                          → retry/DLQ → dispatch)
                                                                                    │
                                                                       AlarmEvaluatorService
                                                                       (rule cache → scope precedence
                                                                        → evaluators → dedup → raise/recover)
                                                                                    │
                                                          ┌─────────────────────────┼──────────────────────┐
                                                          ▼                         ▼                      ▼
                                              notification.alerts (PG)   notification.fleet_events   Alarm WS gateway
                                              alert_acknowledgements      (event history, PK=eventId)  (tenant rooms)
                                                                                    │
                                                                        REST: /alerts /rules /events ──▶ web-dashboard
```

Clean Architecture is preserved: domain (`apps/notification-service/src/domain`) is
framework-free; evaluators are pure functions; Kafka/PG/Redis live in `infrastructure`;
the gps-engine producer subscribes to the existing SignalBus without touching the FSMs
(Part 5: no GPS-engine algorithm changes).

## 2. Event model (FleetEvent)

`tracking.event.v1` CloudEvents envelope (`TrackingEventProducer`):

| Field | Source |
|---|---|
| `id` = `eventId` | **deterministic**: `<sourceEventId>:<eventType>` (triggering position's messageId + FSM event type); device-status: `dev:<deviceId>:<state>:<epochSec>` |
| `eventType` | `trip.started/ended`, `idle.started/ended/alert`, `parking.started/ended/tamper`, `device.online/offline/stale` |
| `tenantId` / `vehicleId` | trusted server-side pipeline context (never client input) |
| `occurredAt`, `severity`, `metadata` | event-specific (duration, distance, state) — **no Position duplication** |

Idempotency (Part 6): the deterministic eventId is consumed under Redis `SET NX`
(`tenant:<tid>:event_dedup:<eventId>`, 24 h) **and** persisted with
`INSERT … ON CONFLICT (id) DO NOTHING` — verified by the duplicate-redelivery
integration test.

## 3. Event types implemented / deferred

| Type | Status | Source |
|---|---|---|
| SPEEDING (`overspeed`) | ✅ | position.raw |
| GEOFENCE_ENTER / GEOFENCE_EXIT | ✅ | position.raw + PostGIS `ST_Covers` |
| IGNITION_ON / IGNITION_OFF | ✅ | position.raw `ignitionOn` |
| DEVICE_OFFLINE / DEVICE_ONLINE | ✅ | session.lifecycle (canonicalized) **+ gps-engine stale sweeper** via tracking.events |
| TRIP_STARTED / TRIP_ENDED | ✅ | gps-engine trip FSM (reused — not rebuilt) |
| IDLE (`prolonged_idle`) | ✅ | gps-engine idle FSM (`idle.ended` duration vs `minDurationSec`) |
| PARKING | ✅ | gps-engine parking FSM (`parking.ended` duration vs `minDurationSec`) |
| `low_battery` | **DEFERRED** | no battery telemetry field exists — the API now rejects such rules (never fabricate) |
| `geofence_dwell`, `excessive_stop_duration` | **DEFERRED** | no dwell/stop state tracking yet; API rejects (stored-but-never-firing rules are forbidden) |

## 4. Rule engine

- **Model**: `AlarmRule` (type, severity, enabled, entityType/entityId scope, conditions JSONB,
  cooldownSec, dedupWindowSec, repeatPolicy) — unchanged from the existing aggregate.
- **Configuration validation (Part 28)**: per-type strict Zod schemas (`thresholdKmh` +
  optional `gracePeriodSec`; `geofenceId: uuid`; positive durations). Unknown fields,
  unsupported types, and unconfigurable types are rejected at the API boundary (also on
  update, against the rule's type).
- **Scope precedence (Part 9)**: deterministic **vehicle > tenant**. Within one rule type,
  a vehicle-scoped rule shadows the tenant-wide rule for that vehicle; other vehicles keep
  the tenant-wide rule (unit-tested both ways). Fleet scope **deferred** — fleet membership
  lives in fleet-management-service and is not duplicated into the alarm engine.
- **Rule cache (Part 38)**: `listEnabled` Redis-cached (TTL `NOTIF_RULE_CACHE_TTL_SECONDS`,
  default 30 s), invalidated on every create/update/enable/disable/delete — a disabled rule
  stops triggering immediately, never later than the TTL.

## 5. Alarm lifecycle, dedup, recovery

- **Lifecycle**: OPEN → ACKNOWLEDGED → RESOLVED, plus OPEN → RESOLVED (validated
  transitions in the domain; RESOLVED → OPEN is illegal; reopening is not in the domain).
  Every transition appends an audit row to `notification.alert_acknowledgements`.
- **System auto-resolve**: null-actor (uuid-safe) with `[auto] <reason>`; metrics
  `alarms_resolved{actor="system"}`.
- **Dedup strategy (Part 12)** — three gates:
  1. **Redis time-window** (`dedupWindowSec`) — storm breaker; suppressed detections
     increment an occurrence counter, zero DB writes.
  2. **One-OPEN-alarm gate** — when the window expires but the condition persists and an
     OPEN alarm exists for (rule, vehicle, type), its `detail` is UPDATED
     (occurrenceCount/lastSeenAt/lastDetection) — a 150 km/h run produces exactly ONE row.
  3. **Event idempotency** — Kafka redeliveries skipped by eventId.
- **Speeding (Part 13)**: threshold + plausibility cap (>300 km/h GPS spikes never fire) +
  optional `gracePeriodSec` requiring sustained speeding (Redis window state).
- **Speeding recovery (Part 14)**: speed ≤ limit → auto-resolve the OPEN alarm + clear the
  grace window (re-raising requires a fresh sustained window — no flapping).
- **Geofence (Parts 15/16)**: PostGIS `ST_Covers` computed **once per position**; per-vehicle
  inside-set state in Redis; transitions require an actual set change — staying inside fires
  nothing; duplicate positions/jitter cannot flap.
- **Device offline/online (Part 17)**: authoritative backend state only (gateway session
  lifecycle + gps-engine stale sweeper via the tracking-events topic); ONLINE auto-resolves
  OPEN offline alarms; repeated ONLINE transitions are no-ops (no storm).

## 6. Kafka flow, schema, resilience (Parts 20–22)

- Topics: `fleetvision.telemetry.position.raw`, `fleetvision.telemetry.session.lifecycle`
  (unchanged) + **new** `fleetvision.tracking.events` (FleetEvent). No production topic was
  renamed. Consumer group `notification-service` (own group, independent from gps-engine).
- Envelope validation at the boundary; malformed = non-retryable → straight to DLQ;
  transient = `NOTIF_KAFKA_MAX_ATTEMPTS` bounded retries with exponential backoff; exhausted
  → `<topic>.dlq` with forensic headers (original topic/partition/offset, reason, error
  class, attempts, event-id). One bad event never throws to the kafkajs runner.
- Producer is idempotent, keyed by vehicleId (per-vehicle ordering), non-fatal at boot.

## 7. Persistence (Parts 23–24)

- PostgreSQL remains authoritative for alarms (`notification.alerts`,
  `alert_rules`, `alert_acknowledgements`) and now the **FleetEvent history**
  (`notification.fleet_events`, migration `20260815100000`, RLS-hardened, PK = eventId).
- Indexes: alerts (tenant+status, tenant+vehicle, tenant+severity, tenant+rule, all
  `raised_at DESC`), rules (tenant+enabled, tenant+type), fleet_events (tenant+time,
  tenant+vehicle+time, tenant+type+time). Redis holds only dedup/geofence/grace/rule-cache
  state.
- Migration repairs (found by the live-Docker integration run): `alerts.version` column
  added; `t.doublePrecision` → `t.double` (knex 3.1.0). The pre-existing migration had never
  successfully executed anywhere — both fixes are safe.

## 8. APIs (Parts 27/28/35)

All under `/api/v1/notification`, JWT + PermissionsGuard, tenant from the principal:

- `GET /alerts` (status/severity/vehicleId/from/to + cursor pagination), `GET /alerts/:id`,
  `POST /alerts/:id/acknowledge`, `POST /alerts/:id/resolve` — unchanged surface, now with
  user-action metrics.
- `GET|POST /rules`, `GET|PUT /rules/:id`, `POST /rules/:id/enable|disable`,
  `DELETE /rules/:id` — with per-type condition validation.
- **NEW** `GET /events` — FleetEvent history (vehicleId/type/severity/from/to + cursor
  pagination; permission `notification.event.read`). Position-derived detections are not
  double-stored — they are their alarms; positions remain in the gps-engine hypertable.

## 9. RBAC + tenant isolation (Parts 25/26)

- New shared-catalog permissions: `notification.alert.read/ack/resolve`,
  `notification.rule.read/create/update/delete`, `notification.event.read` — granted to
  `fleet-admin` (all) and `viewer` (read-only) system roles; tenant-admin keeps `*`.
- Tenant is always the verified JWT principal; every repository query is tenant-scoped
  (`withTenantContext` + RLS); WS rooms are `tenant:<tid>:alerts` only.
- Cross-tenant behavior is integration-tested (Scenario 4): B sees only B, cross-tenant
  `findById` returns null.

## 10. Frontend (Parts 29/32/44)

- **Alarm Center** (existing, real-first): fixed the realtime hook (flat payload mapping —
  previously every WS event was silently dropped), ack/resolve now gated by
  `notification.alert.ack/resolve` (UX-only; backend re-checks), list fetch passes
  server-side filters (status/severity/vehicleId/from/to).
- **Geofence drawing (Parts 33/34)**: `GeofenceDrawMap` — click-to-draw polygon (≥3
  vertices) or circle (center click + form radius, materialized as a 48-gon because the
  PostGIS polygon boundary is the operative alarm geometry). Existing geofences render
  read-only on the same map. Coordinates validated client-side; the backend re-validates +
  tenant-scopes. No new design system.

## 11. Observability (Part 36)

`notification-service` now exposes Prometheus `/metrics` (`MetricsModule`), with the Sprint G
counters (bounded label domains — tenant/vehicle ids are never labels):
`events_received/processed/failed`, `duplicate_events`, `rules_evaluated`,
`alarms_opened{type}`, `alarms_acknowledged/resolved{actor}`, `dlq_messages`,
plus the existing kafka produced/consumed/retry series extended with the `tracking`
topic. Structured logs carry `alarmId`/`ruleId`/`vehicleId`/`tenantId`/`eventId`; no
credentials are ever logged.

## 12. G-0 — Infrastructure verification

- **Deployment model confirmed** (docs/specs/08, ADR-021/022): OSRM and Nominatim are
  external, stateless, regionally deployed dependencies — NOT platform runtime components.
  Therefore they were **not** added to the default stack; each is an **opt-in compose
  profile** (`--profile routing` / `--profile geocoding`) with health checks, no hardcoded
  URLs (wired via `OSRM_URL`/`NOMINATIM_URL`), and documented resource requirements
  (OSRM needs a mounted `.osm.pbf`; Nominatim ≥2 GB RAM for import). No API keys committed.
- **map-engine** added to docker-compose (built from its new Dockerfile, port 3009,
  health-checked, DB+Redis deps). `docker compose config` validates.
- **Sprint F suites re-run against live Docker** (results below) — one legitimate finding:
  the old 200-row EXPLAIN seed made Seq Scan genuinely optimal; the seed is now a
  5,000-row bulk `generate_series` insert with ANALYZE, and the GiST assertions match
  TimescaleDB chunk-index names (`_hyper_*_chunk_ix_positions_geom_gist`).

## 13. Failure recovery (Part 39)

Guarantees (by construction + Sprint D lineage, exercised in the integration suite):
Kafka down at boot → service starts, REST/WS serve existing data, consumer reconnects;
Kafka redelivery → event-id dedup + idempotent projections (no alarm explosion);
PostgreSQL down → bounded retries then DLQ (no silent loss — the DLQ is the audit trail);
Redis down → dedup/grace/geofence state fail open (worst case a duplicate alarm, never a
missed one); GPS-engine restart → FSM state is Redis-backed (Sprint D), producer is
idempotent; alarm-engine restart → consumer group resumes at committed offsets.

## 14. Tests (Parts 41–43)

**Unit** (`apps/notification-service`, `apps/gps-engine`):
- `sprint-g-alarm-engine.spec.ts` (16): overspeed raise/grace/recovery/one-open-dedup,
  geofence enter/stay-inside/exit, device offline/online/no-storm, disabled rule, scope
  precedence (both directions), tenant isolation, trip/idle/parking rules.
- `sprint-g-validation.spec.ts` (21): envelope parsing (identity fallback, malformed
  rejection, forward-compat null), session canonicalization, per-type rule DTO validation.
- `alarm-evaluator.spec.ts` (14): evaluator matrix incl. plausibility cap, idle/parking,
  Redis SET-NX contracts.
- `alarm-domain.spec.ts` (unchanged, 10): lifecycle transitions.
- `tracking-event-producer.spec.ts` (5, gps-engine): deterministic ids, envelope shapes,
  signal-bus fan-out.

**Integration (live Docker: real Kafka + PostgreSQL/PostGIS + Redis)** —
`sprint-g-alarm-pipeline.integration.spec.ts` (6): the four Part 43 acceptance scenarios
(speeding E2E incl. no-duplicate + auto-resolve; geofence one-transition; device
offline→online; tenant isolation) + duplicate-eventId idempotency. Graceful skip without
Docker.

**Sprint F suites against live Docker**: EXPLAIN 6/6; gps-engine integration 5 suites /
26 tests PASS (serial; parallel workers contend on throwaway-DB creation — run with
`--runInBand`, as the root `--workspace-concurrency=1` already does).

**Browser E2E (Part 44)**: **BLOCKED/DEFERRED** — no browser automation (Playwright/
Cypress) exists in the repo and no full compose stack of all services runs locally; the WS
payload fix is covered by unit tests + the live WS gateway contract, not by a real browser
session. Not claimed as passed.

## 15. Verification results (executed 2026-08-15)

| Check | Command | Result |
|---|---|---|
| Build | `pnpm build` | ✅ clean |
| Typecheck | `pnpm typecheck` | ✅ clean |
| Tests | `pnpm test` | ✅ all workspaces green (~570 tests, incl. 89 notification + 174 web) |
| Sprint F EXPLAIN (live Docker) | jest `sprint-f-spatial-explain` with `GPS_TEST_DBURL=…:15432` | ✅ 6/6 |
| gps-engine integration (live Docker) | jest `integration/ --runInBand` | ✅ 5 suites / 26 tests |
| Sprint G integration (live Docker) | jest `sprint-g-alarm-pipeline` | ✅ 6/6 |
| Lint | `biome check` on all changed files | ✅ clean |
| Lint (full repo) | `pnpm lint` | ⚠️ fails on **untouched** files — Windows `core.autocrlf=true` makes the whole working tree CRLF while biome demands LF (pre-existing environment condition, not introduced by Sprint G; CI/LF checkouts are unaffected) |
| Docker compose | `docker compose config --services` | ✅ validates (map-engine included) |

## 16. Known limitations / Deferred features

- Notification Center (SMS/email/push providers) — **deferred by charter** (Part 31). The
  email channel exists only as the optional SMTP dispatcher path; no providers built.
- Browser E2E — blocked (above).
- Fleet-scoped rules, `geofence_dwell`, `excessive_stop_duration`, `low_battery` — deferred
  (documented above).
- FleetEvent history keeps FSM/device events only; position-derived detections are
  represented by alarms (no double storage by design).
- gps-engine trip/idle/parking events are best-effort published (drop+count on broker
  outage) — derived data; positions/trips remain durable in PG.
- The events REST surface is notification-service-scoped (`/api/v1/notification/events`).

## 17. Files changed (Sprint G)

**gps-engine-service**: `src/infrastructure/kafka/tracking-event-producer.ts` (new),
`src/api/gps-engine.module.ts`, `src/api/tokens.ts`, `src/application/signal-bus.ts`
(off-handles), `src/config/gps-engine.config.ts`,
`src/__tests__/tracking-event-producer.spec.ts` (new),
`src/__tests__/integration/sprint-f-spatial-explain.integration.spec.ts` (realistic seed).

**notification-service**: `src/application/alarm-evaluator.service.ts`,
`src/application/evaluators/{evaluators,rule-evaluator}.ts`,
`src/infrastructure/kafka/alarm-kafka-consumer.ts`,
`src/infrastructure/kafka/envelope-validation.ts` (new),
`src/infrastructure/kafka/alarm-dlq-producer.ts` (new),
`src/infrastructure/cache/alarm-state-cache.ts`,
`src/infrastructure/persistence/{alarm-occurrence,alarm-rule,fleet-event}.repository.ts`
(fleet-event new),
`src/infrastructure/database/migrations/20260301000000_create_notification_schema.js`
(repair), `src/infrastructure/database/migrations/20260815100000_create_fleet_events.js`
(new), `src/api/{alarms,rules,events}.controller.ts` (events new),
`src/api/notification.dto.ts`, `src/api/notification.module.ts`, `src/app.module.ts`,
`src/config/notification.config.ts`, `src/domain/alarm-occurrence.ts`,
`src/__tests__/{alarm-evaluator,sprint-g-alarm-engine,sprint-g-validation}.spec.ts`,
`src/__tests__/integration/{db.ts,sprint-g-alarm-pipeline.integration.spec.ts}` (new).

**web-dashboard**: `src/auth/permissions.tsx`, `src/hooks/useAlarmRealtime.ts`,
`src/api/alarm.api.ts`, `src/components/alarms/AlarmDetailDrawer.tsx`,
`src/components/geofences/GeofenceDrawMap.tsx` (new), `src/pages/GeofencePage.tsx`,
`src/__tests__/alarms.spec.tsx`.

**packages**: `auth/src/permission-catalog.ts`, `observability/src/metrics/telemetry-metrics.ts`.

**infra**: `docker/docker-compose.yml`, `docker/.env.example`,
`apps/map-engine-service/Dockerfile` (new).

## 18. Recommended next sprint

1. Browser E2E harness (Playwright) against the compose stack — unblocks Part 44 verification.
2. Fleet-scoped rules (join fleet membership via an internal API/replica read).
3. `geofence_dwell` + `excessive_stop_duration` evaluation state.
4. Notification Center (providers, preferences UI) — per the roadmap, after Sprint G.
