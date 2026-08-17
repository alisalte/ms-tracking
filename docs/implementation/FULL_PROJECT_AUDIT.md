# FleetVision — Full Project Audit

**Audit date:** 2026-08-17 · **Branch:** `main` @ `2041f0a "sp j"` · **Auditor method:** full-repo read-only forensic inspection; every claim below was verified against source code, executed commands, or both. Documentation claims were treated as unverified input, never as evidence.

> **Verdict up front: PARTIAL — NOT PRODUCTION READY.** The telemetry vertical (login → fleet/device registry → protocol ingestion → GPS engine → Timescale/PostGIS → WebSocket live map → geofences → alarms → notifications → reports) is **genuinely real**, unusually well-tested, and honestly documented. What is not real: video (mock), SMS/push (disabled stubs), several auth sub-flows, admin roles/audit/settings, and entire business contexts (fuel, compliance, billing, maintenance, commands). Production blockers exist in security (tenant-admin wildcard P0), database (RLS theater, shared migration ledgers), and infrastructure (5 of 9 backend services have no deployment path).

---

## 1. Executive Summary

- **Real and verified:** identity/auth (argon2 + rotating refresh tokens + API keys), device-gateway with three genuine vendor protocol decoders (GT06/JT808/Meitrack) over real TCP/UDP, gps-engine with real FSMs (trip/idle/parking/engine-hours) persisting to a real TimescaleDB hypertable + PostGIS, geofence detection with jitter/dwell semantics, Kafka with retry+DLQ, alarm engine with 8+ rule types, notification center (IN_APP/WS real, EMAIL code-real/config-gated), reporting service computing real SQL aggregations with CSV export, and a real-first React dashboard with three authenticated Socket.IO channels. All infrastructure clients are real (`kafkajs`, `ioredis`, `knex/pg`, `nodemailer`) — **no in-memory broker/DB substitutes exist in any production path**.
- **Mock or stub:** media streaming path (unconditional `StubMediaRouter`, canvas-synthesized video with DEMO badge), SMS/PUSH channels (honest failures, never fake success), raw packet retention (null sink), admin roles/audit/settings UI (mock-gated), register/forgot/reset/MFA frontend flows (`NotImplementedError`), Command/Maintenance pages (placeholders).
- **Broken / miswired:** frontend `GET /api/v1/channels` is not proxied to media-service and 404s against identity-service (Video Wall can never load real channels); compose runs only 4 of 10 apps while nginx proxies to 6 backend names.
- **Security:** one P0 (tenant-admin `*` wildcard grants platform permissions — tenant provisioning, gateway admin, cross-tenant tenant read), one P1 in media WS (signaling token never verified — sessionId alone grants access), revocation fail-open on Redis outage, no rate limiting beyond login/export, no helmet/CORS/body-limit hardening.
- **Verification executed on this machine:** `pnpm typecheck` ✅ (0 errors, 18 projects) · `pnpm test` ✅ exit 0 — **994 passed / 45 skipped** (Docker down) · web vitest 192/192 · `pnpm lint` ❌ 351 errors (346 = formatting drift; 5 = real analyzer findings) · `docker compose config` ✅ valid · Docker daemon **not running** → all live-stack E2E and DB-backed integration verification **BLOCKED** in this run.
- **Documentation is better than typical:** sprint reports A–J survived 30+ spot-checks with zero fabricated claims found; `PROJECT_STATUS_REPORT.md`'s *body* is stale (one false test count: fleet-service "122" vs actual 19; contradictory ~35% vs ~22% completion) even though its per-sprint banners are accurate.

---

## 2. Repository Inventory

| Item | Value |
|---|---|
| Root | `L:\ms06\ms06\MS06-Clone-Platform` (git, GitHub remote `alisalte/ms-tracking`) |
| Workspaces | `apps/*` (10) + `packages/*` (8); pnpm 9.15, Node ≥22, TS 5.6.3 |
| Apps | device-gateway-service, fleet-management-service, fleet-service, gps-engine-service, identity-service, map-engine-service, media-service, notification-service, reporting-service, web-dashboard |
| Packages | auth, cache-redis, config, health, observability, persistence-knex, shared-kernel, web |
| Other dirs | `infra/docker` (compose + init SQL + env), `docs/` (adr, api-specs, architecture, diagrams, governance, implementation (10 sprint reports), modules, runbooks, security, specs), `tools/generators`, `.github/workflows` (ci.yml) |
| Key root files | `PROJECT_STATUS_REPORT.md` (1,406 lines), `README.md` (382), `biome.json`, `tsconfig.base.json`, `pnpm-lock.yaml` (312 KB) |
| No `libs/`, no `docker/` at root, no `scripts/` | — |
| Source volume | ~580 TS/TSX files in apps; backend NestJS 10.4.15; frontend React 19 + Vite 6 |

## 3. Actual Architecture

Monorepo, Clean-Architecture-per-service (api / application / domain / infrastructure), NestJS 10 + TypeScript. **One shared PostgreSQL database** (`fleetvision`, TimescaleDB `pg16` HA image with PostGIS) with schema-per-bounded-context (`iam`, `audit`, `fleet`, `tracking`, `geo`, `media`, `notification`, `telemetry`, `public.event_outbox`) — not database-per-service. Real Kafka (cp-kafka 7.7.1 + Zookeeper) for telemetry/tracking/alarm/audit events. Real Redis 7.4 (sessions, revocation, rate limits, caches, Socket.IO adapters, FSM state, pub/sub invalidation). No RabbitMQ/MinIO (commented out of compose, no code exists — honestly removed). No API gateway; nginx (dashboard container) + Vite dev proxy do path-based routing to services. External providers: OSRM + Nominatim (opt-in compose profiles), Mailpit (dev SMTP sink). Deviation from `docs/specs/01` target architecture (Kotlin/K8s/Istio/Keycloak/gRPC/OPA): realized via ADR-021/022 as Node/NestJS + lean persistence — the pivot is documented and consistent.

## 4. Service Inventory

| Service | Responsibility | Port | DB schema | Kafka | Redis | WS | Deployed (compose/Dockerfile) | Verdict |
|---|---|---|---|---|---|---|---|---|
| identity-service | AuthN/Z, IAM, tenants, API keys, audit outbox | 3000 | iam, audit, public.event_outbox | producer (audit via outbox relay) | sessions/revocation/lockout | — | ✔/✔ | **REAL** |
| fleet-management-service | Fleets/vehicles/devices, gateway registry, lifecycle projection | 3006 | fleet (fleets, vehicles, devices, vehicle_devices) | consumer (session.lifecycle) | registry invalidation | — | ✗/✗ | **REAL** (not deployable) |
| fleet-service | Drivers + business trips (legacy sibling) | 3007 | fleet (drivers, business_trips) | — | wired, unused | — | ✗/✗ | **REAL but orphaned** |
| device-gateway-service | TCP/UDP protocol ingestion → Kafka | admin 8081 + configurable listeners | telemetry | producer (5 topics) | resolver L2, sessions | — | ✗ compose / ✔ Dockerfile | **REAL** |
| gps-engine-service | Pipeline, FSMs, Timescale, geofence eval, live WS | REST 3005 / WS 3001 | tracking | consumer + DLQ + producer (tracking.events) | caches, FSM state, WS adapter | ✔ | ✗/✗ | **REAL** (not deployable) |
| map-engine-service | Routing/matching/geocoding/geofences/clusters | 3009 | geo, tracking.geofences | — | 3-tier geo cache | — | ✔/✔ | **REAL** |
| notification-service | Alarms, notifications, channels, retry | REST 3008 / WS 3010 | notification | consumer + DLQ | state/rate/idempotency, WS adapter | ✔ | ✗/✗ | **REAL** (not deployable) |
| reporting-service | Read-only analytics + CSV | 3011 | none (reads tracking/notification/fleet) | — | report cache | — | ✔/✔ | **REAL** |
| media-service | Video control plane | REST (default 3000!) / WS 3002 | media | config parsed, **no code** | session cache | ✔ signaling | ✗/✗ | **PARTIAL / media path MOCK** |
| web-dashboard | SPA | 8080 (nginx) | — | — | — | client | ✔/✔ | **REAL-first** with gated mocks |

