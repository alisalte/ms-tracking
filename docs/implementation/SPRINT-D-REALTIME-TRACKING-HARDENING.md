# Sprint D — Real-Time Tracking & Production Telemetry Hardening

**Scope:** `device-gateway-service`, `gps-engine-service`, `fleet-management-service`
(registry-invalidation hooks only), `packages/observability` (metrics), `packages/health`
(readiness extension). Tests, migrations, config. **Status: COMPLETE.**
typecheck ✓ · build ✓ · test ✓ (494 backend + 107 web) · lint ✓.

The objective was reliability of the EXISTING telemetry vertical
(device → gateway → registry → Kafka → GPS engine → TimescaleDB → Redis → WebSocket),
not new business modules. Every change below hardens, verifies, or observes that vertical.

---

## Current Architecture (audited, verified in source)

```
Physical Device (GT06/JT808/Meitrack/stub binary over TCP/UDP)
  ↓ real net.Server / dgram framing, idle timeouts, bounded drain
device-gateway-service — PacketDispatcher (decode → validate → auth/resolve → normalize → publish)
  ↓ AuthResolver L1 (LRU 30s) → L2 (Redis 5m) → L3 HttpDeviceRegistry → fleet-management
  ↓ DeviceGatewayKafkaProducer (idempotent, keyed by device_id, CloudEvents JSON)
Kafka (fleetvision.telemetry.{position,alarm,device}.raw / session.lifecycle / *.dlq)
  ↓ GpsEngineKafkaConsumer (group gps-engine-service, per-partition order)
gps-engine-service — KafkaMessageProcessor (bounded retry → DLQ)
  ↓ PositionPipeline: validate → dedupe → persist → trip → cache → broadcast
TimescaleDB (tracking.vehicle_positions hypertable + trip/idle/parking/engine-hours)
Redis (last-position, FSM state, device-status cache; gateway session snapshots)
  ↓ SignalBus → RealtimeGateway (Socket.IO, JWT handshake, tenant rooms, coalescing)
WebSocket → authorized clients
```

Boundary audit (protocol / payload / ownership / retry / failure / idempotency / tenant /
correlation / logging / metrics) drove the gaps fixed below. The audit found seven
production-blocking defects (marked **[BUG]**), all fixed and regression-tested.

## Telemetry Event Contract (§5)

Verified envelope fields: `specversion, type, time, id, messageId, correlationId, deviceId,
vehicleId, serialOrImei, tenantId, protocolId, messageType, timestamp, position{latitude,
longitude, speedKph, headingDeg, altitudeM, satellites, ignitionOn}, alarms, telemetry, io,
rawSize, checksum`.

