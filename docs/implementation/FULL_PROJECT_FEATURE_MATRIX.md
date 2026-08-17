# FleetVision — Full Project Feature Matrix

Audit date: 2026-08-17. Branch `main` @ `2041f0a`. Companion to `FULL_PROJECT_AUDIT.md`.

Status vocabulary: **COMPLETE** (implemented, wired, tested, critical path works) · **PARTIAL** (real core, important gaps) · **STUB** (interface/scaffolding only) · **MOCK** (fake data shown as real) · **BROKEN** (implemented, currently failing) · **NOT STARTED** · **BLOCKED** (not verifiable due to environment).

Legend: B=Backend · F=Frontend · DB=Database · Msg=Messaging · T=Tests · E2E=Playwright/browser. ✔=present/real · ◐=partial · ✗=absent. "Real" = runs against real Postgres/Timescale/PostGIS/Redis/Kafka (no in-memory substitutes in production paths).

## Identity / IAM

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 1 | Login (JWT HS256) | ✔ | ✔ | ✔ | — | ✔ (unit) | ◐ (login flows inside e2e helpers) | Real | **COMPLETE** | `apps/identity-service/src/application/auth/login.use-case.ts`; `apps/web-dashboard/src/pages/LoginPage.tsx`; e2e `apps/web-dashboard/e2e/helpers/login.ts` |
| 2 | Refresh rotation + reuse detection | ✔ | ✔ | ✔ | — | ✔ | — | Real | **COMPLETE** | `refresh.use-case.ts:44-81`; `RefreshTokenFamily` domain; `token.storage.ts` + `useSilentRefresh.ts` |
| 3 | Logout / logout-all | ✔ | ✔ | ✔(revocation) | — | ✔ | — | Real | **PARTIAL** | Revocation TTL hardcoded 900s (`auth.controller.ts:133,147`); WS sockets not killed on logout |
| 4 | RBAC permissions | ✔ | ✔(route guards) | ✔ | — | ✔ | — | Real | **PARTIAL** | `PermissionsGuard` global; **P0: tenant-admin `*` wildcard satisfies platform permissions** (`packages/auth/src/permission-catalog.ts:126,141-145`) |
| 5 | API keys | ✔ | ◐ (no UI page; used by gateway) | ✔ | — | ✔ | — | Real | **COMPLETE** | `api-key.use-cases.ts`; cross-service verify `packages/auth/src/api-key-verifier.ts:51-88`; `ip_allowlist` column exists but never enforced |
| 6 | User management (IAM) | ✔ | ✔ (Admin→Users) | ✔ | — | ✔ | — | Real | **PARTIAL** | No DELETE; `PUT /iam/users/:id`, `POST /:id/roles` take raw body, no zod (`users.controller.ts:79-108`) |
| 7 | Tenant provisioning | ✔ | ✗ | ✔ | ✔(outbox→Kafka) | ✔ | — | Real | **PARTIAL** | `POST /tenants` unvalidated password, no multi-service saga (`provision-tenant.use-case.ts:7`); reachable by any tenant-admin (P0) |
| 8 | MFA | ✗ | STUB page | ✗ | — | ✗ | — | — | **NOT STARTED** | `MfaVerifyPage` → `verifyMfa` throws `NotImplementedError` (`auth.api.ts:130-177`) |
| 9 | Forgot/reset password | ✗ | STUB pages | ✗ | — | ✗ | — | — | **NOT STARTED** | `ForgotPasswordPage`/`ResetPasswordPage` → `NotImplementedError` |
| 10 | Password history enforcement | ✗ | ✗ | ◐ table only | — | ✗ | — | — | **STUB** | `iam.password_history` created (`20260102000000_create_iam_schema.js:86-93`), zero repo references |
| 11 | Organizations | ✗ | ✗ | ◐ table only | — | ✗ | — | — | **STUB** | `iam.organizations` orphan |
| 12 | Audit log | ◐ | ◐ (admin audit tab = mock) | ✔ | ✔ | ✔ | — | Real (backend) | **PARTIAL** | Hash-chained `audit.audit_entries` written by fleet-mgmt/map/reporting/gateway; identity's `AuditRepository` never injected; frontend audit list mock-only (`admin.api.ts:259-326`) |