## 5. Bounded Contexts

| Context | Status | Evidence |
|---|---|---|
| Identity/IAM | **COMPLETE** (gaps: MFA, password reset, user delete) | `apps/identity-service/src` — 8 migrations, real aggregates, guards |
| Tenant | **PARTIAL** (provisioning real; P0 wildcard; no lifecycle saga) | `provision-tenant.use-case.ts` |
| Fleet Management (fleets/vehicles/devices) | **COMPLETE** | `apps/fleet-management-service` |
| Device Management (registry) | **COMPLETE** | devices.controller + binding.service + gateway auth-resolver |
| Device Gateway | **COMPLETE** (raw retention stub; zero default listeners) | adapters gt06/jt808/meitrack, tcp/udp servers |
| GPS Engine | **COMPLETE** | position-pipeline, FSMs, geofence-evaluator |
| Tracking (live/history/playback) | **COMPLETE** | realtime.gateway, positions/trips REST, MapPage playback |
| Map Engine | **COMPLETE** (provider-gated routing/geocoding) | osrm/nominatim/local + provider-router |
| Geofence | **COMPLETE** | map-engine CRUD + gps-engine detection + drawing UI |
| Alarm Engine | **COMPLETE** | evaluators + rules + dedup/auto-resolve |
| Notification | **PARTIAL** (EMAIL config-gated; SMS/PUSH stubs) | channels.ts |
| Reporting/Analytics | **COMPLETE** (12 endpoints) | reporting-service |
| Media/Video | **STUB/MOCK** (control plane real, streams fake) | StubMediaRouter unconditional |
| Maintenance | **NOT STARTED** | placeholder page only |
| Fuel | **NOT STARTED** | none |
| Driver | **PARTIAL** (backend real, no UI/deploy) | apps/fleet-service |
| Compliance | **NOT STARTED** | none |
| Billing | **NOT STARTED** | permission string only |

## 6. Sprint Status Audit

Method: read all 10 sprint reports + PROJECT_STATUS_REPORT; cross-check 5+ key claims each against code. Full detail in §31.

| Sprint | Claimed | Actual | Notes |
|---|---|---|---|
| A — GPS data integrity | Done | **VERIFIED** | deterministic completeTrip, engine_hours, Timescale policies — all in code |
| B — Security/tenant isolation | Done | **VERIFIED** | guards, RLS hardening, WS auth; RLS-not-enforced caveat honest |
| C — Device & fleet mgmt | Done | **VERIFIED** | fleet-management-service, resolve endpoint, audit wired |
| D — Realtime hardening | Done | **VERIFIED** | 7 bug fixes, DLQ, coalescing; test counts match exactly (gateway 160) |
| E — Real frontend/live tracking | Done | **VERIFIED** | real-first mock gate, port alignment, WS lifecycle |
| F — Map/geospatial | Done | **VERIFIED** | OSRM/Nominatim/router, GIST, nearby/in-bounds |
| G — Alarm/event engine | Done | **VERIFIED** | tracking.events producer, alarm pipeline, 6 live-stack scenarios |
| H — Notification center | Done | **VERIFIED** | fan-out/prefs/retry; SMS/PUSH honestly DISABLED |
| I — Geofence tracking | Done | **VERIFIED** (one claim initially false, self-corrected in J) | JwtModule global flag fixed by Sprint J |
| J — Reporting/analytics | Done | **VERIFIED** | 36/36, 5 browser E2E, mock report fixtures deleted |
| Pre-sprint parallel line (fleet-service, notification base) | "REAL core" | **PARTIAL** | fleet-service real but orphaned; PROJECT_STATUS's "122 cases" for it is **FALSE (actual 19)** |

## 7. Feature Matrix

Full matrix with 64 rows + evidence: **`docs/implementation/FULL_PROJECT_FEATURE_MATRIX.md`**. Roll-up: COMPLETE ≈ 33 rows, PARTIAL ≈ 12, STUB ≈ 8, MOCK ≈ 1 (video streaming), NOT STARTED ≈ 10 (incl. whole contexts).

## 8. Real vs Mock Audit

Production-path mocks/stubs (src only, tests excluded):

| Location | Kind | Class |
|---|---|---|
| `apps/media-service/src/infrastructure/media-router-port.ts:53-92` | `StubMediaRouter` synthetic SDP, ICE `0.0.0.0`, dummy fingerprint — **the only router impl, wired unconditionally** (`media.module.ts:56-59`) | **PRODUCTION MOCK** |
| `apps/web-dashboard/src/lib/video-stream.ts:48-139` + `useStreamSession.ts:131-175` | canvas-drawn fake road scene via `captureStream(24)`, fake signaling latency `setTimeout+Math.random` | **PRODUCTION MOCK (labeled)** — amber "DEMO" badge shown (`VideoTile.tsx:241-250`) |
| `apps/notification-service/src/application/channels/channels.ts:127-160` | SMS/PUSH always fail "provider not configured" | Honest STUB (never fakes success) |
| `apps/device-gateway-service/src/infrastructure/storage/raw-packet-storage.ts:22-26` | `NullRawRetentionSink` no-op | STUB (deferred feature) |
| `apps/device-gateway-service/src/infrastructure/adapters/stub/stub.adapter.ts` | test protocol registered in `BUILTIN_ADAPTERS` (`adapters/index.ts:28`) | STUB shipped in prod list (inert unless configured) |
| `apps/web-dashboard/src/api/{admin,alarm,fleet,notification,video}.api.ts` + `src/mock/*` | mock datasets behind `shouldUseMock()` gate (default OFF; network-error fallback only) | **DEV-ONLY** (gated; real-first asserted by `mock-gate.spec.ts:18-20`) |
| `apps/web-dashboard/src/api/auth.api.ts:130-177` | register/forgot/reset/MFA throw `NotImplementedError` | Honest stub |
| `apps/web-dashboard/src/api/admin.api.ts:259-326` | roles/audit → `[]`, settings → `NotImplementedError` in real mode | Honest partial |
| `VideoWallPage.tsx:160-170` | explicit toolbar "demo" alert simulation with `Math.random` | DEV/DEMO control (user-triggered, labeled) |

**Verdict:** mocks are concentrated in video + gated demo fixtures. No production REST/WS/Kafka/DB path returns fabricated data. The mock-gate design (real-first, `?useMock=true` opt-in) is honest and tested.

## 9. Backend Audit