- **[BUG] `vehicleId` was never propagated** — `ResolvedDevice.pairedVehicleId` existed but no
  message/envelope carried it; gps-engine silently used `deviceId` as vehicle. Now the session
  binds the registry-sourced `vehicleId` at authentication (immutable for the session's life),
  `bindIdentity` stamps it onto every message, and the envelope carries it.
  `tenantId`/`vehicleId` originate ONLY from the registry/auth context — never the device payload.
- **`correlationId` added** (the device session id — one correlation per connection; messageId
  remains the event id). Backward compatible: gps-engine falls back to `deviceId` when
  `vehicleId` is absent (pre-Sprint-D producers); session-lifecycle events now also carry `id`.

## Device Session Management (§7/§8) — duplicate connections

Deterministic policy: **the newest connection REPLACES the old** (matches the documented
last-write-wins Redis design, 06 §6.3).

- Same pod: `SessionManager.registerAuthenticated` closes the prior LIVE local session with
  `DUPLICATE_SESSION` and destroys its socket via a registered transport terminator (TCP).
- Cross-pod: the sweep detects that the Redis snapshot (`tenant:<tid>:device:<did>:session`)
  no longer names our sessionID → self-close `DUPLICATE_SESSION`. Detection window ≤ one
  sweep interval (`GATEWAY_SWEEP_INTERVAL_SECONDS`, default 20s) vs the 60s Redis TTL.
- **[BUG] the old session's close deleted the NEW session's Redis entry** — `close()` now
  removes the global entry CONDITIONALLY (`removeIfSession`: only when it still names this
  session), and emits DISCONNECTED only once (a late socket-cleanup re-entry no-ops).
- `DUPLICATE_SESSION` disconnects do NOT flip the device OFFLINE in gps-engine/fleet projections
  (the newer session owns the state) — enforced in `DeviceStatusPipeline`.
- Sweeper (`SessionManager.sweep`) also closes: unauthenticated sessions past
  `GATEWAY_AUTH_GRACE_SECONDS`, UDP pseudo-sessions idle past `GATEWAY_UDP_SESSION_TTL_SECONDS`.
- **[BUG] UDP leaked one session per datagram** — sources now REUSE the live pseudo-session
  (`udpSessionFor`), swept by TTL when the source goes quiet.
- **[BUG] pool-full "admit for triage"** — when `ConnectionPool.admit()` rejects, the socket is
  now destroyed (TCP) / datagram dropped (UDP): real back-pressure, no phantom sessions.

## Device State (§9/§10)

- `tracking.device_status` remains the durable projection (one write per lifecycle event).
- **[BUG] `last_seen_at` never refreshed for streaming devices** (only lifecycle events wrote
  it) — the position pipeline now flushes `touchLastSeen` at most once per
  `GPS_LAST_SEEN_FLUSH_SECONDS` (default 60s) per device — never per packet.
- **[BUG] a crashed gateway left devices permanently ONLINE** — the Redis session snapshot
  TTL-expires (60s) and nothing reconciled the DB. `DeviceStaleSweeper` (every
  `GPS_DEVICE_STALE_SWEEP_SECONDS`) transitions ONLINE→STALE when `last_seen_at` is older than
  `GPS_STALE_AFTER_SECONDS` and broadcasts the STALE signals. Recovery = gateway crashes →
  state expires → device reconnects → ONLINE again (lifecycle event).

## Device Registry Cache (§11/§12)

- Cache ladder unchanged (L1 LRU ~30s → L2 Redis ~5m → L3 HTTP), now env-tunable
  (`GATEWAY_AUTH_L1_*`, `GATEWAY_AUTH_L2_TTL_SECONDS`).
- **Push-based invalidation added** (Sprint C was TTL-bounded only): fleet-management publishes
  the affected IMEI to `fleetvision:registry:invalidate` (Redis pub/sub) on device
  status/protocol changes and vehicle↔device bind/unbind; every gateway instance's
  `RegistryInvalidationSubscriber` clears L1+L2 immediately. Falls back gracefully to the TTL
  bound when Redis pub/sub is down.
- **HttpDeviceRegistry resilience (§12):** bounded retries with exponential backoff on
  TRANSIENT failures only (429/5xx/network/timeout — 2 retries, 250ms base). 404 stays an
  immediate "unknown device"; 401/403 stay fail-closed without retry (config errors).
  `tenantActiveCache` is TTL-bounded (5m) instead of unbounded-forever.

## Kafka Reliability (§13/§14/§17)

Producer (gateway):
- Bounded, env-tunable retries (`GATEWAY_KAFKA_RETRIES/_RETRY_INITIAL_MS/_RETRY_MAX_MS`,
  kafkajs exponential backoff) + `restartOnFailure` gated on shutdown.
- **[BUG] `connected` never reset on broker loss** (readiness lied) — producer
  CONNECT/DISCONNECT event listeners now maintain the true state; a lost broker flips
  readiness/`isConnected` and the next publish re-connects.
- Publish outcomes counted (topic × result). Failure still propagates to the dispatcher's
  back-pressure (read loop pauses; never silently discarded).

Consumer (gps-engine) — **at-least-once**, honestly documented:
- Offsets auto-commit AFTER `eachMessage` resolves; a message resolves only once it is
  processed, DLQ'd, or dropped-after-exhausted-DLQ-retries (the only loss path, ERROR-logged
  + counted). A crash mid-processing redelivers — every write path is idempotent (below).