## Fleet / Assets

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 13 | Fleet CRUD | ✔ | ✔ | ✔ | — | ✔(33+17 skip) | — | Real | **COMPLETE** | `fleets.controller.ts`; `AssetManagementPage` |
| 14 | Vehicle CRUD | ✔ | ✔ | ✔ | — | ✔ | — | Real | **COMPLETE** | `vehicles.controller.ts`; unique code/plate/vin per tenant |
| 15 | Device registry + IMEI resolve | ✔ | n/a | ✔ | — | ✔(integration) | — | Real | **COMPLETE** | `GET /devices/resolve` API-key-only (`devices.controller.ts:59-63`); Luhn IMEI; global unique IMEI |
| 16 | Vehicle↔device binding | ✔ | ✔ | ✔ | ✔(cache invalidation) | ✔(integration) | — | Real | **COMPLETE** | `binding.service.ts:118-179`; Redis pub/sub invalidation |
| 17 | Driver management | ✔ | ✗ (no page, no API call) | ✔ | ✗ | unit only | — | Real backend, unconsumed | **PARTIAL** | `apps/fleet-service` real CRUD; dashboard `drivers` query key unused (`query-keys.ts:44`) |
| 18 | Business trips | ✔ | ✗ | ✔ | ✗ | unit only | — | Real backend, unconsumed | **PARTIAL** | `business-trips.controller.ts:46-178` |
| 19 | Fleet/asset summary | ✔ | ✔ (Dashboard) | ✔ | — | ✔ | ✔ (reports e2e KPIs) | Real | **COMPLETE** | `summary.controller.ts`; `useFleetStats` |

## Telemetry / Tracking

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 20 | Protocol decoders GT06/JT808/Meitrack | ✔ | n/a | — | — | ✔ | — | Real | **COMPLETE** | `gt06.*.ts` (CRC-ITU), `jt808.*.ts` (BCC XOR), `meitrack.*.ts`; `stub.adapter.ts` also registered (test protocol) |
| 21 | TCP/UDP listeners | ✔ | n/a | ◐ (config table orphan) | — | ✔ | — | Real | **COMPLETE** | `tcp-server.ts:80-91`, `udp-server.ts:57-72`; **default `GATEWAY_LISTENERS=''` = zero ports open** |
| 22 | Raw packet retention | STUB | n/a | ✗ | — | ✗ | — | — | **STUB** | `NullRawRetentionSink` no-op (`raw-packet-storage.ts:22-26`) |
| 23 | Position validation/dedupe | ✔ | n/a | ✔ | — | ✔ | — | Real | **COMPLETE** | `position-pipeline.ts:74-142`; quality gates + bounded in-process dedupe + idempotent insert |
| 24 | TimescaleDB persistence | ✔ | n/a | ✔ hypertable | — | ✔(integration) | — | Real | **COMPLETE** | `tracking.vehicle_positions`, compression+retention policies |
| 25 | Trip FSM | ✔ | ✔ (Trips pages) | ✔ | ✔(tracking.events) | ✔(integration) | ◐ (trip report e2e) | Real | **COMPLETE** | `trip-fsm.ts:48-256`; start-duration debounce simplified (`:64-69`) |
| 26 | Idle FSM | ✔ | ◐ (idle-parking report) | ✔ | ✔ | ✔ | — | Real | **COMPLETE** | `idle-fsm.ts` with PTO suppression |
| 27 | Parking FSM | ✔ | ◐ | ✔ | ✔ | ✔ | — | Real | **COMPLETE** | `parking-fsm.ts` dwell + tamper |
| 28 | Engine-hours | ✔ | ◐ | ✔ | — | ✔ | — | Real | **COMPLETE** | `fsm/engine-hours.ts`; `tracking.engine_hours` |
| 29 | Device status + offline sweeper | ✔ | ✔ (status chips) | ✔ | ✔(session.lifecycle) | ✔ | — | Real | **COMPLETE** | `device-stale-sweeper.ts`; `GET /devices/status` |
| 30 | Geofence enter/exit/dwell detection | ✔ | ✔ | ✔(geofence_state) | ✔ | ✔(integration 8) | ✔ (geofence-alarm e2e) | Real | **COMPLETE** | `geofence-evaluator.ts`; jitter confirmation + dwell windows |
| 31 | Live tracking WebSocket | ✔ | ✔ | ✔(cache) | ✔ | ✔ | ✔ (notifications e2e socket auth) | Real | **COMPLETE** | `realtime.gateway.ts` JWT fail-closed, tenant rooms, coalescing; no per-vehicle ACL (documented `:20-22`) |
| 32 | Historical positions API | ✔ | ✔ | ✔ | — | ✔ | ✔ (history-playback e2e) | Real | **COMPLETE** | `positions.controller.ts:134`; `useVehicleTrack` |
| 33 | Track playback UI | ✔ | ✔ | ✔ | — | ✔ | ✔ (1 e2e) | Real | **COMPLETE** | `useTrackPlayback.ts` rAF + gap split; `PlaybackControls.tsx` |

