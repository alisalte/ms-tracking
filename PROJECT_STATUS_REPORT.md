# FleetVision — Project Status Report

> Evidence-based audit of the **actual source code**, tests, migrations, Docker stack, and
> runtime verification. Documentation claims were verified against code and **corrected** where
> they diverged. Nothing in the repository was modified during this audit.
>
> **Audit date:** 2026-08-13 · **Branch:** `main` · **HEAD:** `5bdd110`
> **Method:** every service's source was read; build/typecheck/test/lint were executed; migrations
> and Docker Compose were inspected. Status vocabulary: `COMPLETE`, `PARTIAL`, `STUB`, `MOCK`,
> `BROKEN`, `MISSING`, `DOCUMENTED_ONLY`, `UNKNOWN`.
>
> ⚠️ **Read this first — the biggest divergence:** the README's "Architecture at a Glance"
> describes **Kotlin/Spring Boot 3.3, Go, Python, Kubernetes, Istio, Keycloak, OPA, Vault, Kafka,
> ClickHouse, MongoDB, Elasticsearch**. **The actual code is none of that.** Per **ADR-021 /
> ADR-022** the project was pivoted to **Node.js 22 + NestJS 10 + TypeScript + pnpm workspaces**,
> with **PostgreSQL (TimescaleDB+PostGIS), Redis, Kafka** only. Treat the README's top section and
> the old module/ADR docs that assume Spring/Kotlin as **stale/aspirational**. The Node/NestJS
> reality is reflected in `docs/adr/ADR-021-Node-NestJS-Runtime.md`, `ADR-022-Lean-Persistence.md`,
> `docs/specs/22_Codebase_Architecture.md`, and the `package.json` files.

---

> **Update 2026-08-13 — Sprint B (Security & Tenant Isolation) COMPLETE.** Added a new shared
> `@fleetvision/auth` package; every backend service is now JWT/API-key authenticated (global
> `CompositeAuthGuard` + `PermissionsGuard`), with the tenant derived from the verified credential
> — never a client header. The spoofable `X-Tenant-Id`/`tenant-id` attack is eliminated. RBAC
> permissions are embedded in the JWT; WebSocket connections/rooms are authenticated + authorized
> (no more joining another tenant's room); the device-gateway admin API is guarded; API keys now
> authenticate (Argon2id-verified, tenant-scoped). RLS policies hardened to real tenant predicates
> (forward-ready — see §11 caveat: the superuser connection bypasses RLS, so the repository-layer
> `WHERE tenant_id` filter is the enforcing boundary). New `@fleetvision/auth` package (23 tests)
> + cross-tenant integration suite. Full report:
> `docs/implementation/SPRINT-B-SECURITY-TENANT-ISOLATION.md`.

---

> **Update 2026-08-14 — Sprint C (Device & Fleet Management) COMPLETE.** Added a new bounded
> context, `fleet-management-service`, owning Fleet / Vehicle / Device + the vehicle↔device
> relationship (`fleet` schema, tenant-scoped, RLS-hardened). It is the **first real Fleet
> Management domain** and replaces the temporary in-memory device registry with a **persistent,
> tenant-aware registry**: a device created through the management API is now resolvable by the
> real device-gateway. The gateway's `DEVICE_REGISTRY` is the new `HttpDeviceRegistry` (behind the
> existing `DeviceRegistryPort`) — it resolves IMEI → identity over HTTP to fleet-management on an
> L1/L2 cache miss only, so the gateway never touches fleet's DB schema and never does a per-packet
> lookup. Trusted `deviceId`/`tenantId`/`vehicleId` (registry-sourced, never device-supplied)
> propagate through the existing Kafka envelope into gps-engine and TimescaleDB. IMEI is globally
> unique; DELETE = archive/disable (telemetry history preserved); the resolve endpoint is
> API-key-only (no cross-tenant device enumeration). Audit is wired for the first time (the latent
> `audit.audit_entries.request_id` uuid-column bug fixed via a forward migration). New permissions
> `fleet|vehicle|device.{read,write}` + `device.registry.resolve` (back-filled to existing roles).
> Connection state projects from the existing `telemetry.session.lifecycle` topic. 58 new tests
> (45 fleet incl. real-PG integration, 11 gateway incl. an end-to-end resolve→dispatch test, 2
> gps-engine envelope-persistence). typecheck/build/test/lint all GREEN. Full report:
> `docs/implementation/SPRINT-C-DEVICE-FLEET-MANAGEMENT.md`.

---

> **Update 2026-08-15 — Sprint D (Real-Time Tracking & Production Telemetry Hardening) COMPLETE.**
> The telemetry vertical is now **reliable, observable, idempotent, recoverable, tenant-safe, and
> resilient to reconnects / Kafka failures / service restarts**. Highlights (full report:
> `docs/implementation/SPRINT-D-REALTIME-TRACKING-HARDENING.md`):
> - **Duplicate device connections enforced** (newest session wins; local eviction +
>   cross-pod supersession sweep; the old session can no longer delete the new session's Redis
>   entry; UDP per-datagram session leak fixed; pool-full now rejects instead of "triage").
> - **Kafka consumer reliability**: bounded in-process retry → **real DLQ** topics
>   (`<topic>.dlq`, forensic headers, no secrets) for poison/malformed messages — the old
>   behavior (swallow + advance = silent data loss on DB outage) is gone; boot-time Kafka outage
>   now retries with backoff instead of leaving the consumer dead.
> - **Idempotency completed**: trip/idle/parking projections gained `source_event_id` UNIQUE
>   (redelivered `trip.started` no longer double-inserts); pipeline dedupe key fixed to
>   (vehicleId, messageId).
> - **Out-of-order telemetry policy** (§21): delayed packets are persisted but never regress the
>   FSM/prev-pos baseline or the live map (previously corrupted Δt accumulators).
> - **Envelope hardening**: strict consumer-boundary validation (invalid timestamps — previously
>   `Invalid Date` classified VALID — now non-retryable → DLQ); registry `vehicleId` +
>   `correlationId` propagate end-to-end.
> - **WebSocket**: coalescing back-pressure (latest-position semantics, dropped counted),
>   duplicate-delivery fix (fleet+vehicle room union), room cap, reconnect re-auth verified.
> - **Device state**: throttled `last_seen` flush (≈1 write/min/device, not per packet) +
>   ONLINE→STALE sweeper (crashed gateway no longer leaves devices ONLINE forever).
> - **Registry cache invalidation**: push-based via Redis pub/sub (disable/reassign takes effect
>   immediately) + bounded HTTP retry/backoff on transient fleet-management failures.
> - **Observability**: Prometheus `/metrics` on gateway + gps-engine (bounded labels);
>   Kafka readiness added to `/health/ready` (liveness stays dependency-free); graceful gateway
>   shutdown (listeners → sessions → producer — TCP/UDP listeners were previously never closed).
> - **Tests**: gateway 156 (was 124), gps-engine 114 incl. a **real-Kafka → real-Timescale →
>   real-WebSocket E2E**; the Sprint A/B integration suites that silently skipped now execute
>   (16 real-PG tests). typecheck/build/test/lint GREEN.


## 0. TL;DR

FleetVision is a **well-engineered monorepo with a strong foundation and one genuinely deep
end-to-end vertical (device ingest → Kafka → GPS processing → TimescaleDB → WebSocket)**, plus a
real authentication/IAM service and a polished (but **mock-backed**) React dashboard. The
implemented slices are production-quality scaffolding with good tests. **However**, most of the
platform's business breadth is **not started**: video is a stub, routing is an approximation,
several data-integrity bugs exist in the trip engine, the dashboard is mock-fed for all business
data, and ~9 of the 14 documented bounded contexts have no
service at all. *(Sprint C added the Fleet Management context + a persistent device registry; the
mock dashboard Fleet pages remain future work.)*

**Build/typecheck/tests/lint: ALL GREEN (verified 2026-08-15, Sprint D).**
**Estimated overall completion: ~28 %** (foundation + telemetry vertical production-grade;
breadth low). Sprint D hardened the telemetry vertical end-to-end — reliability (retry+DLQ,
duplicate-connection enforcement, restart recovery), idempotent projections, out-of-order
policy, WS back-pressure, metrics + Kafka readiness, and a real-Kafka→Timescale→WebSocket E2E.

---

## 1. Monorepo Structure (verified)

```
fleetvision/                         (pnpm workspace, packageManager pnpm@9.15.0, node >=22)
├── apps/                            6 deployables
│   ├── identity-service/            Auth + IAM + tenants + API keys (NestJS) — REAL
│   ├── device-gateway-service/      Multi-protocol TCP/UDP ingest → Kafka (NestJS) — REAL core
│   ├── gps-engine-service/          Kafka → Timescale → Redis → WS pipeline (NestJS) — REAL core
│   ├── map-engine-service/          PostGIS POI/geofence + routing (NestJS) — PARTIAL
│   ├── media-service/               Video control-plane (NestJS) — STUB media path
│   └── web-dashboard/               React 19 + Vite + MUI SPA — REAL UI, MOCK data
├── packages/                        7 shared workspace libs (all foundational, all tested)
│   ├── shared-kernel/   config/   observability/   persistence-knex/
│   ├── cache-redis/    health/    web/
├── infra/docker/                    docker-compose.yml (infra + identity + web), .env templates
├── docs/                            ~22 specs + 24 module docs + 4 ADRs (much is STALE Kotlin/K8s)
├── tools/generators/                service generator scaffolding (not exercised)
└── .github/workflows/ci.yml         lint • typecheck • build • test
```

**Composite TS graph** (`tsconfig.json`) references 7 packages + `identity-service` +
`device-gateway-service` only. **gps-engine / map-engine / media-service are NOT in the root
`tsc -b` references** — they build independently via their own `tsc -b tsconfig.json`. They still
typecheck/build fine, but are outside the root solution graph.

Per-app summary:

| App | Tech | Responsibility | Build | Tests | Implementation | Integration |
|---|---|---|---|---|---|---|
| identity-service | NestJS 10 | Auth, IAM, RBAC, tenants, API keys | ✅ | 42 | COMPLETE (core) | Kafka outbox real |
| device-gateway-service | NestJS + net | TCP/UDP ingest, GT06/JT808/Meitrack → Kafka | ✅ | 124 | PARTIAL (registry in-memory) | Kafka producer real |
| gps-engine-service | NestJS + socket.io | Position pipeline, trip/idle/parking FSMs | ✅ | 58 | PARTIAL (data bugs) | Kafka consumer real |
| map-engine-service | NestJS + PostGIS | POI/geofence/cluster/replay, routing | ✅ | 26 | PARTIAL (routing≈, geocode broken) | PostGIS real |
| media-service | NestJS + socket.io | Video channel + stream-session control-plane | ✅ | 58 | STUB (no real SFU/video) | Redis/PG real, media stub |
| web-dashboard | React 19 + Vite | Full SPA fleet UI | ✅ | 107 | PARTIAL (UI complete, data MOCK) | Only auth is real |

---

## 2. Service-by-Service Audit

### 2.1 identity-service — **COMPLETE (core); PARTIAL (breadth)**

The most mature service. Real, non-trivial security code, not a stub.

**What is REAL (evidence):**
- **Login** with defense-in-depth: per-IP **and** per-user rate limiting, account lockout after
  `LOGIN_MAX_ATTEMPTS`, generic `InvalidCredentialsError` (no enumeration oracle), tenant-must-be-active
  check — `application/auth/login.use-case.ts:73-167`.
- **JWT access tokens (HS256)** + **opaque refresh tokens** (256-bit random, SHA-256 hashed at rest) —
  `infrastructure/services/token-service.ts:52-112`. RS256/JWKS is documented as a later migration.
- **Refresh-token rotation with reuse detection**: `RefreshTokenFamily.consume()` detects replay →
  revokes the whole family + sets a user-wide revocation flag (kills access tokens within TTL) —
  `application/auth/refresh.use-case.ts:42-79`, `domain/refresh-token-family.ts`.
- **Argon2id** password hashing (m=64MiB, t=3, p=1, env-driven) —
  `infrastructure/services/password-hasher.ts`.
- **RBAC**: `JwtAuthGuard` (verifies + revocation check, fail-closed) +
  `PermissionsGuard` (`@RequirePermissions(...)`, wildcard `*` for tenant-admin) —
  `api/shared/jwt-auth.guard.ts`, `api/shared/permissions.guard.ts`.
- **Users / Tenants / API keys** CRUD with tenant scoping via `withTenantContext()` and atomic
  event-outbox persistence — `infrastructure/persistence/user.repository.ts`.
- **Transactional outbox → Kafka relay** (real kafkajs poller draining `event_outbox` → audit topic,
  non-fatal at boot) — `infrastructure/services/kafka-outbox-relay.ts`.
- **Idempotent bootstrap seed** (first tenant + admin from `SEED_*` env) —
  `api/shared/bootstrap-seed.ts`.

**What is PARTIAL / MISSING (evidence):**
- **MFA: MISSING backend.** `mfa_enabled` flag + `aal` claim exist, but no TOTP/OTP flow; frontend
  `POST /auth/login/mfa` & `GET /auth/mfa` are `NotImplementedError` stubs.
- **Password reset/forgot/change: MISSING.** `iam.password_history` table exists (schema readiness),
  `domain/password-policy.ts` exists, but **no endpoint**; frontend stubs confirm.
- **Audit log writes: MISSING.** `AuditRepository.append()` exists
  (`infrastructure/persistence/audit.repository.ts:37`) but is **never called anywhere**. The
  hash-chained `audit.audit_entries` table is schema-only. (Domain events *do* flow to Kafka via the
  outbox, so there is a partial event trail — but not the proper audit log.)
- **Organizations (org hierarchy): MISSING.** `iam.organizations` table + domain exist; **no API**.
- **OPA: DOCUMENTED_ONLY.** `permissions.guard.ts:6-7` states OPA is the production evaluator; only
  the in-process fallback exists.
- **User list pagination is hardcoded** `limit=50, offset=0` (no query params) —
  `api/iam/users.controller.ts:36`. **No DELETE user**, no suspend/reactivate tenant endpoint.
- **`GET /auth/me` returns `email: ''`** (not hydrated) — `auth.controller.ts:164`.

**Endpoints (17 + 2 health):**

| METHOD | Path | Controller | Auth | Status |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | AuthController | public | COMPLETE |
| POST | `/api/v1/auth/refresh` | AuthController | public | COMPLETE |
| POST | `/api/v1/auth/logout` | AuthController | JWT | COMPLETE |
| POST | `/api/v1/auth/logout-all` | AuthController | JWT | COMPLETE |
| GET | `/api/v1/auth/me` | AuthController | JWT | PARTIAL (email empty) |
| GET | `/api/v1/iam/users` | UsersController | JWT+`iam.user.read` | PARTIAL (no pagination) |
| GET | `/api/v1/iam/users/:id` | UsersController | JWT+perm | COMPLETE |
| POST | `/api/v1/iam/users` | UsersController | JWT+`iam.user.create` | COMPLETE |
| PUT | `/api/v1/iam/users/:id` | UsersController | JWT+perm | PARTIAL (no zod body validation) |
| POST | `/api/v1/iam/users/:id/roles` | UsersController | JWT+`iam.role.assign` | COMPLETE |
| POST | `/api/v1/tenants` | TenantsController | JWT+`billing.tenant.manage` | COMPLETE |
| GET | `/api/v1/tenant` | TenantsController | JWT | COMPLETE |
| GET | `/api/v1/tenants/:id` | TenantsController | JWT+`billing.tenant.read` | COMPLETE |
| GET | `/api/v1/auth/api-keys` | ApiKeysController | JWT+`iam.apikey.read` | COMPLETE |
| POST | `/api/v1/auth/api-keys` | ApiKeysController | JWT+`iam.apikey.create` | COMPLETE |
| DELETE | `/api/v1/auth/api-keys/:id` | ApiKeysController | JWT+`iam.apikey.revoke` | COMPLETE |
| GET | `/health/live`, `/health/ready` | HealthController | public | COMPLETE |

**Persistence (migration `20260102000000_create_iam_schema.js`):** schemas `iam` + `audit` +
`public.event_outbox`. Tables: `iam.tenants`, `iam.users`, `iam.password_history`, `iam.roles`,
`iam.role_permissions`, `iam.user_roles`, `iam.organizations`, `iam.api_keys`,
`iam.refresh_token_families`, `iam.refresh_tokens`, `iam.auth_sessions`, `audit.audit_entries`
(hash-chained: `seq_no`/`prev_hash`/`entry_hash`), `public.event_outbox`. Proper FKs, check
constraints, unique indexes (tenant+email, global username, token hash). **RLS enabled on all
tenant tables but PERMISSIVE (`USING(true) WITH CHECK(true)`)** — see §6 / §12.

**Tests (8 suites, 42 cases, all pass):** domain rules, user aggregate, refresh-token family reuse,
permissions, password policy/hasher, config, DTO validation (INV-I02). Behavior-validating, not
superficial. **No integration tests against real PG/Redis/Kafka.**

---

### 2.2 device-gateway-service — **HARDENED (real protocols; persistent registry; Sprint D reliability)**

A genuine multi-protocol binary gateway, not scaffolding.

**What is REAL (evidence):**
- **TCP transport**: real `net.Server` per protocol listener; per-connection `read → frame → dispatch`
  loop over `ByteReader`; `setNoDelay`, idle timeouts reset on each framed read, bounded drain
  (≤64 frames/event), back-pressure propagation, graceful shutdown —
  `infrastructure/transport/tcp-server.ts`. UDP server + session-redis-store also present.
- **GT06 protocol**: **real binary decode** — BCD IMEI, GPS coordinate transform `raw / 30000 / 60`,
  course/status hemisphere bits (verified against spec `0x154C`), CRC16, LOGIN/HEARTBEAT/STATUS/GPS/ALARM
  message types, alarm-code mapping — `infrastructure/adapters/gt06/gt06.decode.ts`.
  **JT808 + Meitrack** have parallel `decode/encode/frames/header/codes` files + dedicated test
  suites (also real binary). A `stub` adapter exists for testing.
- **PacketDispatcher**: real 5-stage pipeline (decode → validate → auth/resolve → normalize → publish)
  with **fail-closed invariant #1** (`session.assertCanPublish()` — never publish pre-auth),
  implicit-login support for IMEI-embedded protocols, identity binding —
  `application/packet-dispatcher.ts`.
- **AuthResolver**: real 3-tier cache ladder (L1 LRU → L2 Redis → L3 registry), fail-closed on
  L3 unreachable, tenant-status check — `application/auth-resolver.ts`.
- **KafkaProducer**: real kafkajs **idempotent** producer, partition-keyed by `device_id` (per-device
  ordering), topic routing (position/alarm/device/commandAck/session), CloudEvents envelope,
  session-lifecycle events, non-fatal at boot — `infrastructure/kafka/kafka-producer.ts`.
- **SessionManager, ConnectionPool** (real cap/back-pressure), **AdapterRegistry** + plugin loader.

**What is PARTIAL / MISSING (evidence):**
- ✅ **Device registry** — RESOLVED (Sprint C `HttpDeviceRegistry` → fleet-management; Sprint D
  adds push-based cache invalidation via Redis pub/sub + bounded transient-failure retries).
- **Raw packet retention = `NullRawRetentionSink` (no-op)** by default. SHA-256 forensic checksum is
  computed, but raw bytes are **not** retained to S3/MinIO (deferred) —
  `infrastructure/storage/raw-packet-storage.ts`.
- ✅ **Admin API authentication** — RESOLVED (Sprint B guard). Sprint D adds `/metrics` and
  Kafka-producer readiness.
- **Command dispatch (device commands downstream): MISSING** — frontend `CommandCenterPage` is a
  typed placeholder; gateway has no command-dispatch REST path (documented gap, §31 of Sprint D).