- **[BUG] a Kafka outage at boot left the consumer dead for the pod's lifetime** (the old
  "will retry via run() heartbeat" comment was wrong — `run()` was unreachable after a failed
  `connect()`). `start()` is now retried with capped backoff until shutdown.
- Topic naming (§17): unchanged topics + `<topic>.dlq` suffix for the dead letters.

| topic | producer | consumer | payload | retry | DLQ |
|---|---|---|---|---|---|
| fleetvision.telemetry.position.raw | gateway | gps-engine | CloudEvents position JSON | in-process ×3 | .dlq |
| fleetvision.telemetry.session.lifecycle | gateway | gps-engine + fleet-mgmt | session lifecycle JSON | in-process ×3 | .dlq |
| fleetvision.telemetry.alarm/device.raw, command.ack | gateway | (later sprints) | CloudEvents JSON | producer-side | — |
| *.dlq | gps-engine DlqProducer | ops tooling | original value + forensic headers | — | — |

## Retry Strategy & DLQ (§15/§16)

`KafkaMessageProcessor` (unit-tested in isolation):
- SUCCESS → offset advances.
- `EnvelopeValidationError` (structural) → **straight to DLQ** — a malformed event will never
  parse; retrying is pointless.
- Transient (DB down, internal) → `GPS_KAFKA_MAX_ATTEMPTS` (3) in-process attempts with
  exponential backoff (`GPS_KAFKA_RETRY_BACKOFF_MS`), then DLQ.
- DLQ record = original value + headers: `dlq-original-topic/-partition/-offset`,
  `dlq-failure-reason` (truncated 500), `dlq-error-class`, `dlq-attempts`, `dlq-first-seen`,
  `dlq-source-group`, best-effort `event-id`/`correlation-id` extracted from the payload.
  No secrets (telemetry envelopes carry none). DLQ topics ensured at boot via admin.
- If the DLQ write itself fails after its own bounded retries → ERROR log + `dropped` metric
  (documented loss edge; blocking the partition on a poison DLQ write trades one loss for an
  unbounded outage).
- Safe inspection (§16): `GET /admin/ingestion` (JWT + `telemetry.gateway.manage`) exposes the
  consumer's liveness + last 100 DLQ routing decisions (metadata only, no payloads).

## Schema Evolution (§18) & GPS Failure Handling (§19)

- The envelope parser IS the consumer-boundary validator, hardened: JSON shape, required
  identity fields, finite numeric coordinates, and **[BUG] strict timestamp validation** —
  an unparseable date previously produced `Invalid Date`, sailed through quality gates as
  NaN comparisons, and got persisted as VALID. Now `EnvelopeValidationError` → DLQ.
- A single bad event can never crash the process: every stage is caught, classified
  (retryable vs structural), and routed. Verified by unit tests + the E2E malformed case.

## Idempotency (§6/§20)

Strategy (unchanged in kind, completed in coverage): messageId = event id; DB constraints are
the cross-restart boundary; in-process sets are a fast path only.
- `vehicle_positions`: composite PK `(event_id, captured_at)` ON CONFLICT DO NOTHING (Sprint A).
- `engine_hours`: UNIQUE `source_event_id` (Sprint A).
- **[BUG] trip/idle/parking projections were NOT redelivery-safe** — a replayed
  `trip.started` created a second ACTIVE row. New migration adds `source_event_id uuid` +
  UNIQUE index to `trip_events` / `idle_periods` / `parking_periods`; `TripEngine` stamps every
  persisted event with the triggering position's messageId; inserts use
  `ON CONFLICT (source_event_id) DO NOTHING` (NULL source never conflicts — legacy-safe).