## Map / Geospatial

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 34 | Routing (OSRM) | ✔ | ✔ (route planner) | — | — | ✔ (mocked fetch) | — | Real (provider-gated; 503 when unset — never fake) | **COMPLETE**\* | `osrm-provider.ts:80-221`; compose `routing` profile optional |
| 35 | Map matching | ✔ | ✔ (history snap) | — | — | ✔ | — | Real (OSRM-only; raw GPS at conf 0 if unmatched) | **COMPLETE**\* | `osrm-provider.ts:117-168` |
| 36 | Geocode / reverse geocode | ✔ | ✔ | ◐ (addresses cache never written) | — | ✔ | — | Real (Nominatim or local PG) | **COMPLETE**\* | `nominatim-provider.ts:284-392`; `local-provider.ts:30-140` |
| 37 | Local map provider | ✔ | n/a | ✔ | — | ✔ | — | Real, deliberately limited | **PARTIAL** | Routing honestly throws `RouteUnavailableError` (`local-provider.ts:79-85`); match/snap = pass-through conf 0.3 |
| 38 | Geofence CRUD + map drawing | ✔ | ✔ (draw/edit) | ✔ PostGIS | — | ✔(integration 13) | ✔ (3 e2e) | Real | **COMPLETE** | `geofences.controller.ts` 12 routes; `GeofencePage` polygon draw; `ST_IsValid` |
| 39 | Geofence↔vehicle assignment | ✔ | ✔ | ✔ | — | ✔ | — | Real | **COMPLETE** | `geofences/:id/vehicles` routes |
| 40 | Clusters / heatmap / replay | ✔ | ✔ | ✔(H3/GIST) | — | ✔ | — | Real | **COMPLETE** | `cluster-service.ts`, `heat-service.ts`, `replay-service.ts` + Douglas-Peucker |
| 41 | China region providers (Amap/Baidu) | ✗ | n/a | ✗ | — | ✗ | — | — | **STUB** | Comment only (`map-engine.config.ts:95`); never registered |

\* = functional when the optional provider container/profile is enabled; fails closed (503) otherwise.

## Alarms / Notifications

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 42 | Alarm rules CRUD | ✔ | ◐ (rules via API only, no dedicated page) | ✔ | — | ✔ | — | Real | **COMPLETE** | `rules.controller.ts:42-157` |
| 43 | Alarm evaluators (overspeed, ignition, offline, trip, idle, parking, geofence) | ✔ | ✔ (Alarm Center) | ✔ | ✔(Kafka in) | ✔(unit+integration) | ✔ (geofence-alarm e2e) | Real | **COMPLETE** | `evaluators.ts:16-246`; `alarm-evaluator.service.ts` |
| 44 | Dedup / auto-resolve / severity | ✔ | ✔ | ✔ | — | ✔ | — | Real | **COMPLETE** | one-OPEN-alarm invariant + auto-resolve (log-evidenced in test run) |
| 45 | IN_APP notifications + bell/center | ✔ | ✔ | ✔ | — | ✔(integration 8) | ✔ (2 e2e) | Real | **COMPLETE** | `notifications.controller.ts`; `NotificationCenterPage`; `Topbar.tsx:110` |
| 46 | Realtime notification WS | ✔ | ✔ | — | — | ✔ | ✔ | Real | **COMPLETE** | `alarm-realtime.gateway.ts` JWT + room allow-list |
| 47 | Email channel | ✔ (nodemailer) | ✔ (prefs UI) | ✔ | — | ✔ (provider invocation; SMTP unconfigured reported honestly) | — | Real code, config-gated | **PARTIAL** | `channels.ts:88-107`; disabled unless `NOTIF_SMTP_HOST`; Mailpit dev profile |
| 48 | SMS channel | STUB (honest) | ◐ | — | — | ✔ | — | Fails `'SMS provider not configured'` | **STUB** | `channels.ts:127-140`; `NOTIF_SMS_ENABLED=false` default |
| 49 | Push channel | STUB (honest) | ◐ | — | — | ✔ | — | Fails similarly | **STUB** | `channels.ts:148-160`; no FCM/APNs |
| 50 | Preferences, per-user fan-out, rate limit, durable retry | ✔ | ✔ | ✔ | — | ✔ | — | Real | **COMPLETE** | `notification-dispatcher.service.ts`; `delivery-retry-worker.ts` (FOR UPDATE SKIP LOCKED) |