- Sprint D hardening applied: duplicate-connection enforcement (newest wins, local + cross-pod),
  UDP pseudo-session reuse (leak fixed), pool-full rejection, auth-grace/UDP-TTL sweeps,
  graceful listener shutdown, producer retry/event-listener/readiness fixes.

**Endpoints (5 admin + 2 health):** `GET admin/sessions`, `GET admin/listeners`,
`POST admin/listeners/:id/{enable,disable}`, `GET admin/stats`, `/health/{live,ready}` — all REAL
mechanics but **unauthenticated**.

**Persistence (migration `20260103000000`):** only `telemetry.gateway_listeners` (protocol/port
config, JSONB options). The gateway itself persists no devices or raw packets to PG.

**Tests (10 suites, 124 cases — the highest in the repo):** gt06/jt808/meitrack decode,
adapter-registry, auth-resolver, connection-pool, device-session, heartbeat, packet-dispatcher,
session-manager. **Validate real binary decoding and pipeline behavior** — strong suite.

---

### 2.3 gps-engine-service — **HARDENED (real pipeline; Sprint A fixes + Sprint D reliability)**

A real-time pipeline that genuinely works end-to-end (verified by reading every stage).

**What is REAL (evidence):**
- **Position pipeline** `validate → dedupe → persist → cache → trip-engine → broadcast`, all real,
  wired through Nest DI — `application/position-pipeline.ts:42-106`.
- **Kafka consumer** (real kafkajs, consumer group, position + session topics, non-fatal at boot,
  routes by topic) + **envelope parser** (CloudEvents, throws on missing fields) —
  `infrastructure/kafka/{kafka-consumer,envelope-parser}.ts`.
- **Quality validation** (`domain/quality.ts`), **haversine + mileage filters** (stop-zeroing,
  dedupe-distance, max-plausible-speed jump filter).
- **Trip FSM** (`STOP→MOVING→PENDING_STOP→CLOSED`, gap-break, ignition-off close, micro-trip discard),
  **Idle FSM**, **Parking FSM** (incl. tamper), **engine-hours** accrual — `application/fsm/*.ts`.
- **Persistence**: `vehicle_positions` **is a TimescaleDB hypertable** (`create_hypertable`,
  1-day chunks, PostGIS geography geom, composite PK `(event_id, captured_at)` for idempotent insert,
  compression + retention policies added in Sprint A), `device_status` (upsert `ON CONFLICT DO MERGE`),
  `trip_events`/`idle_periods`/`parking_periods`, and `engine_hours` (Sprint A).
- **Redis caches** (last-position, FSM state, device-status), **WebSocket realtime gateway**
  (socket.io + `@socket.io/redis-adapter` for multi-pod fan-out, fleet + vehicle rooms).

**What is PARTIAL / BROKEN / MISSING (evidence — these are real defects):**
- ✅ **[HIGH] Orphan ACTIVE trips — RESOLVED (Sprint A).** Micro-trips now emit `trip.discarded`,
  and `TripRepository.discardTrip()` transitions the newest `ACTIVE` row to `DISCARDED` (the status
  was already in the check constraint). See `docs/implementation/SPRINT-A-GPS-DATA-INTEGRITY.md`.
- ✅ **[HIGH] `completeTrip` SQL — RESOLVED (Sprint A).** Rewritten as a deterministic tenant-scoped
  subquery (`UPDATE … WHERE id = (SELECT id … ORDER BY started_at DESC, id DESC LIMIT 1)`); covered
  by real-PostgreSQL integration tests.
- ✅ **[HIGH] Engine-hours data loss — RESOLVED (Sprint A).** Flushed windows now persist durably to
  the new `tracking.engine_hours` table, idempotent on the flush-trigger event id.
- **[HIGH→resolved, root-cause] The gps-engine migrations had never applied** (no `tracking` schema
  existed in any DB): `t.doublePrecision()` isn't a knex pg method (→ `t.double()`); the
  `vehicle_positions` PK lacked the partition column (→ composite PK `(event_id, captured_at)`); and
  JSON-serialized FSM state left `Date` fields as strings so the trip FSM threw on every 2nd position
  (→ Date revival at the cache-hydration boundary). All fixed in Sprint A.
- **[MED] PTO idle-suppression is dead code** — reads `ptoEngaged` which no type/parser populates.
- **[MED] `stop.detected` events emitted then dropped** (no table, no signal).
- ✅ **[MED] Timescale policies — RESOLVED (Sprint A).** Compression (7d, segmentby `vehicle_id`) +
  retention (180d) policies added (env-configurable). Required dropping the permissive RLS stub
  (Timescale forbids compression with RLS; isolation stays at the repository layer).
- ✅ **[LOW] Kafka DLQ/retry** — RESOLVED (Sprint D): bounded in-process retry → real
  `<topic>.dlq` with forensic headers; malformed = non-retryable → DLQ; boot-retry fixed.
- ✅ **WebSocket authz/CORS** — RESOLVED (Sprint B guards; Sprint D adds coalescing
  back-pressure, room caps, union delivery, reconnect re-auth).
- ✅ **Stale-timeout sweeper** — RESOLVED (Sprint D): ONLINE→STALE sweep + throttled last-seen.
- ✅ **`vehicleId` is really `deviceId`** — RESOLVED (Sprint C/D): registry-sourced
  `vehicleId` now propagates through the envelope (deviceId fallback for old producers).

**Endpoints (3 + 2 health + WS):** `GET /positions/:vehicleId/latest`, `GET /positions/:vehicleId`
(range), `GET /devices/:deviceId/status` — all COMPLETE (Redis→DB fallback), tenant-scoped via
header, **no JWT**. WS on port 3001. Geofence evaluation is **not** in this service (lives in
map-engine; no cross-service wiring to consume geofence events here).

**Tests (12 suites, 72 cases):** FSMs, haversine, quality, pipeline, envelope-parser, signal-bus,
redis-cache, **TripEngine orchestration, TripRepository integration (real PostgreSQL, all 10 Sprint A
scenarios incl. concurrency/idempotency + tenant isolation)**. Still no tests for
DeviceStatusPipeline, RealtimeGateway, controllers, or the Kafka consumer.

---

### 2.4 map-engine-service — **PARTIAL (PostGIS CRUD real; routing/geocode weak)**

**What is REAL (evidence):**
- **PostGIS geometry store**: `geo.pois`, `geo.addresses`, `geo.speed_limits`, `tracking.geofences`
  with `geography` types, **GiST** spatial indexes, **GIN** full-text on addresses, polygon/circle/
  corridor geofence types — migration `20260806120000_create_geo_schema.js`.
- **POI service** (bbox query, nearest-K via `<->` KNN), **geofence service** (CRUD +
  point-in-polygon `ST_Contains`/`ST_DWithin`), **replay service** (GeoJSON FeatureCollection from
  the position hypertable), **cluster service** (server-side H3).
- **reverseGeocode**: real PostGIS `ST_DWithin` + `<->` nearest-address + Redis cache —
  `infrastructure/provider/local-provider.ts:43-65`.
- Domain utils: **Douglas-Peucker** simplification, **H3**, geo-types, **ProviderRouter**
  (region/tenant/budget/health selection framework).

**What is PARTIAL / STUB / MISSING (evidence):**
- **Routing = STRAIGHT-LINE haversine** sum between waypoints + a 50 km/h guess for ETA;
  `matchRoute`/`snapPoint` are **pass-throughs with confidence 0.3** (no road graph) —
  `local-provider.ts:67-113`. **Not real road routing/map-matching.**
- **Forward `geocode` returns latitude/longitude `0,0`** (broken coordinates) — it searches address
  text but returns dummy coords — `local-provider.ts:27-41`.
- **External map providers (Mapbox / Google / OSRM / Amap / Baidu): NOT implemented.**
  `ProviderRouter` only wires `local`; the others are extension points — `provider-router.ts`.
  Config keys (`MAPBOX_TOKEN`, `OSRM_URL`, `GOOGLE_MAPS_KEY`) are parsed but unused.
- **`GET /map/heat` is a STUB** (returns `{cells: []}`, "deferred") — `map.controller.ts:51-56`.
  **`GET /map/layers` is a static list.**

**Endpoints (15 + 2 health):** `/map/{clusters,replay,heat,layers}`,
`/location/{geocode,reverse,pois,nearest,geofences,geofences/:id,geofences/contains}`,
`/route`, `/route/match`, `/health/{live,ready}` — tenant-scoped via header, **no JWT**.

**Tests (5 suites, 26 cases):** douglas-peucker, geo-types, h3-utils, provider-router,
replay-service. No controller/PostGIS integration tests.

---

### 2.5 media-service — **STUB (control-plane real; media path is fake)**

**What is REAL (evidence):**
- **Channel registry** (CRUD, vehicle/site/device association) + **stream-session lifecycle**
  (open/close, multi-channel batch, codec strategy H264/H265 → transcode decision, pod-affinity
  cache, first-viewer source activation) — persisted to PG (`media.video_channels`,
  `media.stream_sessions`).
- **WebSocket signaling gateway** (socket.io + redis adapter), **signaling tokens** (signed,
  TTL), Redis session cache.

**What is STUB / MISSING (evidence):**
- **`StubMediaRouter` returns SYNTHETIC SDP** with dummy ICE credentials and a `0.0.0.0` candidate;
  `completeNegotiation`/`subscribeViewer`/`endStreamSession` are **no-ops** —
  `infrastructure/media-router-port.ts:53-92`. The real SFU (Pion/mediasoup) **does not exist**;
  it is wired only when `MEDIA_ROUTER_URL` is set, which no implementation provides.
- **Live video / WebRTC / RTSP / JT1078 / Recording / Playback / HLS / video wall media: STUB or
  MISSING.** The JT1078/RTSP "adapters" are control-plane stubs; no RTP media flows.
- The frontend `VideoWallPage`/`LiveVideoPlayer` therefore cannot show real video.