- **[BUG] pipeline dedupe was keyed on messageId alone** (doc said vehicle+message) — now
  `(vehicleId, messageId)`.
- Trip close/discard remain exactly-once under redelivery via the `status='ACTIVE'` guard
  (Sprint A). Sprint A tests re-run green (now actually executing — see Testing).

## Out-of-Order Events (§21) — documented policy

Real devices send delayed packets (T2 then T1). Policy: **persist, don't regress.**
- Persistence: ALWAYS (a hypertable is a time-series; insert order is irrelevant).
- Trip/idle/parking FSMs, odometer, engine-hours: SKIPPED for an out-of-order position
  (previously a negative Δt silently corrupted the jump filter, regressed prev-pos, and
  distorted accumulators). `TripEngine.process` returns `{skipped:'OUT_OF_ORDER'}`.
- Latest-position cache + live broadcast: SKIPPED (an old packet must not regress the
  latest view or hit the live map).
- Equal timestamps process normally; only strictly older is out-of-order. Verified by unit
  tests + the E2E out-of-order case.

## Timestamps (§22)

`captured_at` = device event time (envelope `timestamp`); `ingested_at` = gateway receive time
(envelope `time`); both stored, never overwritten, UTC throughout. Both strictly validated at
the boundary (above).

## TimescaleDB (§23) & Query Performance (§24)

- Sprint A policies verified INTACT: compression (7d, segmentby `vehicle_id`, orderby
  `captured_at DESC`) + retention (180d) — untouched; no RLS on the hypertable (Sprint A
  decision maintained; repository-layer `WHERE tenant_id` remains the boundary).
- Common queries re-audited against indexes: latest-by-vehicle and ranges use
  `ix_positions_tenant_vehicle_time (tenant_id, vehicle_id, captured_at DESC)`; trip closes use
  the deterministic subquery + partial `ix_trip_events_active`. **Fixed:** the range endpoint
  accepted NaN/unbounded `limit` — now clamped 1..10 000.

## Redis (§25)

Verified: latest-position (`tenant:<tid>:vehicle:<vid>:pos`, TTL 2× report interval),
FSM state (bounded TTLs), device-status cache (1h), gateway session snapshots (TTL 60s/UDP).
Every cache op is best-effort (failures degrade to DB/defaults — never crash the pipeline);
keys are tenant-scoped. No permanent ONLINE entries can survive (§10 sweeper + TTLs).

## WebSocket (§26–§28) & Backpressure (§29)

Sprint B security retained (JWT handshake fail-closed, tenant-scoped rooms only). Added:
- **Duplicate delivery fixed**: a client in BOTH fleet + vehicle rooms received every update
  twice (two separate emits); chained `io.to(fleet).to(vehicle)` targets the room UNION —
  exactly one delivery.
- **Room cap** `GPS_WS_MAX_ROOMS_PER_CLIENT` (default 50) bounds per-client subscription
  memory; duplicate subscribes are idempotent.
- **Back-pressure = coalescing (latest-position semantics)**: at most one emission per room
  per `GPS_WS_COALESCE_INTERVAL_MS` (default 250ms); intermediate positions are dropped and
  counted (`fleetvision_ws_dropped_updates_total`). A slow client cannot accumulate an
  unbounded backlog from us — the per-room buffer is one entry by design.
- Reconnect (§28): rooms are per-connection; a reconnecting client re-authenticates (handshake
  JWT re-verified — old context never trusted) and re-subscribes against the FRESH principal.
  Verified by test ("reconnect: re-authenticate + re-subscribe").
- `io.close()` is now awaited on shutdown (listener genuinely released).

## Command Path (§31)

Audited: **no device-command dispatch path exists** (no REST→device downstream channel; the
frontend Command Center is a documented placeholder). Nothing was built (out of scope); the
`canDispatchCommand()` invariant + session lookup (`byDeviceId`) exist for the future path.
Documented as a known gap, not claimed.