- **Layering** is genuinely Clean-Architecture: controllers thin → use-cases/services → domain aggregates (`AggregateRoot` with domain events + transactional outbox) → knex repositories. Verified in identity (`User`, `RefreshTokenFamily`), fleet-management (binding invariants in transaction + audit), gps-engine (pure FSMs, orchestrator persists).
- **Dependency direction** correct everywhere inspected; DI via tokens; no circular imports found.
- **Dead/unreachable code:** identity `AuditRepository` (provided, never injected); device-gateway `DbPermissionResolver` (never registered); media `jt1078-adapter.ts`/`rtsp-adapter.ts` (parsers, imported only by tests); media `MEDIA_KAFKA_*` config + `kafkajs` dep (no Kafka code); frontend: `tailwind-ui/` kit (8 components), `StatCard.tsx`, `LoadingSpinner.tsx`, dead fixtures `mockFleetStats/mockActivity/mockAlerts/mockUtilization`, unused hooks (`useDeleteGeofence`, `useGeofenceContains`, `logoutAll`, …), dead `/api/v1/fleet` proxy rule.
- **Duplicate/conflicting:** fleet-service vs fleet-management-service co-own schema `fleet` (disjoint tables; fleet-service `down()` = `DROP SCHEMA fleet` would destroy fleet-management tables); stale `dist/*.d.ts` for deleted identity sources.
- **No throwing `NotImplementedError`, no empty catch, no `TODO`/`FIXME` markers in backend production code** (verified by grep) — deferrals are explicit comments and honest failures.

## 10. API Audit

~70 endpoints across 9 services (full inventory in service table + matrix doc). Consistent: global `CompositeAuthGuard`+`PermissionsGuard` via `APP_GUARD` (`packages/auth/src/auth.module.ts:71-72`), zod validation on most bodies, envelope `{data}` for identity/fleet-management vs RAW for gps/map/reporting (handled client-side by dual helpers), pagination bounded by shared schemas. Findings:
- **Dead/duplicate endpoints:** legacy `/location/geofences*` kept for compat alongside `/geofences` (documented); `/api/v1/fleet/*` proxied but never called by the frontend.
- **Unprotected:** only login/refresh/health are `@Public()` (correct). Protocol ports are raw TCP/UDP outside HTTP guards (by design, IMEI-auth).
- **Missing validation:** identity user-update/role-assign/tenant-provision raw `@Body()`; map-engine geofence bodies ad-hoc `Record<string,unknown>` coercion; media stream/channel bodies raw.
- **Inconsistencies:** media REST mounts at root (`channels`, `streams`) while everything else is `/api/v1/*`; `vehicleId` vs snake_case query params in alarm filters (silent no-filter risk).

## 11. Frontend Audit

React 19 + Vite 6 + MUI 6 + Tailwind 4 + TanStack Query 5 + Zustand + react-router 7 + i18next (en/fa 934-key parity) + MapLibre 6 (free OSM raster tiles) + supercluster + echarts/recharts + socket.io-client. 20 routes, all resolving; permission-gated routes present. Real auth handling: single-flight 401 refresh, proactive ~60s-early rotation, honest WS status chips (Connected/Reconnecting/Polling), skeletons + ErrorState + empty states across pages. Page verdicts: Login/Dashboard/Map/Trips/Assets/Geofences/Alarms/Notifications/Reports = **REAL**; Video Wall = **MOCK (labeled)**; Admin = **PARTIAL** (users real; roles/audit/settings mock); Register/Forgot/Reset/MFA = stubbed backend; Commands/Maintenance = placeholders. Contract issues: §41-B1 (channels 404), missing `VITE_NOTIFICATION_WS_URL`/`VITE_REPORT_API_PROXY_TARGET` in `.env.example`, dead fleet proxy. Tests: 26 unit spec files / 192 tests passing.

## 12. Database Audit

31 migrations across 8 services; 38 tables inventoried (see matrix/agent evidence in audit trail). Highlights:
- **One shared DB, schema-per-context.** Per-service ledgers exist for 4 services (`gps_engine_`, `fleet_management_`, `map_engine_`, `notification_schema_migrations`); **identity, fleet-service, device-gateway, media share default `schema_migrations`** — boot-order race / cross-rollback hazard.
- **RLS:** policies hardened (fail-closed `NULLIF(current_setting(...))`) in 5 hardening migrations; `FORCE` only on fleet-service/notification tables; **but the runtime is the bypass** — map-engine connects as `fleetvision_platform` (BYPASSRLS), reporting as superuser `POSTGRES_USER`, dev defaults are superuser; identity uses the NOBYPASSRLS app role. `tracking.vehicle_positions` RLS **explicitly disabled** (Timescale compression conflict). Real tenant boundary = repository `WHERE tenant_id` + `withTenantContext` GUC.
- **Orphan tables:** `platform_boot_sample`, `iam.password_history`, `iam.organizations`, `geo.speed_limits`, `telemetry.gateway_listeners` (env var used instead), `geo.addresses` (read, never written).
- **Hazards:** fleet-service rollback drops schema `fleet` (destroys fleet-management tables); env-dependent Timescale policy migration (7d/180d read from env at migration time); missing FKs documented as deliberate loose coupling; `init/postgres.sql` references a nonexistent migration `20260201000000`.
- **Injection:** none found — parameterized throughout; only 2 template-literal `SET LOCAL` sites, both guarded (UUID regex / numeric).

## 13. TimescaleDB/PostGIS Audit

- 1 hypertable: `tracking.vehicle_positions` (1-day chunks, composite PK incl. partition column), compression `segmentby=vehicle_id orderby=captured_at DESC` + retention policy (env-tunable 7/180 days) — `20260813110000_add_vehicle_positions_timescale_policies.js`.
- PostGIS: `geography(Point/Polygon,4326)` columns on positions/geofences/pois/addresses/speed_limits; 5 GIST indexes; real spatial SQL (`ST_DWithin`, `&&`+`ST_Expand` bbox prefilter, `ST_Covers`, `ST_IsValid`, KNN `<->`, `time_bucket` in reports). EXPLAIN-plan assertions exist in integration specs (run when Docker up).

## 14. Kafka/RabbitMQ Audit

Real Kafka (kafkajs). Topics: `fleetvision.telemetry.position.raw`, `.alarm.*`, `.device.*`, `.command-ack`, `.session.lifecycle`, `fleetvision.tracking.events`, `fleetvision.audit.audit-entries.events`; consumer groups per service; bounded retry + **real DLQ producers** (`<topic>.dlq`); idempotent consumers (Redis + `ON CONFLICT` + `source_event_id` uniques); deterministic event ids; CloudEvents-style JSON envelopes (Avro/Schema Registry deferred — documented). Gaps: correlation IDs carry business ids not the HTTP trace id (no end-to-end tracing); gateway `lingerMs` documented-intent only (kafkajs 2.2.4 lacks the knob); alarm→notification dispatch is an in-process call (Kafka in, direct out); identity outbox relay is single-instance (no leader election); consumers exist for all producer topics except `command-ack` (no consumer — commands not implemented). RabbitMQ: removed from compose, zero code — honest.

## 15. GPS/Telemetry Flow (traced end-to-end)