**Endpoints (8 + 2 health):** `POST /streams`, `POST /streams/batch`, `DELETE /streams/:id`,
`GET /channels`, `GET /channels/:id`, `POST /channels`, `GET /vehicles/:id/channels` — REAL
control-plane mechanics (but stream open returns stub SDP). Tenant-scoped via header, **no JWT**.

**Tests (4 suites, 58 cases):** codec-strategy, signaling-token, stream-manager (against
`StubMediaRouter`), video-channel. Validate control-plane logic, not real video.

---

### 2.6 web-dashboard — **PARTIAL (complete polished UI; data is MOCK)**

A genuinely complete, production-looking React 19 SPA (MUI 6, TanStack Query, react-router 7,
i18next en/fa + RTL, maplibre-gl, echarts/recharts, zustand, react-hook-form + zod). 19 pages,
full layout/shell, dark theme, toast/confirm feedback, protected routes.

**The defining fact — `lib/mock-gate.ts`:** **mocks are ON by default in dev AND production.**
Only `identity-service` exists, so dashboard/map/trips/alarms/reports/assets/video pages are
**mock-fed** so the UI is "fully demoable." Toggles: `localStorage`/`?useMock=false`/
`VITE_USE_MOCK=false` turn mocks off (but then most pages return empty defaults because the
backends don't exist).

**Real vs mock API split (measured by grep of `src/api/*.api.ts`):**

| API module | Mock refs | Real axios calls | Verdict |
|---|---|---|---|
| `auth.api.ts` | 0 | 7 | **REAL** (login/refresh/me/logout) + 7 `NotImplementedError` stubs |
| `asset.api.ts` | 24 | 26 | **MOCK** (real calls hit non-existent endpoints → `withMockFallback` → mock) |
| `admin.api.ts` | 23 | 6 | **MOCK** |
| `fleet.api.ts` | 23 | 1 | **MOCK** |
| `alarm.api.ts` | 6 | 2 | **MOCK** |
| `report.api.ts` | 8 | 3 | **MOCK** |
| `video.api.ts` | 6 | 2 | **MOCK** |
| `geofence.api.ts` | 3 | 5 | **MOCK** (a map-engine backend exists, but the client uses mock fallback) |

→ **Only authentication is truly real. Every business domain is mock-backed.**

**Real auth client (`api/client.ts`):** axios with Bearer token, `X-Tenant-Id` header, **401 →
silent token refresh** with a shared refresh promise (no thundering herd), `{ data }` envelope
unwrapping, typed error normalization. This is correctly wired against identity-service.

**Frontend stubs (`NotImplementedError`):** register, forgot-password, reset-password, MFA login,
MFA manage — each throws with the exact missing endpoint. `MaintenancePage` and `CommandCenterPage`
are documented typed placeholders (no backend service exists).

**Tests (14 files, 107 cases):** auth.api, auth.store, token.storage, validation, errors,
live-tracking, + page tests (dashboard, map, trips, reports, assets, admin, alarms, video-wall).
jsdom; ECharts DOM-size warnings are benign. **Validate rendering/interactions against mock data,
not real APIs.**

---

## 3. Shared Libraries (packages/*)

All 7 are **foundational, real, and tested**. They are the strongest part of the codebase.

| Package | Public API (src/index) | Status | Tests | Notes |
|---|---|---|---|---|
| `shared-kernel` | `AggregateRoot`, `Entity`, `ValueObject`, `Identifier`, `Result`, `DomainEvent`, `TenantId`/`TenantContext`, `GeoPoint`, `Money`, pagination cursor | COMPLETE | 11 | DDD primitives + branded tenancy. Cursor is signed/tamper-proof. |
| `config` | `ConfigModule.forRoot` (zod-validated env, crash-fast) | COMPLETE | 2 | Single source of validated env. |
| `observability` | pino logger factory, `LoggerService`, correlation middleware, **W3C traceparent** | COMPLETE | ~3 | `traceparent.spec` validates spec compliance. |
| `persistence-knex` | knex factory (PgBouncer-aware), `BaseRepository`, **migrations runner** (`migrate.latest`) | COMPLETE | 1+ | Used by every service. |
| `cache-redis` | ioredis factory + `RedisModule` | COMPLETE | 1+ | Real ioredis. |
| `health` | `/health/live` + `/health/ready` (NestJS Terminus, knex + redis ping indicators) | COMPLETE | 1+ | Used by every service. |
| `web` | JSON:API **error envelope** + global exception filter + request-id interceptor | COMPLETE | 1+ | Consistent error shape. |

Missing-from- vision but acceptable: no `events`/`bus-kafka` package yet (Kafka is used inline per
service; Avro/Schema Registry not implemented — JSON values only).

---

## 4. Database Audit

**Engine:** PostgreSQL 16 via `timescale/timescaledb-ha:pg16` (bundles TimescaleDB + PostGIS +
pg_trgm + uuid-ossp; enabled in `infra/docker/init/postgres.sql`). **No** MongoDB, ClickHouse, or
Elasticsearch despite README claims (polyglot persistence was descoped by ADR-022 to "lean" PG-only).

**Schemas & tables (per service migrations):**

| Domain | Schema.Tables | Notes |
|---|---|---|
| Identity/IAM | `iam.tenants/users/password_history/roles/role_permissions/user_roles/organizations/api_keys/refresh_token_families/refresh_tokens/auth_sessions` | Real FKs, check constraints, unique indexes. |
| Audit | `audit.audit_entries` | Hash-chained; **never written to** (AuditRepository unused). |
| Outbox | `public.event_outbox` | Transactional outbox; relayed to Kafka. |
| Telemetry config | `telemetry.gateway_listeners` | Gateway listener config only. |
| Tracking | `tracking.vehicle_positions`(hypertable), `device_status`, `trip_events`, `idle_periods`, `parking_periods` | Hypertable on positions only. No retention/compression. |
| Geo | `geo.pois/addresses/speed_limits`, `tracking.geofences` | PostGIS geography + GiST/GIN. |
| Media | `media.video_channels/stream_sessions` | Control-plane only. |

**Tenant isolation (INV-I02):**
- **Application layer: ENFORCED** — every tenant-scoped repository uses `withTenantContext()`, every
  controller derives `tenant_id` from the principal/header (never the body).
- **Database RLS: PERMISSIVE (`USING(true) WITH CHECK(true)`)** on every tenant table across all
  services. The migrations explicitly state MVP ships permissive policies to harden later. →
  **A bug or bypass in the app layer would expose cross-tenant data; the DB does not enforce it.**

**Indexes/constraints:** comprehensive (B-tree, GiST, GIN, partial indexes e.g. active trips,
online devices). Foreign keys with `ON DELETE CASCADE`/`SET NULL`. UUID PKs via `gen_random_uuid()`.

**Hypertables/retention/partitioning:** `vehicle_positions` is a real hypertable (1-day chunks).
**No compression or retention policies anywhere** → time-series tables grow unbounded. Trip tables
are plain (non-hypertable) projections.

**Seed:** idempotent first-tenant + admin seed on identity boot (no separate CLI).

**DB ↔ app consistency:** table shapes match aggregate/repository fields. The one mismatch is the
**unused `audit.audit_entries`** (schema present, no writer).

---

## 5. Infrastructure / Docker Audit

`infra/docker/docker-compose.yml`:

**Infra services (all with healthchecks, named volumes, host ports):**
- `postgres` — `timescale/timescaledb-ha:pg16`, `shared_preload_libraries=timescaledb`, init SQL,
  `pg_isready` healthcheck. ✅ used.
- `redis` — `redis:7.4-alpine`, AOF + allkeys-lru. ✅ used.
- `zookeeper` + `kafka` — Confluent `cp-kafka:7.7.1`, **single broker, Zookeeper (not KRaft)**,
  topic auto-create. ✅ used.
- `rabbitmq` — `rabbitmq:3.13-management-alpine`. ❌ **NO application code uses AMQP anywhere.**
  Infrastructure-only; documented-only.
- `minio` — S3-API object storage. ❌ **NO application code uses S3/MinIO** (raw-packet retention is
  a `NullRawRetentionSink` no-op). Infrastructure-only.

**Application services in compose:** **only `identity-service` and `web-dashboard`.**
`device-gateway`, `gps-engine`, `map-engine`, `media-service` are **NOT in docker-compose** — they
run via `pnpm dev`/`pnpm --filter ... dev` against the same stack. web-dashboard's nginx
reverse-proxies `/api → identity-service`.

**Dockerfiles exist for 3 of 6 apps** (`identity-service`, `device-gateway`, `web-dashboard`).
**gps-engine, map-engine, media-service have NO Dockerfile.**

**Secrets/env:** `JWT_SECRET` required from `.env` (default placeholder `replace-me-...`).
`SEED_ADMIN_PASSWORD` default `ChangeMe!StrongPass123`. Reasonable for local dev; **not production
secrets** (Vault is documented-only).

**Startup order / readiness:** correct `depends_on: condition: service_healthy` chains
(postgres/redis → identity → web).

**Production readiness:** compose is explicitly a **local lean stack**. No K8s/Helm/Istio/ArgoCD
exists (all documented-only). Single-broker Kafka, single-instance outbox relay (no leader
election). Not HA.

---

## 6. Event Architecture Audit

**Kafka — REAL and actually used (the event-driven spine that works):**
- **Producers:** `device-gateway-service` (topics: `fleetvision.telemetry.position.raw`,
  `.alarm.raw`, `.device.raw`, `.command.ack`, `telemetry.session.lifecycle`), and
  `identity-service` (transactional outbox → `fleetvision.audit.audit-entries.events`).
- **Consumer:** `gps-engine-service` (group `gps-engine-service`, consumes `position.raw` +
  `session.lifecycle`).
- → This forms a **real pipeline: device → gateway → Kafka → gps-engine → TimescaleDB/Redis/WS.**
- Envelopes are **CloudEvents-aligned JSON**. **Avro + Schema Registry: NOT implemented**
  (deferred `bus-kafka` package).
- ✅ **DLQ / retry (Sprint D)**: gps-engine wraps every message in bounded in-process retries
  (transient) or straight-to-DLQ (structural), republishing to `<topic>.dlq` with forensic
  headers (original topic/partition/offset, reason, attempts, event/correlation ids).
  Idempotency now also covers trip/idle/parking projections (UNIQUE source_event_id).
- **Consumer groups / ordering:** ordering via `device_id` partition key; single consumer group.

**RabbitMQ — NOT USED in code.** No `amqp`/`rabbitmq` import anywhere. Pure infrastructure.

**gRPC — NOT USED in code.** ADR-004 mandates gRPC for internal sync; the only "gRPC" reference
(device registry) is an in-memory implementation behind a port. **DOCUMENTED_ONLY.**

**Internal eventing (gps-engine):** in-process `SignalBus` (EventEmitter) → WebSocket gateway.

**Verdict:** Only **device-gateway** and **gps-engine** are genuinely event-driven (and identity for
audit events). map/media/identity-business do not consume events. RabbitMQ and gRPC are dead infra.

---

## 7. API Audit (cross-service)

~55+ REST endpoints + 2 WebSocket gateways (gps-engine, media). All services expose `/health/live`
+ `/health/ready`.

**Authentication/authorization across services (critical pattern):**
- ✅ **Sprint B resolved this**: every backend service authenticates JWT/API keys via the shared
  `@fleetvision/auth` package (global CompositeAuthGuard + PermissionsGuard); the tenant is
  derived from the verified credential — never a client header. WS handshakes verify JWTs;
  rooms are tenant-scoped; the gateway admin API requires `telemetry.gateway.manage`.
  (Historical note: before Sprint B these services trusted `X-Tenant-Id` with no auth.)

**Status split:** ~85 % of endpoints are REAL implementations. Stubs/broken: map `/heat`,
map `/layers` (static), map `geocode` (returns 0,0), map routing/match (approximation),
media stream-open SDP (synthetic). **No "mock" backends exist server-side** — mocks live entirely
in the frontend.

---

## 8. Test Audit

**Counts (verified by running `pnpm test` + `pnpm --filter web-dashboard test`):**

| Suite | Files | Cases | Result |
|---|---|---|---|
| identity-service | 8 | 42 | ✅ pass |
| device-gateway-service | 14 | 156 | ✅ pass (Sprint D: +32 reliability) |
| gps-engine-service | 19 | 114 | ✅ pass (Sprint D: +56 incl. E2E/WS/DLQ; integration suites now EXECUTE — 16 real-PG tests that previously skipped) |
| fleet-management-service | 5 | 45 | ✅ pass |
| map-engine-service | 5 | 26 | ✅ pass |
| media-service | 4 | 58 | ✅ pass |
| packages (8 libs incl. auth) | ~10 | ~50 | ✅ pass |
| web-dashboard (vitest) | 14 | 107 | ✅ pass |
| **Total** | **~79** | **~548 backend + 107 web ≈ 655** | **all green** (2026-08-15) |

**Quality:** Tests **validate real behavior** in the strongest areas (binary protocol decoding,
FSM transitions, refresh-token reuse detection, auth rate-limiting, pagination-cursor tamper
resistance, traceparent compliance). They are **not** superficial.

**Gaps:**
- **Zero integration tests** against real PostgreSQL/Redis/Kafka/WebSocket anywhere.
- **No E2E/API tests.** No frontend E2E against a real backend.
- **Coverage not measured** (no coverage tooling configured).
- gps-engine's `TripRepository` (the suspect SQL), `TripEngine` orchestration, all controllers,
  Kafka consumers, and both WebSocket gateways are **untested**.
- Several suites print "worker failed to exit gracefully" (timer/handle leaks in teardown) —
  cosmetic, does not affect results.

---

## 9. Build & Runtime Verification (actually executed)

| Command | Status | Evidence |
|---|---|---|
| `pnpm install` | ✅ (already installed; lockfile present) | `pnpm-lock.yaml` |
| `pnpm typecheck` (`tsc -b` + per-pkg `--noEmit`) | ✅ PASS | exit 0 |
| `pnpm build` (`tsc -b`) | ✅ PASS | exit 0; `dist/` emitted |
| `pnpm test` (jest workspace + vitest web) | ✅ PASS | all suites green |
| `pnpm lint` (`biome check .`) | ✅ PASS | exit 0 (Sprint D — biome autofix applied repo-wide)

(Sprint D also ran the docker-backed integration/E2E suites against the live local stack:
PostgreSQL/Timescale, Kafka, Redis all exercised — see Sprint D report §Testing.)

---

## 10. TODO / FIXME / Stub / Mock Audit (codebase-wide)

**TODOs (6, all in web-dashboard, all honest "backend not built" markers):**
- `pages/CommandCenterPage.tsx`, `pages/MaintenancePage.tsx`, `types/{command,maintenance,notification}.types.ts`
  — each documents a missing backend service.

**Stubs / NotImplemented (significant):**
- `media-service` `StubMediaRouter` — synthetic SDP (§2.5).
- `web-dashboard` `lib/errors.ts` `NotImplementedError` — 7 auth endpoints (register/forgot/reset/MFA).
- `map-engine` `/heat` (empty cells), `/layers` (static), routing (straight-line), `geocode` (0,0).
- `gps-engine` PTO suppression (dead code), `stop.detected` (dropped), engine-hours persistence
  (`void`), trip-start debounce (config parsed, unused).
- `device-gateway` raw retention (`NullRawRetentionSink`), device registry (`InMemoryDeviceRegistry`).

**Mock data:** entirely a frontend concern — `apps/web-dashboard/src/mock/{admin,alarm,asset,fleet,report,video}-data.ts`
+ `lib/mock-gate.ts`. **No server-side mocks** (no fake backends).

**Hardcoded values of note:** map local-provider ETA guess (50 km/h), `streamerPod: 'stub-pod-0'`,
admin controller unauthenticated-by-default, dashboard empty-defaults when mocks off.

---

## 11. Security Audit

**Strong (real):**
- Argon2id password hashing; JWT verification with issuer/audience; **refresh-token reuse detection
  + family revocation + user-wide access-token kill**; rate limiting + lockout; fail-closed guards;
  generic error messages (no enumeration oracle); constant-time token-hash compare; idempotent Kafka
  producers; zod request validation on auth/user/api-key write paths.
- SHA-256 forensic checksum on every device message.

**Critical / High gaps:**
- **[P0] Permissive RLS everywhere** — tenant isolation is app-layer-only; DB does not enforce
  (`USING(true)` on all tenant tables).
- **[P0] No authn/authz on gps/map/media/gateway-admin services** — they trust a `tenant-id` header
  and have no JWT/RBAC; the assumed API-Gateway + OPA layer does not exist.
- **[HIGH] HS256 shared-symmetric JWT secret** — fine for MVP, but rotation/RS256+JWKS is deferred.
  Default `.env` ships a placeholder secret and a default admin password.
- **[HIGH] Audit log not written** — `audit.audit_entries` unused; forensic audit trail incomplete
  (only domain events → Kafka).
- **[MED] WebSocket gateways: no authz on room join; CORS `origin:'*'`** (gps-engine).
- **[MED] device-gateway admin API unauthenticated.**
- **[LOW] No rate limiting on non-auth endpoints; no CORS hardening on REST services; secrets in
  plain `.env` (Vault documented-only).**

No SQL injection surface found (all queries use Knex parameter binding / `?::uuid` raw with bound
params). No obvious secrets committed beyond the documented dev placeholders.

---

## 12. Architecture Audit (vision vs. reality)

| Documented intent | Reality |
|---|---|
| DDD + Clean Architecture per service | ✅ Largely followed (`domain`/`application`/`infrastructure`/`api` layers, ports/adapters). |
| CQRS + Event Sourcing | ❌ **Not implemented.** Simple CRUD repositories + insert/update projections. No command/query bus, no event store. (`trip_events` are projection rows, not an event-sourced aggregate.) |
| Event-driven (Kafka) | ⚠️ **Partially.** Gateway→gps-engine telemetry pipeline is real. Most services are not event consumers. |
| gRPC internal sync | ❌ **Not implemented** (in-memory registry behind a port). |
| Hybrid multi-tenancy (3 tiers) | ⚠️ Single shared-schema + app-layer tenant_id + permissive RLS. No tier differentiation. |
| Zero-trust (Keycloak/OPA/Vault/mTLS) | ❌ Self-issued HS256 JWT + in-process RBAC fallback. Keycloak/OPA/Vault/mTLS absent. |
| Polyglot persistence (8 stores) | ❌ Lean PostgreSQL-only (ADR-022). Mongo/ClickHouse/ES/RabbitMQ unused. |
| Kubernetes/Istio/ArgoCD | ❌ Docker Compose (local) only. |
| 14 bounded contexts | ⚠️ ~4–5 implemented (Identity, Telemetry/Tracking, Map, partial Media). ~9 not started. |

**Conclusion:** Clean Architecture / ports-and-adapters is genuinely respected in code. The heavier
architectural machinery (CQRS/ES, gRPC, event sourcing, service mesh, polyglot persistence) is
**on paper only**. This is a deliberate "lean MVP" pivot (ADR-021/022) and is internally consistent,
but the README's "Architecture at a Glance" overstates the implementation by a wide margin.

---

## 13. Feature Matrix

| Domain | Feature | Status | Evidence | Missing | Priority |
|---|---|---|---|---|---|
| Foundation | Monorepo + 7 packages + CI + Docker stack | COMPLETE | root `package.json`, `packages/*`, `ci.yml`, `docker-compose.yml` | — | P0 |
| Foundation | Typecheck/build/test | COMPLETE | all green | lint has 2 trivial drifts | P3 |
| Identity | Login + JWT + rate-limit + lockout | COMPLETE | `login.use-case.ts` | — | P0 |
| Identity | Refresh rotation + reuse detection | COMPLETE | `refresh.use-case.ts`, `refresh-token-family.ts` | — | P0 |
| Identity | Argon2id hashing | COMPLETE | `password-hasher.ts` | — | P0 |
| Identity | RBAC (permissions guard) | COMPLETE | `permissions.guard.ts` | OPA not integrated | P1 |
| Identity | Users CRUD | PARTIAL | `users.controller.ts` | no DELETE, no pagination params, body not zod-validated | P1 |
| Identity | Tenants provisioning | COMPLETE | `tenants.controller.ts`, `provision-tenant` | no suspend/reactivate | P2 |
| Identity | API keys issue/revoke | COMPLETE | `api-keys.controller.ts` | no auth of API keys in downstream svcs | P1 |
| Identity | MFA | MISSING | only `mfa_enabled` flag | no TOTP/OTP backend | P2 |
| Identity | Password reset/forgot/change | MISSING | `password_history` schema only | no endpoint | P1 |
| Identity | Audit log writes | ✅ COMPLETE (Sprint C) | `AuditRepository.append` wired in fleet-management (atomic w/ mutations); `request_id` column fixed to `text` | wire in identity/map/media mutations | P1 |
| Identity | Organizations | MISSING | `iam.organizations` schema only | no API | P2 |
| Telemetry | TCP/UDP transport | COMPLETE | `tcp-server.ts`, `udp-server.ts` | — | P0 |
| Telemetry | GT06/JT808/Meitrack decode | COMPLETE | `adapters/{gt06,jt808,meitrack}` | — | P0 |
| Telemetry | Packet dispatcher + fail-closed auth | COMPLETE | `packet-dispatcher.ts` | — | P0 |
| Telemetry | Kafka producer | COMPLETE | `kafka-producer.ts` | — | P0 |
| Telemetry | Device registry (durable) | ✅ COMPLETE (Sprint C) | `HttpDeviceRegistry` → fleet-management `/devices/resolve` (port unchanged; L1/L2 cache) | gateway→fleet event invalidation (TTL-bounded for now) | P1 |
| Fleet Mgmt | Fleet / Vehicle / Device domain + registry | ✅ COMPLETE (Sprint C) | `fleet-management-service` (`fleet` schema; CRUD, binding, resolve, audit, tenant-isolated) | mock dashboard Fleet UI | P1 |
| Telemetry | Raw packet retention | STUB | `NullRawRetentionSink` | S3/MinIO sink | P2 |
| Telemetry | Device command dispatch | MISSING | — | gateway has no command path | P2 |
| Telemetry | Gateway admin API authz | PARTIAL | `admin.controller.ts` (unauth) | add IAM guard | P1 |
| Tracking | Position pipeline | COMPLETE | `position-pipeline.ts` | — | P0 |
| Tracking | TimescaleDB hypertable | PARTIAL | `vehicle_positions` hypertable | no retention/compression | P1 |
| Tracking | Trip detection FSM | PARTIAL | `trip-fsm.ts` | orphan trips, no start debounce | **P1** |
| Tracking | Trip persistence | **BROKEN/risky** | `trip.repository.ts:40-60` | invalid `UPDATE...ORDER BY...LIMIT` SQL | **P0** |
| Tracking | Engine-hours persistence | MISSING | `void engineHoursFlushed` | no table | P1 |
| Tracking | Idle/parking FSMs | PARTIAL | `idle-fsm.ts`,`parking-fsm.ts` | PTO dead code, stop.detected dropped | P2 |
| Tracking | WebSocket realtime | PARTIAL | `realtime.gateway.ts` | no room authz, CORS `*` | P1 |
| Tracking | Kafka DLQ/retry | MISSING | `kafka-consumer.ts` | messages dropped | P2 |
| Map | PostGIS POI/geofence/address store | COMPLETE | geo migration | — | P1 |
| Map | Geofence CRUD + contains | COMPLETE | `location.controller.ts`, `geofence-service.ts` | — | P1 |
| Map | POI nearest/bbox, replay, cluster | COMPLETE | `poi/replay/cluster-service.ts` | — | P1 |
| Map | Reverse geocode | COMPLETE | `local-provider.ts` | — | P2 |
| Map | Routing / ETA / map-match | **STUB** | straight-line haversine | real road routing provider | P1 |
| Map | Forward geocode | **BROKEN** | returns 0,0 coords | return real coords | P1 |
| Map | Heatmap | STUB | `/map/heat` empty | aggregate from hypertable | P2 |
| Map | External providers (Mapbox/OSRM/Google) | MISSING | router wires local only | implement providers | P1 |
| Media | Channel registry + CRUD | COMPLETE | `channel-manager.ts`, migration | — | P2 |
| Media | Stream-session lifecycle (control) | COMPLETE | `stream-manager.ts` | — | P2 |
| Media | WebRTC / SFU / live video | **STUB** | `StubMediaRouter` synthetic SDP | real SFU (Pion/mediasoup) | P1 |
| Media | RTSP / JT1078 adapters | STUB | control-plane only | real media ingest | P2 |
| Media | Recording / playback / HLS | MISSING | — | all absent | P2 |
| Frontend | Auth (login/refresh/logout) | COMPLETE | `auth.api.ts`, `client.ts` | — | P0 |
| Frontend | App shell, routing, i18n, theme | COMPLETE | `App.tsx`, `router/`, `theme/`, `i18n/` | — | P1 |
| Frontend | Dashboard/Map/Trips/Assets/Reports/Alarms/Video/Admin UI | **MOCK** | `mock-gate.ts` + `mock/*-data.ts` | real API integration | P1 |
| Frontend | Register/Forgot/Reset/MFA pages | STUB | `NotImplementedError` | backend endpoints | P2 |
| Frontend | Maintenance/Command pages | STUB | typed placeholders | backend services | P2 |
| Contexts | Fleet/Asset, Driver, Fuel, Compliance, Analytics, Notification, Billing, Trip-service, Alarm-service | **MISSING** | no apps | greenfield services | P1–P2 |
| Infra | Kubernetes / Istio / ArgoCD / Terraform | MISSING | Compose only | production platform | P2 |
| Infra | Observability (OTel/Prom/Grafana/Loki/Jaeger) | MISSING | pino logger only | full stack | P2 |

---

## 14. Sprint Mapping

**Formal sprint status (docs/implementation/):**
- **Sprint A — GPS Data Integrity: COMPLETE** (report: SPRINT-A-GPS-DATA-INTEGRITY.md)
- **Sprint B — Security & Tenant Isolation: COMPLETE** (report: SPRINT-B-SECURITY-TENANT-ISOLATION.md)
- **Sprint C — Device & Fleet Management: COMPLETE** (report: SPRINT-C-DEVICE-FLEET-MANAGEMENT.md)
- **Sprint D — Real-Time Tracking & Telemetry Hardening: COMPLETE** (report:
  SPRINT-D-REALTIME-TRACKING-HARDENING.md) — duplicate-connection enforcement, retry+DLQ,
  idempotent projections, out-of-order policy, WS back-pressure, metrics/readiness,
  graceful shutdown, real-Kafka E2E.

(Original audit note: no formal sprint backlog file existed at audit time.) Sprint intent is only inferable from `package.json` descriptions, README
"Sprint 1" notes, and code comments ("Sprint 1" foundation → "Sprint 2" IAM → "Sprint 3" gateway →
"Sprint 8/9/10" gps/map/media). **Reconciling those implicit claims against code:**

- **Sprint 1 (foundation):** ✅ genuinely complete (monorepo, 7 packages, identity boots, Docker,
  CI, health, graceful shutdown).
- **Sprint 2 (IAM/auth):** ✅ substantially complete (login/refresh/RBAC/API keys/tenants); ❌ MFA,
  password reset, audit writes, orgs incomplete.
- **Sprint 3 (device gateway):** ✅ core complete (transport, protocols, dispatcher, Kafka); ⚠️
  device registry in-memory, raw retention no-op.
- **Sprint 7/8 (gps-engine):** ✅ pipeline + FSMs complete; ❌ trip-persistence bugs, engine-hours
  unpersisted, no DLQ.
- **Sprint 9 (map-engine):** ⚠️ partial — PostGIS CRUD complete, routing/geocode/providers weak.
- **Sprint 10 (media):** ⚠️ control-plane complete; ❌ actual video is a stub.
- **Frontend:** ✅ UI breadth complete; ❌ business data is mock-only (real integration ≈ auth only).

**Discrepancy:** code comments and `package.json` descriptions present services as more "delivered"
than the integration reality (mocks, stubs, in-memory registry). The frontend is the clearest case:
it looks complete but is a mock-backed demo shell.

---

## 15. Definition-of-Done check (applied)

A feature is COMPLETE only if it has backend + persistence + API + validation + authorization +
tests + error handling + (frontend integration where applicable) + not mock/stub + builds + real
integration. Applying this:

- **Truly COMPLETE (full DoD):** identity login/refresh/RBAC/API-keys; device-gateway transport +
  protocols + Kafka producer; gps-engine position pipeline + hypertable; map PostGIS POI/geofence/
  replay/cluster; frontend auth + shell.
- **Fails DoD (despite "working" code):** trip persistence (no integration test + suspect SQL +
  orphan trips → not correct); media video (stub); map routing/geocode (approximation/broken);
  all frontend business pages (mock); downstream service endpoints (no authz); audit log (unused).

---

## 16. Critical Problems

### P0 — Blocking / data-correctness
1. ✅ **RESOLVED (Sprint A)** — `completeTrip` invalid PostgreSQL rewritten as a deterministic
   tenant-scoped subquery.
2. ✅ **RESOLVED (Sprint A)** — orphan ACTIVE micro-trips now emit `trip.discarded` and close.
3. ✅ **RESOLVED (Sprint B)** — **Permissive RLS + no authn on downstream services.** Every backend
   service is now JWT/API-key authenticated via the new shared `@fleetvision/auth` package;
   tenant is taken from the verified credential, never a client header; RBAC enforces per-endpoint
   permissions; WebSocket connections + rooms are authenticated/authorized; the gateway admin API
   is guarded (`telemetry.gateway.manage`); API keys now authenticate; RLS policies hardened to
   real tenant predicates. See `docs/implementation/SPRINT-B-SECURITY-TENANT-ISOLATION.md`.
   **Caveat:** RLS is forward-ready only — the app connects as the `fleetvision` superuser/owner,
   which bypasses RLS; the repository-layer `WHERE tenant_id` filter is the real boundary today.

### P1 — Critical for MVP / architecture
4. ✅ **RESOLVED (Sprint A)** — engine-hours persist durably (idempotent on source_event_id).
5. ✅ **RESOLVED (Sprint C/D)** — persistent registry (`HttpDeviceRegistry` → fleet-management)
   with push-based cache invalidation + bounded retries.
6. **Map routing/geocode non-functional** for real use (straight-line; geocode returns 0,0); no
   external provider wired.
7. **Media path is a stub** — no real video/SFU; flagship live-video/playback features non-functional.
8. **Frontend is mock-fed** — every business page returns mock data; turning mocks off yields empty
   pages because backends don't exist.
9. ✅ **RESOLVED (Sprint C)** — audit wired (fleet mutations) with the request_id column fixed.
10. ✅ **RESOLVED (Sprint B)** — JWT + RBAC guards on every service; WS authenticated/authorized.
11. ✅ **RESOLVED (Sprint A, verified intact Sprint D)** — Timescale compression (7d) +
    retention (180d) on `vehicle_positions`.

### P2 — Important
12. Password reset/forgot/change + MFA missing (identity).
13. RabbitMQ + MinIO infra running but unused (waste/confusion); gRPC/CQRS/ES documented-only.
14. Only 3/6 apps have Dockerfiles; gps/map/media not in docker-compose.
15. Lint gate currently red (trivial) — would fail CI on the working tree.
16. No integration/E2E tests; coverage not measured.

### P3 — Nice to have
17. WebSocket room authz + CORS hardening; user-list pagination; `/auth/me` email hydration;
    organizations API; OPA integration; RS256/JWKS; observability stack.

---

## 17. Technical Debt

| # | Problem | Location | Impact | Risk | Suggested fix | Priority |
|---|---|---|---|---|---|---|
| TD1 | `completeTrip` invalid SQL | `gps-engine/.../trip.repository.ts:40-60` | trip-end writes fail | High (data loss) | rewrite as `UPDATE ... WHERE id = (SELECT id FROM ... ORDER BY started_at DESC LIMIT 1)` CTE/subquery; add integration test | P0 |
| TD2 | Orphan ACTIVE trips | `gps-engine/.../trip-fsm.ts:203-205` | ACTIVE rows leak | High (bad metrics) | emit `trip.ended` on micro-trip discard or delete the started row | P0 |
| TD3 | Engine-hours discarded | `gps-engine/.../trip-engine.ts:212` | no durable engine-hours | Med | add `engine_hours` table + persist flush | P1 |
| TD4 | Permissive RLS policies | all migrations | cross-tenant leak if app bug | High | harden to `USING(tenant_id = current_setting('app.current_tenant_id')::uuid)` once session var is reliable | P0/P1 |
| TD5 | In-memory device registry | `device-gateway/.../device-registry.port.ts:60` | can't manage devices | High (blocks real telemetry) | build device-management-service (gRPC/REST + `telemetry.telematics_devices`) | P1 |
| TD6 | Stale README/docs (Kotlin/K8s) | `README.md`, many `docs/` | misleading | Med | rewrite README to match ADR-021/022 reality | P2 |
| TD7 | Unused infra (RabbitMQ/MinIO) | `docker-compose.yml` | confusion, resources | Low | remove or wire (raw retention → MinIO) | P3 |
| TD8 | Frontend mock-gate default-on | `web-dashboard/.../mock-gate.ts` | demo-only data | High (perceived completeness) | build read APIs + flip default off per domain | P1 |
| TD9 | map geocode returns 0,0 | `map-engine/.../local-provider.ts:27-41` | broken forward geocode | Med | return real `geo.addresses` geom | P1 |
| TD10 | map routing straight-line | `local-provider.ts:67-88` | wrong distances/ETAs | Med | wire OSRM/Mapbox in `ProviderRouter` | P1 |
| TD11 | StubMediaRouter | `media-service/.../media-router-port.ts:53` | no real video | High (flagship feature) | integrate Pion/mediasoup SFU | P1 |
| TD12 | ✅ RESOLVED (Sprint D) — bounded retry + `<topic>.dlq` with forensic headers | `gps-engine/.../kafka-consumer.ts` + `message-processor.ts` + `dlq-producer.ts` | — | — | — | done |
| TD13 | ✅ largely RESOLVED (Sprint D) — real-PG integration suites execute (were silently skipping); real-Kafka E2E added | gps-engine/fleet/gateway | — | — | — | done |

---

## 18. COMPLETED (really implemented, full or near-full DoD)

- pnpm monorepo + 7 shared packages (config, observability, persistence-knex, cache-redis, health,
  web, shared-kernel) — all tested.
- identity-service: login, logout, logout-all, JWT (HS256) issue/verify, **refresh-token rotation
  with reuse detection**, Argon2id hashing, rate-limit + lockout, RBAC permissions guard, users CRUD,
  tenants provisioning, API keys issue/revoke, transactional outbox → Kafka, bootstrap seed, health.
- device-gateway-service: TCP (+UDP) transport with backpressure/idle-timeout, **real GT06/JT808/
  Meitrack binary decode/encode**, packet dispatcher (fail-closed auth), 3-tier auth resolver,
  session manager, connection pool, adapter registry + plugin loader, **idempotent Kafka producer**
  (CloudEvents, device-keyed), admin API, health.
- gps-engine-service: Kafka consumer, position pipeline (validate→dedupe→persist→cache→trip→broadcast),
  quality validation, haversine mileage filters, **trip/idle/parking FSMs + engine-hours**, TimescaleDB
  hypertable, Redis caches, **socket.io + redis-adapter realtime gateway**, device-status pipeline,
  REST read APIs, health.
- map-engine-service: PostGIS POI/address/speed-limit/geofence store (GiST/GIN), POI nearest/bbox,
  geofence CRUD + point-in-polygon, replay (GeoJSON), H3 clustering, reverse geocode, Douglas-Peucker,
  ProviderRouter framework, health.
- media-service: video-channel registry CRUD, stream-session lifecycle (control-plane), codec
  strategy, signaling tokens, WebSocket signaling gateway, Redis session cache, health.
- web-dashboard: full React 19 SPA — shell, routing, protected routes, i18n (en/fa + RTL), theming,
  **real auth client (login/refresh/logout with silent refresh)**, 19 pages, feedback components,
  107 passing tests.
- CI (lint/typecheck/build/test), Docker Compose lean stack, Postgres extensions, healthchecks.

---

## 19. PARTIALLY COMPLETED

- **identity breadth:** MFA (flag only), password reset/forgot/change (schema only), audit writes
  (repo unused), organizations (schema only), OPA (fallback only), user pagination, `/me` email.
- **device-gateway:** device registry (in-memory), raw retention (no-op), command dispatch (none),
  admin authz (none).
- **gps-engine:** trip persistence (orphan trips + suspect SQL), engine-hours persistence, PTO
  suppression (dead), stop.detected (dropped), Timescale policies, DLQ, WS authz.
- **map-engine:** routing/ETA/map-match (straight-line), forward geocode (0,0), external providers
  (none), heatmap (stub), layers (static).
- **media-service:** actual video/SFU/RTSP/JT1078/recording/playback/HLS (stub/missing).
- **frontend:** every non-auth page is mock-backed; several auth flows are NotImplementedError stubs.
- **infra:** only identity+web in compose; 3/6 Dockerfiles; RabbitMQ/MinIO unused; no K8s/observability.

---

## 20. NOT STARTED (no service / no code)

Of the README's 14 bounded contexts, these have **no backing service at all**:
- **Fleet / Asset / Vehicle management** (no vehicle/device CRUD service — the gateway's registry is
  in-memory; frontend assets page is mock).
- **Driver Management**
- **Vehicle Maintenance** (frontend placeholder only)
- **Fuel Management**
- **Compliance & Safety (ELD/HOS)** (engine-hours isn't even persisted)
- **Analytics & Reporting** (frontend reports page is mock)
- **Notification & Alerting** (frontend types placeholder; alarms are mock)
- **Billing & Tenant Management** (tenant provisioning exists in identity; no billing)
- **Dedicated Trip service** (trip *detection* exists in gps-engine; no trip *management* service)
- **Dedicated Alarm engine** (alarms are produced to Kafka; no alarm-processing service consumes them)
- **device-management-service** (referenced by gateway, not built)
- **API Gateway** (Kong — not present; services are directly exposed, header-auth only)
- Production platform: Kubernetes, Istio, ArgoCD, Terraform, Helm, OPA, Vault, Keycloak, OTel/Prom/
  Grafana/Loki/Jaeger — **all absent**.

---

## 21. MOCK_AND_STUB_REPORT

**Frontend mocks (the dominant form of "fake" in this repo):**
- `apps/web-dashboard/src/mock/{fleet,asset,alarm,report,admin,video}-data.ts` — static datasets.
- `apps/web-dashboard/src/lib/mock-gate.ts` — mocks **ON by default (dev + prod)**; `withMockFallback`
  returns mock on network error. Only `auth.api.ts` is mock-free.
- `apps/web-dashboard/src/api/auth.api.ts` — 7 `NotImplementedError` stubs (register/forgot/reset/MFA).

**Backend stubs:**
- `media-service` `StubMediaRouter` — synthetic SDP, no-op negotiation/viewer/end.
- `device-gateway` `InMemoryDeviceRegistry`, `NullRawRetentionSink`.
- `map-engine` local-provider routing (straight-line), `geocode` (0,0), `/map/heat` (empty), `/map/layers` (static).
- `gps-engine` PTO branch (dead), `stop.detected` (dropped), engine-hours (`void`).
- Identity `AuditRepository` (defined, never used).

**No server-side mock/fake backends exist.** Fake data is exclusively a UI concern.

---

## 22. Suggested Roadmap (based on real repo state, not old sprints)

```
NEXT EXECUTION PLAN

1. Stabilize the telemetry data path (correctness first)
   Goal: make gps-engine's trip/status writes correct & durable.
   Tasks: fix completeTrip SQL (TD1); close orphan trips (TD2); persist engine-hours (TD3);
          add Timescale retention+compression; add a Kafka DLQ; add pg/redis integration tests.
   Deps: none.  Result: trustworthy tracking data.  Priority: P0.

2. Build device/asset management (unblock real end-to-end telemetry)
   Goal: a durable registry the gateway can auth against + vehicles/assets CRUD.
   Tasks: new fleet/asset-service; telemetry.telematics_devices + vehicles/devices tables;
          REST CRUD; replace InMemoryDeviceRegistry with a real client; wire frontend assets page off mock.
   Deps: identity (auth).  Result: real devices flow through the gateway.  Priority: P1.

3. Service-edge security
   Goal: enforce authn/authz and tenant isolation beyond identity.
   Tasks: propagate JWT + RBAC into gps/map/media (shared guard); harden RLS policies (TD4);
          authenticate gateway admin API; lock down WS rooms + CORS.
   Deps: none.  Result: production-defensible boundaries.  Priority: P0/P1.

4. Complete the map layer
   Goal: real routing/geocoding.
   Tasks: fix geocode 0,0 (TD9); wire OSRM/Mapbox via ProviderRouter (TD10); implement heatmap.
   Deps: provider credentials.  Result: usable map intelligence.  Priority: P1.

5. Turn the frontend real (domain by domain)
   Goal: replace mocks with live data.
   Tasks: per domain, build read APIs (fleet stats, trips, alarms, positions) and flip mock-gate off.
   Deps: steps 1–2.  Result: a dashboard reflecting real fleet state.  Priority: P1.

6. Real media path (if video is near-term)
   Goal: actual live video.
   Tasks: integrate a real SFU (Pion/mediasoup) behind MediaRouter; JT1078/RTSP ingest; recording/HLS.
   Deps: media infra.  Result: working live video.  Priority: P1/P2.

7. Close identity gaps
   Tasks: MFA, password reset/change, audit-log writes, organizations, OPA.
   Deps: none.  Result: enterprise-ready IAM.  Priority: P2.

8. Fill remaining bounded contexts (driver, maintenance, fuel, compliance, analytics,
   notification, billing, alarm engine) — greenfield services behind the established pattern.
   Priority: P2.

9. Production platform (K8s/Helm/ArgoCD, OTel/Prom/Grafana/Loki, OPA, Vault, RS256/JWKS,
   multi-broker Kafka, leader-elected outbox). Priority: P2.

10. Doc hygiene: rewrite README + retire stale Kotlin/K8s docs (TD6). Priority: P2.
```

---

## 23. NEXT ACTION  (the single first step to take after this audit)

```text
NEXT ACTION:

Task:
  Fix the gps-engine trip-persistence data-integrity bugs (P0), then add the missing
  TimescaleDB retention policy. These are the only currently-broken/risky pieces on the
  real telemetry write path and they corrupt production data the moment live positions flow.

Why:
  typecheck/build/unit-tests are GREEN, which hides that the trip write path is unsound:
   - completeTrip() emits UPDATE ... ORDER BY ... LIMIT 1, which PostgreSQL rejects
     (no ORDER BY/LIMIT in UPDATE) — trip closes will fail or silently no-op.
   - micro-trips discarded by the FSM never emit trip.ended, leaving ACTIVE rows orphaned.
   - engine-hours are computed then discarded (void).
   - the vehicle_positions hypertable has no retention/compression → unbounded growth.
  None of this is caught by tests (no TripRepository / integration tests exist).

Files (read first):
  apps/gps-engine-service/src/infrastructure/persistence/trip.repository.ts        (completeTrip, lines 40-60)
  apps/gps-engine-service/src/application/trip-engine.ts                            (persistEvents, line ~204, ~212)
  apps/gps-engine-service/src/application/fsm/trip-fsm.ts                            (micro-trip discard, lines 203-205)
  apps/gps-engine-service/src/infrastructure/database/migrations/20260806110000_create_tracking_trip_schema.js
  apps/gps-engine-service/src/infrastructure/database/migrations/20260806100000_create_tracking_position_schema.js
  apps/gps-engine-service/src/__tests__/trip-fsm.spec.ts                             (existing FSM tests to extend)

Concrete tasks:
  1. Rewrite TripRepository.completeTrip to use a CTE/subquery:
       UPDATE tracking.trip_events SET ...
       WHERE id = (SELECT id FROM tracking.trip_events
                   WHERE vehicle_id=? AND tenant_id=? AND status='ACTIVE'
                   ORDER BY started_at DESC LIMIT 1);
  2. Resolve orphan ACTIVE trips: when a micro-trip is discarded, either delete the
     just-inserted ACTIVE row or emit a trip.ended to close it.
  3. Persist engine-hours: add a tracking.engine_hours table (or column) and write the
     flushed window instead of `void engineHoursFlushed;`.
  4. Add Timescale retention + compression to vehicle_positions
     (select_add_compression_policy + add_retention_policy in the position migration).
  5. Add integration tests (TripRepository against a real/testcontainers PG) covering
     start→complete, micro-trip discard, and engine-hours flush.

Dependencies:
  None. Self-contained within gps-engine-service. Does not require other services or infra
  changes beyond applying the updated migrations.

Expected result:
  - Trips close correctly and deterministically in PostgreSQL.
  - No orphan ACTIVE rows; engine-hours durable; hypertable bounded by retention.
  - New integration tests prove the write path; `pnpm test` stays green; `pnpm build` green.

Do not start (yet):
  - Do NOT begin device-management-service, frontend de-mocking, or media SFU work before this —
    those are P1 roadmap items and depend on the tracking data being trustworthy.
  - Do NOT refactor the FSM thresholds or touch the Kafka consumer beyond the DLQ noted in TD12.
  - Do NOT modify any other service in this step.
```

---

## 24. PROJECT HEALTH (summary statistics)

```text
PROJECT HEALTH

Services (apps):
- Total:        6  (identity, device-gateway, gps-engine, map-engine, media-service, web-dashboard)
- Complete:     1  (identity-service, core)
- Partial:      4  (device-gateway, gps-engine, map-engine, media-service)
- Stub:         1  (media-service media path)
- Broken:       0 services offline, but gps-engine trip-persistence is at-risk (P0)
- Missing:      ~9 bounded contexts have NO service (fleet/asset, driver, maintenance, fuel,
                compliance, analytics, notification, billing, alarm engine, device-management)

Shared packages: 7/7 COMPLETE (foundational)

Features (sampled ~50 across domains):
- Complete:    ~22
- Partial:     ~14
- Stub:        ~7
- Mock (UI):   ~8 (every non-auth frontend page)
- Broken:      2 (map geocode 0,0; gps trip-end SQL)
- Missing:     ~16

Frontend:
- Pages:       19
- Real API:    1  (auth only)
- Mock-backed: ~8 domains (dashboard, map, trips, assets, alarms, reports, admin, video)
- Stub pages:  4  (register, forgot, reset, mfa) + 2 placeholders (maintenance, commands)

Backend APIs:
- Endpoints:   ~55 REST + 2 WebSocket
- Real:        ~85% (mechanically)
- Mock:        0 server-side
- Stub/broken: ~6 endpoints (map heat/layers/geocode/route; media stream SDP)

Tests:
- Test files:  ~79 (65 backend suites + 14 frontend files)
- Test cases:  ~655 (548 backend + 107 frontend)
- Passing:     ~655  (verified 2026-08-15)
- Failing:     0
- Integration/E2E: 22+ real-PG integration + 1 real-Kafka→Timescale→WS E2E (Sprint D;
                  graceful skip without Docker)

Build:
- Status:      GREEN (typecheck ✅, build ✅, test ✅, lint ✅ — Sprint D)

Docker:
- Stack status: infra + identity + web in compose; gateway/gps/map/media run via `pnpm dev`
- Dockerfiles: 3/6 apps
- Unused infra: RabbitMQ, MinIO (running, no code uses them)

Database:
- Status:      PostgreSQL 16 + TimescaleDB + PostGIS — schemas/migrations real & consistent
- RLS:         hardened predicates (Sprint B); app connects as owner → repository-layer
               WHERE tenant_id is the enforcing boundary; vehicle_positions: no RLS
               (Timescale compression constraint — documented Sprint A decision)
- Hypertables: vehicle_positions; compression (7d) + retention (180d) ACTIVE
- Audit table: written (fleet mutations — Sprint C)

Events:
- Kafka:       REAL (gateway + identity produce; gps-engine + fleet-mgmt consume; Sprint D adds
               bounded retry + DLQ topics `<topic>.dlq` with forensic headers)
- RabbitMQ:    unused (infra only)
- gRPC:        not implemented (HTTP registry adapter instead — Sprint C)
- Avro/Schema Registry: deferred (JSON + strict boundary validation); DLQ: implemented (Sprint D)

Overall Project Completion:
- Estimated:   ~22%  (foundation + telemetry vertical ~65–70%; breadth ~5–10%)
- Confidence:  Medium-High

One-line verdict (post-Sprint D):
  Strong, well-tested foundation + a real auth/IAM service + a fleet/device registry + a
  production-hardened device→gateway→Kafka→GPS→Timescale→Redis→WebSocket telemetry vertical
  (retry+DLQ, idempotent, duplicate-safe, observable, restart-resilient — E2E-proven) + a
  polished (mock-backed) dashboard — but video is a stub, routing is approximate, ~9 of 14
  contexts are unbuilt, and the frontend remains demo-only until Sprint E.
```

---

*This report is evidence-based; every material claim cites a file path and, where possible, a
line number or symbol. It is intended to be handed to another AI so it can continue without
re-deriving the project state. The repository was not modified; only this file was created.*