## Observability & Metrics (§32–§34)

- `packages/observability` gains a minimal Prometheus layer (prom-client): bounded-label
  counters/gauges/histogram exposed at `GET /metrics` per service
  (`GATEWAY_METRICS_ENABLED` / `GPS_METRICS_ENABLED`). Gateway: connections (accepted /
  rejected_pool_full), duplicate closes (local/cross-instance), registry resolves by tier,
  produced by topic×result. GPS: consumed by topic×result (processed/duplicate/dlq/dropped),
  retries, DLQ count, processing latency histogram, positions by outcome, WS clients /
  subscriptions / dropped updates. NO unbounded labels (IMEI/tenant are never label values).
- Correlation (§34): `event-id` (= messageId) + `correlation-id` (= session id) on envelopes,
  Kafka headers, DLQ records, and structured logs — traceable gateway→Kafka→gps-engine→DB→WS.
  No raw payloads logged by default; no secrets anywhere in the pipeline.

## Health & Graceful Shutdown (§35/§36)

- `packages/health` `HealthModule.forRoot({ imports })` lets services contribute readiness
  indicators via the `EXTRA_READINESS_INDICATORS` token. Gateway: Kafka-producer state;
  gps-engine: consumer-running state. **Liveness stays dependency-free** — "alive but not
  ready" is expressible; a temporary Kafka outage never kills the pod.
- Gateway shutdown order: stop accept loop (TCP/UDP listeners — **[BUG] previously not closed
  on SIGTERM at all**) → close ALL sessions (`SHUTDOWN`, sockets destroyed, DISCONNECTED
  emitted) → invalidation subscriber + producer + knex + redis (provider hooks).
- gps-engine: consumer disconnect → WS close (awaited) → shared modules. No zero-data-loss
  claim beyond the verified at-least-once + DLQ semantics.

## Failure Matrix (§38)

| Dependency | Failure | Expected (verified) behavior |
|---|---|---|
| PostgreSQL (gps) | outage | consumer retries ×3 (backoff) → DLQ; process alive; recovers when DB returns; Redis/WS unaffected |
| PostgreSQL (gateway) | boot outage | non-fatal boot (listener config degrades); Kafka path unaffected |
| Kafka | boot outage | gateway boots (lazy producer); gps-engine retries start() with backoff until up |
| Kafka | runtime outage | producer bounded retries then back-pressure (reads pause); consumer runner pauses; no crash; recovery on return |
| Kafka | poison message | retry → DLQ (never silently dropped); partition advances; process alive |
| Redis | outage | all caches best-effort → DB fallbacks; FSMs restart from defaults; gateway sessions degrade to local-only; sweep tolerates outage (tested) |
| Fleet-management | 404 | unknown device → reject (fail-closed) |
| Fleet-management | 401/403 | fail-closed, NO retry (config error) |
| Fleet-management | 429/5xx/network | bounded retries w/ backoff → fail-closed; cache hits keep serving; no socket exhaustion (AbortController timeout) |
| WebSocket | slow client | coalescing drops intermediates (counted); no unbounded buffers |
| Device socket | half-open/idle | TCP idle timeout; auth-grace sweep; reconnect replaces session (newest wins) |

## Testing (§45/§46/§47)

**Suite counts: gateway 14 suites/156 tests · gps-engine 19/114 · fleet 5/45 · identity 8/42 ·
map 5/26 · media 4/58 · packages ~50 · web 14/107.**

New Sprint D tests:
- Gateway: `session-lifecycle-hardening.spec.ts` (12) — duplicate connection (local eviction,
  cross-instance supersession, single DISCONNECTED, conditional Redis removal), auth-grace +
  UDP-TTL sweeps, UDP session reuse, Redis-outage sweep tolerance, SHUTDOWN closeAll.
  `registry-resilience.spec.ts` (9) — transient-retry/no-retry-404/403, bounded network-error
  attempts, tenantActive TTL, invalidation pub/sub clears cache instantly, malformed payloads,
  Redis-outage degradation.