`DEVICE` → `TcpListener`/`UdpListener` (`tcp-server.ts:80-91`) → adapter `frame()` (GT06 CRC-ITU / JT808 BCC+stuffing / Meitrack checksum) → `PacketDispatcher.dispatch` (`packet-dispatcher.ts:54-168`): decode → IMEI resolve (L1 LRU → L2 Redis → L3 HTTP fleet-management `/devices/resolve` via API key, fail-closed) → session binds **registry-sourced** tenant/vehicle ids (`assertCanPublish` before every publish) → `DeviceGatewayKafkaProducer` (keyed by deviceId) → **`fleetvision.telemetry.position.raw`** → gps-engine `KafkaConsumer.eachMessage` → envelope parse → `PositionPipeline`: validate (range/future/stale + quality) → dedupe (bounded Set) → insert (`ON CONFLICT (event_id,captured_at) DO NOTHING`, failure→retry/DLQ) → `TripEngine` (Redis-loaded trip/idle/parking FSMs + haversine w/ jump filter; persists trip/idle/parking/engine-hours projections idempotently) → `GeofenceEvaluator` (bbox prefilter + `ST_Covers`/`ST_DWithin`, jitter+dwell, durable `tracking.geofence_state`) → Redis latest-position write-through → `SignalBus` → `RealtimeGateway` (Socket.IO, JWT-verified handshake, `tenant:<id>:fleet` room, 250ms coalescing, redis-adapter fan-out) → frontend `useLiveTracking` → MapPage markers. Tracking events also republished to `fleetvision.tracking.events` → notification-service alarm evaluators. **The chain is fully real and covered by integration specs (when infra is up) + a Sprint-E frontend-flow integration spec.**

## 16. Map/Geofence Audit

Provider router is capability-aware and **fail-closed** (503 `MapProviderUnavailableError`; local provider throws rather than fabricating routes — the old straight-line/50km-h mock was deliberately removed, `local-provider.ts:79-85`). OSRM route+match and Nominatim geocode are real `fetch()` integrations, registered only when env URLs set, Redis-cached, tested against mocked fetch. Geofence CRUD = 12 routes, PostGIS-backed, validated (`ST_IsValid`), integration-tested (13 scenarios when DB up), browser E2E for drawing + isolation. Clusters/heat = real H3 SQL over the hypertable. China region providers = stub comment only.

## 17. Alarm Audit

Rule types: overspeed, ignition on/off, device-offline, trip started/ended, excessive-trip, prolonged-idle, parking, geofence enter/exit/dwell. Kafka-driven evaluation with envelope validation, bounded retry, DLQ, Redis idempotency; one-OPEN-alarm dedup + auto-resolve (observed live in test logs); severity + tenant scoping throughout; alarm→notification dispatch verified in integration spec (provider invocation tested without real SMTP — honestly reported). Rules CRUD API exists (no dedicated UI page yet — managed via API/permissions today).

## 18. Notification Audit

| Channel | Implemented | Configured | Tested | Provider ready |
|---|---|---|---|---|
| IN_APP | ✔ persisted | ✔ | ✔ integration | ✔ (is the record) |
| WebSocket | ✔ `notification.new` | ✔ | ✔ + e2e | ✔ |
| EMAIL | ✔ nodemailer | ✖ unless `NOTIF_SMTP_HOST` (Mailpit dev profile) | ✔ (provider invocation; SMTP delivery honestly reported unconfigured) | ✔ code, provider external |
| SMS | STUB — always fails "not configured" | ✖ | ✔ (failure path) | ✖ no provider |
| PUSH | STUB — same | ✖ | ✔ | ✖ no FCM/APNs |

Durable retry (`next_attempt_at`, `FOR UPDATE SKIP LOCKED`), per-user fan-out with preferences, per-tenant/user/channel rate limiting, read-state, unread counts — all real and integration-tested.

## 19. Reporting/Analytics Audit

**Real.** 12 endpoints, read-only SQL role (`SET LOCAL TRANSACTION READ ONLY` + statement_timeout), Redis cache (tenant+filter-bound keys, 30s, fail-open), CTE aggregations over trip/idle/parking/positions/alerts, time-leading indexes added via domain migrations, CSV export with RFC-4180 + BOM + formula-injection neutralization + export rate limit. No fabricated rows anywhere (grep for sample/fake/fabricat in src: zero). Frontend Reports page real with freshness labels; 5 browser E2E including byte-verified CSV and cross-tenant isolation (foreign vehicleId → 0 rows).

## 20. Video/Media Audit

Separation of concerns: **protocol parsing** (JT1078 BCD/Beijing-time parser, RTSP SDP parser) = real code but **unwired**; **stream ingestion/relay** = none (no SFU; `MEDIA_ROUTER_URL` parsed, never used; `StubMediaRouter` unconditional returning synthetic SDP with dummy ICE `stubstubstubstub`/`0.0.0.0`); **control plane** (channel registry, session lifecycle, signaling tokens in Redis, codec strategy H264/H265 passthrough-vs-transcode) = real code + DB; **frontend playback** = canvas-synthesized streams with visible DEMO badge + fake signaling client (450ms setTimeout, random latency); **recording / historical playback / HLS / WebRTC** = not started. WS signaling: token presented but **never verified** (P1 — §21). Media-service REST also mounts at root path and defaults to port 3000 (collision with identity in any default deployment) and has no compose entry/Dockerfile/proxy — the whole service is dev-run only.

## 21. Security Audit

**Authentication** — HS256 pinned everywhere (no alg confusion), secret ≥32 required, opaque rotating refresh tokens with family reuse detection, argon2id (64MiB/t3) passwords **and** API keys, prefix+hash API key lookup, scope containment. **Authorization** — global guards, `@Public()` limited to login/refresh/health, permissions embedded in JWT (stateless; revocation via Redis keys within 900s TTL).
**Findings (ranked):**
- **P0 — tenant-admin wildcard:** `SYSTEM_ROLES` seeds per-tenant `tenant-admin: ['*']`; `permissionSatisfies` matches `*` against anything → any tenant admin can `POST /tenants` (provision tenants with chosen admin credentials), `GET /tenants/:id` (cross-tenant read, unscoped lookup), device-gateway admin (enable/disable listeners), gps-engine DLQ admin. (`permission-catalog.ts:126,141-145`; `tenants.controller.ts:24-85`; contrast the explicit JWT-rejection defense at `devices.controller.ts:59-63` proving awareness.)
- **P1 — media signaling token never verified:** handshake checks only that a session exists; the 256-bit token is dead weight; `verifySignalingToken()` has zero callers (`signaling-gateway.ts:62-78`).
- **P1 — revocation fails OPEN on Redis outage** (documented availability choice; signature/expiry remain the boundary) (`composite-auth.guard.ts:139-151`).
- **P1 — bootstrap credential:** hardcoded `SEED_ADMIN_PASSWORD` default in code + compose defaults + init-SQL dev passwords; seed runs on the production container path (`bootstrap-seed.ts`, compose `NODE_ENV: production`); `POST /tenants` accepts unvalidated admin passwords.
- **P1 — rate limiting gaps:** only login (per-IP/per-user + lockout), CSV export, notification delivery; `/auth/refresh` unlimited; login per-IP limiter uses `req.ip` without `trust proxy` (self-DoS / bypass behind proxy).
- **P2:** single shared JWT audience + one HS256 secret for all services; notification WS CORS default `'*'`; no helmet/body-size limits/CORS strategy on HTTP; WS handshakes skip revocation check (logout leaves sockets ≤15min); raw-body validation gaps (§10); device auth = IMEI knowledge only; provider error strings (with upstream URLs) surfaced in 503s; tokens in localStorage (XSS trade-off).
- **Positive:** no SQL injection surfaces (parameterized; 2 guarded `SET LOCAL` sites); no path traversal (no file serving); no command execution; no SSRF (provider URLs from env, coordinates validated, `q` encoded); 5xx responses sanitized by `GlobalExceptionFilter`; no secrets logged.