## Reporting / Analytics

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 51 | 11 report endpoints (overview/trend/utilization/trips/distance/speed/idle-parking/alarms/alarm-trend/geofences/activity) | ✔ | ✔ (Reports page) | ✔ read-only SQL | — | ✔(unit+integration incl. EXPLAIN) | ✔ (5 e2e) | Real | **COMPLETE** | `reports.controller.ts` 12 `@Get()`; CTEs in `report.repository.ts:66-120` |
| 52 | CSV export | ✔ | ✔ (blob) | ✔ | — | ✔ | ✔ (byte-verified) | Real | **COMPLETE** | RFC-4180 + BOM + formula-injection guard (`domain/csv.ts:18-45`) |
| 53 | Dashboard KPIs | ✔ | ✔ | ✔ | — | ✔ | ✔ | Real | **COMPLETE** | `/summary` × `/tracking/devices/status`; mock fixtures deleted in Sprint J |

## Video / Media

| # | Feature | B | F | DB | Msg | T | E2E | Real/Mock | Status | Evidence |
|---|---------|---|---|----|-----|---|-----|-----------|--------|----------|
| 54 | Channel registry CRUD | ✔ | ◐ (page exists, API misrouted) | ✔ | — | ✔(unit) | — | Real backend | **PARTIAL** | `channel-manager.ts`; frontend `GET /api/v1/channels` not proxied to media → 404 (see audit §41) |
| 55 | Stream sessions + signaling | ◐ | ◐ | ✔ | ✗(Kafka config dead) | ✔(unit) | — | Session state real; **signaling token never verified** (P1) | **PARTIAL** | `signaling-gateway.ts:62-78`; `verifySignalingToken` zero callers |
| 56 | Live video streaming | ✗ (StubMediaRouter unconditional) | MOCK (canvas synthetic, "DEMO" badge) | — | — | ✔ (mock-tested) | — | **MOCK** | `media-router-port.ts:53-92` dummy SDP/ICE; `video-stream.ts:48-139` fake road scene |
| 57 | Recording / playback / HLS / video wall persistence | ✗ | ✗ (walls mock-only) | ✗ | — | ✗ | — | — | **NOT STARTED** | No code paths |
| 58 | JT1078 / RTSP ingestion | STUB parsers, no listener | n/a | — | — | ✔(parser unit) | — | Parser-only | **STUB** | `jt1078-adapter.ts` ("does NOT own the TCP listener"), `rtsp-adapter.ts` — unwired |

## Frontend platform

| # | Feature | Status | Evidence |
|---|---------|--------|----------|
| 59 | Auth UX (login/refresh/401 single-flight/proactive rotation) | **COMPLETE** | `client.ts:43-116`; `useSilentRefresh.ts` |
| 60 | i18n en + fa (RTL), 934/934 key parity | **COMPLETE** | `src/i18n/`; `theme/rtl.ts` |
| 61 | Live map (MapLibre + OSM tiles, clustering) | **COMPLETE** | `FleetMap.tsx`, `map-cluster.ts` |
| 62 | Admin console | **PARTIAL** | Users real; roles/audit/settings mock-gated (`admin.api.ts:104-129,259-326`); 7/12 nav sections "upcoming" |
| 63 | Command center page | **STUB** | `CommandCenterPage.tsx:13-26` UpcomingFeature |
| 64 | Maintenance page | **STUB** | `MaintenancePage.tsx:13-26` UpcomingFeature |

## Business contexts with NO implementation anywhere

| Context | Status | Evidence |
|---------|--------|----------|
| Fuel management | **NOT STARTED** | No app/package/table/route |
| Compliance | **NOT STARTED** | Same |
| Billing | **NOT STARTED** | Only a `billing.tenant.manage` permission string exists |
| Maintenance | **NOT STARTED** | Frontend placeholder only |
| Command dispatch to devices | **NOT STARTED** | Gateway publishes `command-ack` topic; no producer/UI |
| Public API platform / SDK | **NOT STARTED** | docs/specs/16,17 only |