- GPS: `kafka-reliability.spec.ts` (8) — bounded retry, non-retryable classification,
  attempts/error-class correctness, DLQ metadata, DLQ-failure drop edge.
  `envelope-hardening.spec.ts` (10) — trusted vehicleId, strict timestamps, structural
  rejection. `out-of-order-hardening.spec.ts` (5) — §21 policy + DUPLICATE_SESSION no-op.
  `realtime-hardening.spec.ts` (9) — JWT fail-closed, cross-tenant denial, **mandatory §30
  multi-tenant isolation**, duplicate-subscribe idempotency, union delivery, room cap,
  coalescing back-pressure, reconnect re-auth/resubscribe.
- **[BUG] the Sprint A/B integration suites silently skipped under jest** (knex ESM-loader
  quirk) — now share the direct-import bootstrap (`__tests__/integration/db.ts`): all 16
  execute against real PostgreSQL/TimescaleDB (fresh throwaway DB per run).
- **E2E (§46/§47)** `e2e-telemetry-pipeline.integration.spec.ts`: device simulator → REAL
  PacketDispatcher/AuthResolver/SessionManager/DeviceGatewayKafkaProducer → REAL Kafka →
  REAL GpsEngineKafkaConsumer (retry+DLQ) → REAL TimescaleDB rows → REAL Socket.IO client.
  Verifies: LOGIN→trusted identity→device_status ONLINE; position→PG row under the REGISTRY
  vehicleId + authorized WS delivery; redelivery idempotency (ONE row); out-of-order
  persisted-but-not-broadcast; malformed→real DLQ topic with forensic headers. Graceful skip
  without Kafka/PG.
- Security regression: Sprint B auth/guard tests re-run green (identity 42, fleet cross-tenant
  suites, gps tenant-isolation suite).
- Restart/failure scenarios covered at unit/integration level (sweeps, boot-retry, Redis
  outage, DB-failure→DLQ); live `docker compose restart` drills documented below.

## Performance Test (§40)

Lightweight, repeatable, honest: the E2E + WS suites stream positions through the full
pipeline against the real docker stack (single broker, single pg, single redis) at dev scale
(tens of positions, per-room coalescing). Memory bounded by construction (all buffers/maps are
bounded: dedupe 10k, DLQ ring 100, last-seen throttle 50k, coalescing 1/room). **No
production-capacity claim is made from this**; the tested scale is documented as local-docker
single-node.

## Recovery Strategy (§37)

- Gateway restart: sockets drop → devices reconnect → registry resolves (cache or L3) →
  sessions re-register (duplicate eviction guarantees no stale authority) → telemetry resumes
  (E2E verifies the full path; unit tests verify each mechanism).
- gps-engine restart: consumer group rejoins, offsets resume; idempotent writes make
  redelivery safe.
- Kafka restart: producers/consumers reconnect with bounded backoff (boot-retry loop fixed).
- Redis restart: caches repopulate; FSMs restart from defaults (spurious boundaries possible
  on failover — documented Sprint 7 behavior); gateway snapshots rebuild on next frames.

## Known Limitations

- Single-broker Kafka, single-instance everything — no HA claims.
- DLQ-write-failure edge drops the message (ERROR-logged + counted) — the documented loss path.
- Redis-down degrades FSM continuity (documented) and cross-instance duplicate detection
  (local eviction still works).
- Consumer lag is not exported as a metric (kafkajs does not expose it directly; ops reads it
  from Kafka tooling).
- Schema registry/Avro deferred (JSON + strict boundary validation is the current contract).
- Coalescing is per-room-process; multi-pod exact-once WS delivery relies on the redis
  adapter's at-most-once semantics (unchanged).
- gateway E2E test composes the gateway's BUILT dist — rebuild the gateway after touching its
  sources (`pnpm --filter device-gateway-service build`).