## 22. Tenant Isolation Audit

Model: tenant from **verified credential only** (`@CurrentTenant()` reads `req.auth`); `X-Tenant-Id` switching validated or 403; repositories add `WHERE tenant_id` everywhere (spot-checked all 9 services); `withTenantContext` sets GUC per transaction. **Cross-tenant behavior tests that exist and assert rejection:** gps-engine device/trip reads + WS rooms (`tenant-isolation.integration.spec.ts:83-90`, `realtime-isolation.spec.ts:18-29`), map-engine geofence CRUD (`sprint-i-geofence-crud.integration.spec.ts:245-263`), reporting filters (`sprint-j...:352-360`), fleet-management binding (`binding-isolation...:178,186`), browser E2E tenant isolation (geofences + reports). **Gaps:** notification/media/fleet-service/identity resources have **no** cross-tenant spec; all existing tests are repository-level, not HTTP-token-level; RLS is not the enforcement boundary in practice (§12); the P0 wildcard breaks isolation at the platform level.

## 23. Test Audit

Executed 2026-08-17 (Docker daemon **down** — integration suites requiring live PG skip or pass vacuously, see below):

| Suite | Files | Passed | Skipped | Notes |
|---|---|---|---|---|
| packages (8) | 16 | 87 | 0 | auth 38 (guards/verifier), persistence 12, kernel 18… |
| device-gateway | 16 | 156 | 4 | integration suite skipped (no DB); adapters/dispatcher/session unit real |
| fleet-management | 6 | 33 | 17 | 2 integration suites skipped |
| fleet-service | 1 | 19 | 0 | unit only — no integration at all |
| gps-engine | 29 | 165 | 24 | 5 integration suites skipped (real throwaway-DB harness incl. Timescale+PostGIS when up) |
| identity | 8 | 42 | 0 | **unit-only** (domain/config/hasher) — no DB/Kafka integration |
| map-engine | 10 | 74\* | 0\* | \*13 integration scenarios **pass vacuously** without DB (`if (!ctx) return` guards) |
| media | 4 | 58 | 0 | all unit (stub router by design) |
| notification | 9 | 132\* | 0\* | \*14 integration scenarios vacuous without stack |
| reporting | 2 | 36\* | 0\* | \*integration vacuous (own log: `[reporting integration] skipped:` while suite "passed") |
| web-dashboard | 25 | 192 | 0 | vitest; mock-mode forced in setup; mock-gate default asserted |
| **Total** | **126** | **994** | **45** | exit 0 |

Quality findings: (1) **vacuous-pass pattern** — map/notification/reporting integration specs `return` early inside `it()` when infra is absent, counting as *passed*; gps/fleet-mgmt/gateway use suite-level skip (counted *skipped*). Net: in a no-Docker run, **zero** integration scenarios actually execute, though 244 report green. (2) identity has no integration tests at all. (3) No HTTP/token-level cross-tenant tests (guard chain unit-only). (4) E2E (Playwright, 5 files/12 tests incl. full geofence→alarm→notification journey) never runs in CI and requires the live stack. (5) Kafka-facing specs mock the broker except the gateway's real-HTTP integration.

## 24. E2E Audit

Playwright 1.50, 5 spec files, 12 tests: notifications (2), geofences CRUD+isolation (3+1 conditional), geofence→alarm→notification pipeline (1), history playback (1), reports (5 — Sprint J, includes byte-verified CSV + cross-tenant). Shared login helper caches a session to respect the login throttle. **Not runnable in this audit (Docker down) and not wired into CI** — `.github/workflows/ci.yml` runs lint/typecheck/build/test only. Verdict: well-designed, BLOCKED from verification here; when the stack is up they exercise the real UI against real services (no mocking layer in specs).

## 25. Build/Typecheck/Lint

| Command | Result | Detail |
|---|---|---|
| `pnpm typecheck` | ✅ PASS | `tsc -b` + 18 project typechecks, 0 errors |
| `pnpm lint` | ❌ FAIL (exit 1) | **351 errors, 1 warning**: 346 = formatter (repo-wide format drift, CRLF-heavy); 5 real = 4× `useTemplate` (map-engine providers), 1× `useExhaustiveDependencies` (`FleetMap.tsx:329`); warning = unused var (`geofences.e2e.spec.ts:126`) |
| `pnpm build` | ⚠️ partial | root `tsc -b tsconfig.json` references only 3 apps + 8 packages — **gps/map/media/notification/fleet/reporting/web are never compiled by the root build or CI build gate** (typecheck covers them; app Dockerfiles build individually) |
| `pnpm test` | ✅ exit 0 | 994/45 (above) |
| `docker compose config` | ✅ valid | validated with `--env-file infra/docker/.env` |

All failures are **pre-existing** (working tree clean at `2041f0a`).

## 26. Docker/Infrastructure

Compose (valid; daemon **not running** — no live container verification possible): postgres (timescaledb-ha pg16, healthcheck), redis 7.4 (AOF+LRU), zookeeper+kafka (healthchecks, dual listener), identity ✔, reporting ✔, web-dashboard ✔ (only app **without** a healthcheck), map-engine ✔ (BYPASSRLS role), opt-in profiles: osrm (`routing`), nominatim (`geocoding`), mailpit (`mail`). **Absent from compose:** fleet-management, fleet-service, gps-engine, notification, media, device-gateway (which has a Dockerfile — mismatch). No resource limits, no custom networks, dangling `rabbitmq-data`/`minio-data` volumes for commented-out services. Dockerfiles (5): all multi-stage, all non-root (gateway = distroless; web = nginx-unprivileged), none with HEALTHCHECK instruction (compose-side only). Nginx proxies to 6 backend service names that don't exist in compose → 502 by design for 5 of them.

## 27. Configuration Audit

~250 env vars parsed via zod per service; no raw `process.env` in domain code. Findings:
- **JWT_AUDIENCE drift:** shared schema default `fleetvision` vs device-gateway/fleet/notification defaults `fleetvision-identity`, compose default `fleetvision-identity`, `.env` = `fleetvision-identity`, `.env.example` = `fleetvision`. Currently consistent only because `.env` overrides; host-run services without env would reject compose-issued tokens.
- **Dead vars:** `MEDIA_KAFKA_*` (4), `VITE_APP_TITLE`; `DBURL_PLATFORM` passed to identity but never parsed there; `ip_allowlist` column unused.
- **Undocumented:** `VITE_NOTIFICATION_WS_URL`, `VITE_REPORT_API_PROXY_TARGET`, `VITE_GPS_WS_URL` (used with hardcoded fallbacks) missing from `.env.example`; compose interpolates ~10 vars present in neither env file.
- **Stale `infra/docker/.env`:** missing 37 keys that `.env.example` documents (all gateway/notification/mailpit config). `.env` itself is **untracked** (gitignored — verified `git ls-files`); hardcoded *default* credentials exist in code/compose/init-SQL locations (listed in §21; values not reproduced).
- **Env-dependent migration** (Timescale policies) silently diverges environments.

## 28. Dependency Audit

- **Duplicate purpose:** echarts+echarts-for-react **and** recharts (both used, recharts only in 2 files); `react-router` + `react-router-dom` (v7 redundancy); **zod split across majors** (backend 3.23.8 exact vs web ^4.4.3).
- **Unused:** `@nestjs/jwt` declared in 5 services that verify via the auth package; `kafkajs` in media-service (no code); `prom-client: "15"` floating range (locked 15.1.3); axios declared ^1.8.1 / locked 1.19.0 (range drift).
- **Single versions** (good): NestJS 10.4.15, react 19.2.8, socket.io(-client) 4.7.2, kafkajs 2.2.4, knex 3.1.0, TS 5.6.3, jest 29.7, pino 9.5, ioredis 5.4.1, pg 8.13.1. Two `ws` versions via engine.io transitive.
- **Currency:** NestJS 10 (v11 current), socket.io 4.7 (4.8 current), Biome 1.9 (2.x current), MUI 6.4.6 — all one-ish major behind; no known-vulnerable pins identified by inspection (no scanner run — none installed, and installing is out of audit scope).

## 29. Code Quality

Strengths: consistent layering, pure FSMs, parameterized SQL, explicit failure modes, extensive "why" comments, near-zero TODO/FIXME, no `any`-walls spotted, errors centralized via `GlobalExceptionFilter`. Debt: 346-file format drift breaking lint; two fleet services + shared schema; 6 orphan tables; dead-code clusters (§9); 1MB root `tsconfig.base.tsbuildinfo` artifact (gitignored, regenerates); stale dist declarations; `console.log` absent from backend src (reporting integration spec has one deliberate warn); duplicate charting libs; informal commit messages ("sp j", "checkall3") vs the governance doc's standards.

## 30. Observability

pino structured logging with AsyncLocalStorage correlation (`trace_id`/`correlation_id`/`tenant_id`/`user_id`), `x-request-id` + W3C traceparent middleware, ~40 bounded prom-client metrics via `MetricsModule` (`/metrics` on gateway/gps/map/notification/reporting only — **identity/fleet-management/fleet/media lack it**), terminus `/health/live` + `/health/ready` (DB+Redis pings) on all 9 backends. **No** metrics/tracing backend (Prometheus/Grafana/Jaeger/Loki/OTel) anywhere, and **request ids do not propagate to Kafka messages** (producers stamp business ids; `RequestIdInterceptor` is a no-op passthrough) — correlation dies at the service boundary.

## 31. Documentation Accuracy

| Source | Verdict |
|---|---|
| Sprint reports A–J | **Accurate.** 30+ spot checks: endpoints, migrations, test counts (gateway 160, notification 132, map 74, web 192, reporting 36, auth 38, e2e counts) all match code exactly; limitations sections honest (SMS/push disabled, OSRM not live-tested, WS ACL deferred). One Sprint I claim (JwtModule global) was initially false and Sprint J explicitly corrected it. |
| `PROJECT_STATUS_REPORT.md` | **Banners accurate; body stale + one FALSE claim.** fleet-service "122 cases" → actual **19**; contradictory completion figures (~35% §0 vs ~22% §24); stale tables (contexts "MISSING", analytics "NOT STARTED", "3 of 6 Dockerfiles", "9 apps", rabbitmq/minio "running"). |
| `README.md` | Mostly honest PLANNED/IMPLEMENTED labels; overstates "RLS-enforced" (mixed reality — §12), says React 18 (code = 19) and omits 2 of 10 apps. |
| `docs/specs/01`, `docs/architecture/*`, `docs/modules/*` (24), `docs/security/*`, `docs/runbooks/*`, ADR-001..012 | **Aspirational design-phase; superseded by ADR-021/022** (Kotlin/K8s/Keycloak/OPA/gRPC never built; runbooks describe pipelines that don't exist — actual CI is one GitHub Actions job). Kept as historical targets; README warns about this. |
| `docs/adr/ADR-021/022` | **Consistent with code.** |

## 32. Git/Worktree Status

At audit start: 4 modified/untracked files (sprint-J leftovers). They were committed mid-audit by the owner as `2041f0a "sp j"` (16 files: reports e2e, reports.spec, vite proxy rule, nginx rules, …) — **working tree now clean**. Untracked-but-ignored: `infra/docker/.env` (dev secrets, gitignored ✔), `*.tsbuildinfo` (ignored ✔). No large/generated files tracked (901 files; biggest = lockfile/docs). No accidental secrets in git (init-SQL/compose *defaults* are dev passwords by design — flagged in §21 but intentional dev ergonomics). `.gitignore` gap: Playwright artifacts (`test-results/`, `playwright-report/`, `e2e/.results`) not listed.

## 33. Technical Debt

**P0 — blocks production**
1. Tenant-admin `*` wildcard → platform escalation (§21).
2. No deployment path for 5 backend services (no Dockerfile/compose) while nginx proxies to them.
3. Frontend `/api/v1/channels` misroute → Video Wall permanently broken against real backend.

**P1 — serious architectural/security risk**
4. RLS runtime bypass (BYPASSRLS/superuser connections; positions table RLS off) — isolation is code-only.
5. Shared default `schema_migrations` ledger for 4 services on one DB.
6. fleet-service rollback `DROP SCHEMA fleet` destroys fleet-management tables.
7. Media signaling token unverified; media REST default port collides with identity (3000).
8. Revocation fail-open; no general rate limiting; no `trust proxy`.
9. Seed admin + default credentials on production container path.
10. JWT_AUDIENCE config drift across services/env files.
11. Root build/CI misses 6 of 9 backend apps; E2E and integration (DB) suites never run in CI.

**P2 — important, non-blocking**
12. Vacuous-pass integration pattern (map/notification/reporting) misrepresents coverage without Docker.
13. identity has zero integration tests; no HTTP-level cross-tenant tests anywhere.
14. Outbox relay single-instance; Kafka correlation ids not propagated; 4 services without `/metrics`; no observability backend.
15. Env-dependent Timescale migration; 6 orphan tables; stale `.env` vs `.env.example` (37 keys); dead env vars/deps; dead frontend clusters; lint format debt (346 files).

**P3 — cleanup:** duplicated fleet naming, dead proxy rule, dual chart libs, zod major split, Playwright gitignore entries, stale dist `.d.ts`, informal commit messages, README/STATUS report refresh.

## 34. Production Readiness (0–100, evidence-based)

| Dimension | Score | Basis |
|---|---|---|
| Architecture | **72** | Real clean-architecture services, real brokers, honest failure modes; dinged for fleet-service split/shared schema, no API gateway, media stub, 6-apps-unbuilt reality vs 20-service spec |
| Security | **52** | Strong authn/crypto/isolation-in-code; P0 wildcard, P1 WS token, fail-open revocation, no rate limiting/helmet, bootstrap creds |
| Backend | **70** | 7 real services w/ tests; media path fake; orphaned fleet-service; dead-code pockets |
| Frontend | **68** | Real-first, honest states, good i18n; video mock, admin partial, auth sub-flows stubbed, dead code |
| Database | **64** | Excellent schema/migrations/Timescale/PostGIS; RLS theater, ledger conflicts, orphans, env-dependent migration |
| Messaging | **74** | Real Kafka w/ DLQ/retry/idempotency/dedup; no schema registry, correlation not propagated, direct alarm dispatch |
| Observability | **42** | Good logging/correlation/health + metrics endpoints on 5; no backend, no tracing, request-id dies at Kafka |
| Testing | **66** | 994 green incl. deep domain tests; vacuous-pass pattern, identity unit-only, E2E/integration not in CI |
| Infrastructure | **40** | 4 of 10 apps deployable; no limits/gateway/deploy pipeline; minimal CI |
| Documentation | **62** | Best-in-class sprint reports; stale STATUS body w/ one false count; aspirational docs mislabeled as current in places |

**Overall Engineering Readiness: NOT PRODUCTION READY (~50/100).** The score is not the average: the security P0 and the deployment gap are hard blockers regardless of the strong core.

## 35. Business Readiness

| Capability | Verdict |
|---|---|
| Authentication | **READY** (MFA/reset missing; wildcard must be fixed first) |
| Fleet Management | **READY** |
| Device Management | **READY** (gateway deployment + listeners config needed) |
| Tracking (live/history/playback) | **READY** |
| Maps | **READY** (with OSRM/Nominatim profiles enabled; graceful 503 otherwise) |
| Geofence | **READY** |
| Alarms | **READY** |
| Notifications | **PARTIAL** (in-app/WS ready; email needs SMTP config; SMS/push not ready) |
| Reporting | **READY** |
| Video | **NOT READY** (mock) |
| Maintenance / Fuel / Compliance / Billing / Driver UI / Commands | **NOT STARTED / NOT READY** |

## 36. Critical User Journeys

| Journey | Verdict | Evidence |
|---|---|---|
| 1 Login → Dashboard | **PASS** | e2e helper + reports e2e run against real stack; unit tests |
| 2 Add Vehicle → Device → GPS | **PASS** (code-verified; device flow needs gateway listener config + fleet-management deployment) | binding integration spec; gateway e2e integration spec |
| 3 Live Tracking | **PASS** | WS gateway + Sprint-E integration spec + MapPage |
| 4 Historical Tracking | **PASS** | history-playback e2e; positions/trips integration |
| 5 Geofence → Alarm | **PASS** | geofence-alarm browser e2e (full pipeline) |
| 6 Alarm → Notification | **PASS** | Sprint-G/H integration specs; notifications e2e |
| 7 Reports | **PASS** | 5 reports browser e2e incl. CSV bytes |
| 8 Video | **FAIL (mock)** | StubMediaRouter; canvas streams; unrouted channels API |

(Journeys 1–7 verified by code + specs; live re-execution BLOCKED in this audit — Docker down.)

## 37. Actually COMPLETE

Proven by source + tests (+ integration/E2E where noted): JWT login/refresh-rotation/logout, API keys, RBAC guard chain, IAM user CRUD, tenant provisioning (mechanism), fleet/vehicle/device CRUD + binding + IMEI resolve, asset summary, GT06/JT808/Meitrack ingestion over TCP/UDP, position pipeline (validate/dedupe/persist), trip/idle/parking/engine-hours FSMs, device status + offline detection, geofence detection (enter/exit/dwell) + CRUD + drawing + assignment, live tracking WS (tenant-scoped), historical positions + playback, OSRM routing/matching + Nominatim geocoding (provider-gated), clusters/heatmap/replay, alarm engine (9 rule types, dedup, auto-resolve), IN_APP + WS + rate-limited durable notifications, email channel (code, config-gated), 11 reports + CSV export, frontend auth UX/dashboard/map/assets/geofences/alarms/notifications/reports pages, i18n en/fa, health endpoints, pino logging + request correlation, Kafka reliability (retry/DLQ/idempotency).

## 38. Partial

Email (needs SMTP provider config), SMS/PUSH (abstraction only — honest failures), driver/business-trip backend (real, orphaned — no UI/deploy/tests-with-DB), admin console (users real; roles/audit/settings mock), logout (TTL hardcode; sockets survive), audit trail (identity-side repository orphaned; Kafka path real), media control plane (sessions/channels real; signaling unverified), local map provider (geocode/POI real; routing deliberately absent), RBAC (wildcard defect), tenant provisioning (no saga, unvalidated input), WS vehicle-level ACL (tenant-only).

## 39. Not Implemented

MFA, forgot/reset password, user deletion, password-history enforcement, organizations, command dispatch (producer side exists, no consumer/UI), raw packet retention, China map providers, recording/HLS/WebRTC/SFU media path, JT1078/RTSP transport wiring, maintenance, fuel, compliance, billing, public API platform, SDK, API gateway, RS256/JWKS, OPA, OTel/Grafana/Jaeger, K8s/deploy pipeline, per-vehicle WebSocket ACL, admin roles/audit/settings backends.

## 40. Mock/Demo Only

`StubMediaRouter` synthetic SDP/ICE (production wiring); canvas-synthesized video streams + fake signaling latency + fake session tokens (frontend, DEMO-badged); `mockChannels`/video walls (gated); VideoWall demo alert button; `stub` device protocol adapter (registered builtin); dev-only gated fixtures: 40 mock vehicles, 42 mock alarms, admin datasets, fleet stats (all behind `shouldUseMock()`, default OFF — not production mocks).

## 41. Broken

| # | Defect | Root cause | Impact | Severity |
|---|---|---|---|---|
| A | `pnpm lint` fails (351) | repo-wide format drift + 5 rule violations | CI gate red | Medium |
| B1 | Video Wall `GET /api/v1/channels` → 404 against identity-service | no vite/nginx proxy rule routes it to media-service (and media not deployable anyway) | video channel list permanently empty in real mode | High (for video feature) |
| B2 | WS answer/ICE handlers no-op; snapshot stub | signaling backend absent | no real video negotiation | High (by design-stub) |
| C | Root build compiles only 3 of 9 backend apps | `tsconfig.json` references incomplete | CI build gate doesn't prove buildability of 6 apps | Medium |
| D | nginx/compose proxy to 6 services, only 4 exist in compose | deployment incompleteness | 502s for gps/notification/fleet-management/fleet routes when running compose-only | High (compose mode) |
| E | 244 integration tests pass vacuously without Docker | `if (!ctx) return` pattern | false green confidence in no-infra runs | Medium |

## 42. Top 20 Problems (sorted by impact)

1. **P0** Tenant-admin wildcard → cross-tenant/platform escalation (§21) — fix role model + defend platform endpoints.
2. **P0** 5 backend services have no deployment path (gps-engine, notification, fleet-management, fleet-service, media) — journeys 2–7 cannot run in compose mode.
3. **P0** `/api/v1/channels` misroute breaks Video Wall contract.
4. **P1** Media WS token never verified (sessionId = credential).
5. **P1** RLS bypassed at runtime (BYPASSRLS/superuser DSNs; positions RLS off) — single WHERE-clause bug away from a leak.
6. **P1** No HTTP-level cross-tenant tests for notification/media/fleet-service/identity; vacuous-pass pattern hides coverage.
7. **P1** Rate limiting absent outside login/export; `trust proxy` unhandled; refresh unthrottled.
8. **P1** Revocation fail-open on Redis outage.
9. **P1** Bootstrap seed + default admin password on production path; unvalidated tenant-provision passwords.
10. **P1** Shared `schema_migrations` ledger for identity/fleet-service/device-gateway/media.
11. **P1** fleet-service rollback drops schema `fleet` (fleet-management data loss).
12. **P1** JWT_AUDIENCE drift (schema default vs 3 services vs compose vs env files).
13. **P1** CI gaps: no E2E, no DB-backed integration, root build misses 6 apps, lint red.
14. **P2** identity-service has zero integration tests.
15. **P2** No observability backend; request-ids don't reach Kafka; 4 services lack `/metrics`.
16. **P2** SMS/PUSH/EMAIL provider integration incomplete (email config-only; no providers).
17. **P2** Driver/business-trip domain orphaned (no UI, no deploy, no integration tests).
18. **P2** media-service default port 3000 collides with identity; root-path controllers.
19. **P2** Env/config hygiene: stale `.env` (37 keys), dead vars, env-dependent migration, undocumented frontend vars.
20. **P3** Code debt: format drift, dead frontend/backend clusters, dual chart libs, zod major split, stale STATUS-report body with one false test count.

## 43. Recommended Priorities (next 5 — audit-derived, not "another sprint")

1. **Close the P0 security hole and harden authz:** replace `tenant-admin: ['*']` with explicit permission sets; add a platform-role concept; guard `/tenants`, gateway/gps admin with it; add HTTP-level cross-tenant tests (tenant-A token → tenant-B resource) for every service.
2. **Make the running system deployable:** Dockerfiles + compose entries for gps-engine, notification, fleet-management (+ device-gateway listener config); fix the channels proxy; decide fleet-service's fate (merge drivers/trips into fleet-management or deprecate) and split the remaining migration ledgers.
3. **Make CI tell the truth:** run lint-clean (format the repo), extend the root build references (or build per-app), add a Docker-based job that runs the DB-backed integration suites + Playwright E2E so vacuous passes become real, wire `reporting`-style skip accounting into a visible counter.
4. **Security hardening pass:** media WS token verification (or disable the gateway until real), rate limiting + trust-proxy, helmet/body limits, CORS strategy, WS revocation check, remove seed-admin from production path, unify JWT_AUDIENCE.
5. **Enforce the tenant boundary in the database, not just code:** NOBYPASSRLS app roles for every service (map-engine/reporting included), re-enable RLS on positions (or document the Timescale trade-off + compensating tests), fix fleet-service's destructive rollback.

(Video, SMS/push, and new business contexts are deliberately **not** recommended until the platform above is trustworthy.)

## 44. Exact Commands Executed

```
pwd; git branch --show-current; git log --oneline -25; git remote -v
git status --short; git ls-files infra/docker/; git ls-files | grep -c tsbuildinfo; git ls-files | wc -l
ls (root, apps/, packages/, docs/…)
for d in apps/*/ — file counts; package.json name/deps extraction
pnpm typecheck            # PASS (exit 0)
pnpm lint                 # FAIL (351 errors / 1 warning; breakdown via biome --reporter=summary)
npx biome check . --max-diagnostics=800 [--reporter=summary]  # rule breakdown + locations
pnpm test                 # exit 0 — 994 passed / 45 skipped (per-service summaries captured)
npx vitest run (apps/web-dashboard)  # 192/192
docker compose --project-name fleetvision -f infra/docker/docker-compose.yml --env-file infra/docker/.env config --quiet   # valid
docker info / docker compose ps      # daemon NOT running (npipe error) — no live verification
netstat -an (5432/6379/9092/3000/3001) + tasklist  # no local PG/Redis/Kafka either
sed/grep inspections of integration specs (skip mechanisms), lint locations, compose, configs
```

Read-only inspection otherwise (Read/Grep/Glob across all apps/packages/docs). **No source, migration, config, or package file was modified.** (Note: `pnpm typecheck`/`build` regenerate ignored `*.tsbuildinfo` artifacts; tests create nothing outside temp DBs, and none ran against a live DB.)

## 45. Files Inspected

Representative (not exhaustive; full inventory available on request): all 10 `apps/*/package.json` + `src/config/*`; all controllers/modules/use-cases named in §4–§20; all 31 migration files; `packages/{auth,persistence-knex,config,observability,health,web,cache-redis,shared-kernel}/src/**`; `infra/docker/{docker-compose.yml,init/postgres.sql,.env.example}` (key names only); `apps/web-dashboard/{vite.config.ts,nginx.conf,src/router,src/api/*,src/hooks/*,src/pages/*,src/mock/*,e2e/*,playwright.config.ts}`; `PROJECT_STATUS_REPORT.md` (full), `README.md` (full), all 10 `docs/implementation/SPRINT-*.md`; `docs/specs/00,01`; ADRs; `.github/workflows/ci.yml`; `biome.json`; `pnpm-lock.yaml` (version spot-checks). Estimated >400 files read or pattern-scanned.

## 46. Files Changed

- `docs/implementation/FULL_PROJECT_AUDIT.md` (this file — created)
- `docs/implementation/FULL_PROJECT_FEATURE_MATRIX.md` (created)

No other files were created, modified, or deleted.

---

# FINAL PROJECT STATUS

**Overall: PARTIAL — NOT PRODUCTION READY.**

**Estimated implementation maturity: ~40%** (engineering judgment from the feature matrix, weighted by domain criticality — not derived from file/LOC/sprint counts): the **tracking-platform core** (identity → fleet → telemetry → tracking → map → geofence → alarms → in-app notifications → reporting → real-first UI) ≈ **70%** (functional, tested, honest; missing production hardening and deploy paths); **platform production-readiness** (security hardening, DB enforcement, observability, CI/CD, deployment) ≈ **30%**; **extended business domains** (video, email/SMS/push delivery, drivers UI, maintenance/fuel/compliance/billing, commands, API platform) ≈ **10%**.

## Strongest Parts
gps-engine telemetry pipeline (pure FSMs + Timescale/PostGIS + DLQ + real WS); identity auth internals (argon2, rotating refresh with reuse detection, API keys); protocol decoders with correct checksums; fail-closed map provider router; notification durability (retry worker, idempotency); reporting SQL with CSV hygiene; sprint-report honesty; test depth in gateway/gps/notification/map.

## Weakest Parts
Video/media (mock), deployment story (4/10 in compose), security hardening (wildcard P0, fail-open revocation, rate limiting), RLS enforcement reality, observability backend, identity integration tests, PROJECT_STATUS body accuracy.

## Production Blockers
P0 wildcard; missing deployment for gps/notification/fleet-management (+gateway listeners); compose/nginx mismatch (502s); CI never runs integration/E2E; lint gate red; seed admin on prod path.

## Security Blockers
As §21 P0/P1 list — wildcard escalation, media WS token, revocation fail-open, rate-limit gaps, bootstrap credentials.

## Architecture Risks
Shared-DB ledger conflicts; fleet schema co-ownership + destructive rollback; single shared JWT audience/secret; direct alarm→notification call bypassing the bus; single-instance outbox relay; two parallel fleet services; 20-service spec vs 10-app reality drift.

## Missing Business Capabilities
Real video streaming/relay/recording; SMS & push delivery; configured email; driver UI; maintenance; fuel; compliance; billing; device command dispatch; MFA/password reset; admin roles/audit/settings backends; public API platform & SDK.

## Recommended Next 5 Priorities
See §43 (authorization P0 + deployability + truthful CI + hardening pass + DB-level tenant enforcement — before any new feature sprint).

## Final Verdict
FleetVision is a **credible, honestly-engineered tracking platform core** — the telemetry vertical is real end-to-end and the documentation mostly tells the truth about it. It is **not** a shippable product yet: the security posture has one critical design flaw, the tenant boundary lives only in code, half the backend cannot be deployed, and CI cannot detect regressions that require infrastructure. Fix the five priorities in §43 and the core could plausibly reach production readiness; building further business breadth on the current foundation (video, billing, fuel) would compound risk rather than value.
