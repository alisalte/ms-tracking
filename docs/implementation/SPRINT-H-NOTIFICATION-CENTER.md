# Sprint H — Notification Center

**Date:** 2026-08-15
**Status:** COMPLETE (IN_APP fully functional; EMAIL provider-implemented but NOT CONFIGURED in this environment; SMS/PUSH PROVIDER READY / NOT CONFIGURED — see §Providers)

Sprint H built the production-oriented Notification Center on top of the Sprint G
alarm/event engine. It did NOT rebuild the Alarm Engine and did NOT duplicate
Sprint G rule evaluation — the dispatcher consumes alarms raised by the existing
`AlarmEvaluatorService`.

---

## 1. What existed vs. what Sprint H did

| Area | Pre-existing (Sprint 5/G) | Gap | Sprint H change |
|---|---|---|---|
| Notification domain | `Notification`, `NotificationPreference`, `NotificationDelivery` entities + 3 tables | No event type / vehicle / priority / metadata; no durable retry fields | Extended entities + `20260816100000_extend_notification_center.js` migration |
| Dispatch | Broadcast one row (`userId=null`); preferences never consulted; email lookup a `null` stub | Per-user fan-out, preference filtering, trusted recipients | `NotificationDispatcherService` rewrite |
| Channels | WebSocket/InApp/Email(nodemailer) via flat array | No registry, no SMS/PUSH, no status | `NotificationProviderRegistry` + `SmsChannel`/`PushChannel` (DISABLED) |
| Retry | In-memory `setTimeout` (lost on restart) | Durable, multi-worker-safe | `DeliveryRetryWorker` + `next_attempt_at` + `FOR UPDATE SKIP LOCKED` lease |
| Templates | Inline string building | i18n, safe interpolation | `application/templates/notification-templates.ts` (en/fa) |
| Rate limiting | none | storm protection | `NotificationRateLimiter` (Redis window per tenant/user/channel) |
| WS | tenant room only | targeted per-user delivery | `user:<tid>:<uid>` room, JWT-validated |
| API | list/unread/read/read-all/prefs | detail, filters, delivery timeline, provider health, tenant-wide history | Extended `NotificationsController` |
| RBAC | `notification.alert.*` reused for the bell | dedicated permissions | `notification.read(.all)`, `notification.preference.read/write` + identity backfill migration |
| Frontend | API hooks + unmounted `NotificationBell` | mount, realtime, center page, preferences UI, i18n | All delivered |

## 2. Architecture

```
Alarm (Sprint G evaluator — unchanged)
   ↓ dispatchAlarm(alarm)
NotificationDispatcherService
   ├─ template render (en/fa, whitelisted data)
   ├─ UserDirectory.listTenantUsers (iam.users, platform-read, Redis-cached)
   ├─ per user: preference getOrDefault → enabled ∩ registry.configured()
   ├─ NotificationRateLimiter.allow(tenant,user,channel)
   ├─ Notification.create (idempotent: tenant+user+source_type+source_id unique)
   └─ per channel: NotificationDelivery(PENDING) → DeliveryExecutor
        ├─ provider.deliver (registry-selected)
        └─ outcome: SENT(+providerMessageId) | FAILED(permanent→terminal)
                    | PENDING+next_attempt_at (transient → retry worker)
DeliveryRetryWorker (interval sweep)
   └─ claimDueDeliveries (FOR UPDATE SKIP LOCKED + lease) → re-dispatch
WebSocket gateway
   ├─ notification.new → user:<tid>:<uid> (targeted) | tenant:<tid>:notifications (legacy broadcast)
   └─ JWT handshake; rooms validated against the principal
```

## 3. Notification domain

`notification.notifications` columns added: `event_type`, `vehicle_id`,
`metadata jsonb` (whitelisted template context), `priority`
(`low|normal|high|urgent`). Delivery columns added: `next_attempt_at`,
`provider`, `provider_message_id`, `error_code`; status gains `DELIVERED`
(provider-confirmed only). Indexes: `(tenant_id,event_type,created_at DESC)`,
`(tenant_id,vehicle_id,created_at DESC)`, `(tenant_id,status,next_attempt_at)`.

### State machine (deliveries)

```
PENDING ──success──> SENT ──provider confirms──> DELIVERED
PENDING ──transient fail──> PENDING (next_attempt_at, exp. backoff)
PENDING ──permanent fail / attempts exhausted──> FAILED (terminal; counted as DLQ)
SENT ──(in-app) user reads──> READ
```

`SENT` means the provider ACCEPTED the message. The UI never shows
"Delivered" when the provider only confirmed submission (Sprint H §41/§11).

### Severity → priority mapping (deterministic)

`critical→urgent, high→high, normal→normal, low→low`. Severity itself reuses
the Sprint G model (INFO/LOW/MEDIUM/HIGH/CRITICAL → critical/high/normal/low).

## 4. Channels & providers

| Channel | Provider | Status in this environment |
|---|---|---|
| IN_APP | PostgreSQL row (the bell record) | IMPLEMENTED, CONFIGURED, TESTED |
| websocket | Socket.IO gateway (`socketio`) | IMPLEMENTED, CONFIGURED, TESTED |
| EMAIL | `SmtpEmailProvider` (nodemailer, env-driven) | IMPLEMENTED; **NOT CONFIGURED** (no SMTP env in this environment) — verified via injected `MockEmailProvider` in integration tests |
| SMS | `SmsChannel` abstraction | PROVIDER READY / NOT CONFIGURED (`NOTIF_SMS_ENABLED=false`; no provider integrated — never faked) |
| PUSH | `PushChannel` abstraction | PROVIDER READY / NOT CONFIGURED (`NOTIF_PUSH_ENABLED=false`) |

Provider selection is configuration-driven via `NotificationProviderRegistry`
(`application/channels/provider-registry.ts`); no business logic branches on
concrete providers. `GET /notifications/channels` exposes
CONFIGURED/DISABLED per channel — no secrets.

For local SMTP testing a **Mailpit** service was added to docker-compose under
the opt-in `mail` profile (`docker compose --profile mail up`): SMTP
localhost:1025, UI localhost:8025.

## 5. Recipients, preferences, dedup

- Recipients: `UserDirectory` reads active `iam.users` per tenant on the
  platform connection (60s Redis cache). Identity is NEVER taken from alarm
  payloads (§20). No parallel fleet-membership model was invented (§19).
- Preferences: `(category, channels[], min_severity, enabled)`; defaults =
  IN_APP + realtime ON, EMAIL/SMS/PUSH OFF (opt-in — §22). All channels
  disabled → the decision is logged + counted, no row, no retry loop.
- Idempotency (§17): unique `(tenant_id,user_id,source_type,source_id)` —
  Kafka redeliveries and duplicate alarm dispatches cannot duplicate rows
  (proven by integration Scenario 4). PostgreSQL is authoritative; Redis only
  provides the rate-limit windows + caches (§29).
- Dedup policy (§18): **ON_OPEN** — one notification set per alarm occurrence;
  an alarm OPEN for hours does not spam (the Sprint G evaluator's one-open-alarm
  gate feeds this naturally).
- Rate limiting (§33): Redis fixed-window per tenant+user+channel
  (`NOTIF_RATE_LIMIT_PER_MIN`, default 30/min); suppressed dispatches are
  logged + counted (`notifications_rate_limited`). A flapping device cannot
  storm users (integration Scenario 4: 5 further speeding packets → 0 new
  notifications).

## 6. Templates & i18n

Safe `{{key}}` string interpolation only (`domain/notification-template.ts`) —
no executable template code; unknown placeholders are stripped; secrets can
never enter (whitelist = `TEMPLATE_DATA_KEYS`: vehicleName, speed, speedLimit,
geofenceName, occurredAt, batteryLevel, duration, …). Registry covers ALL 14
Sprint G rule types in **en** and **fa**, fallback = en, then the raw alarm
message.

## 7. Retry, DLQ, concurrency

- Bounded retries: `NOTIF_MAX_DELIVERY_ATTEMPTS` (default 3) with exponential
  backoff `NOTIF_RETRY_BASE_MS * 2^n` (§31).
- Permanent errors (invalid recipient/token, provider rejection, SMTP not
  configured) fail fast — never retried.
- Exhausted / permanent → terminal FAILED with forensic log
  (`deliveryId, notificationId, tenantId, channel, attempts, error, class`) and
  `notifications_dlq` metric. Kafka-message-level DLQ is unchanged from
  Sprint G (`<topic>.dlq` + forensic headers); notification-service consumes
  with bounded in-process retry + envelope validation (§16).
- Concurrency (§53): `claimDueDeliveries` claims rows with
  `SELECT … FOR UPDATE SKIP LOCKED` plus a time lease on `next_attempt_at`;
  crashed workers release rows automatically when the lease expires. No
  in-memory locks.

## 8. Kafka

Unchanged consumption path from Sprint G: topics
`fleetvision.telemetry.position.raw`, `fleetvision.telemetry.session.lifecycle`,
`fleetvision.tracking.events`; consumer group `notification-service`; bounded
retries with exponential backoff; malformed envelopes (non-retryable) → DLQ;
Redis event-id idempotency + `notification.fleet_events` PK. Sprint H did not
rename topics or re-evaluate alarm conditions (§15).

## 9. REST API

Base `/api/v1/notification/notifications` (JWT + permission-gated; tenant and
user always from the principal — §47):

| Method | Path | Permission |
|---|---|---|
| GET | `/` (cursor-paginated; filters `unreadOnly,eventType,severity,vehicleId,from,to,scope`) | `notification.read` (`scope=all` additionally requires `notification.read.all`) |
| GET | `/:id` (detail + delivery attempts) | `notification.read` |
| GET | `/unread-count` | `notification.read` |
| GET | `/channels` (provider health) | `notification.read` |
| POST | `/:id/read`, `/read-all` | `notification.read` |
| GET/PUT | `/preferences` (own preferences only) | `notification.preference.read` / `.write` |

RBAC (packages/auth + identity migration `20260816120000_backfill…`):
viewer gets `notification.read` + preference read/write (own);
fleet-admin additionally `notification.read.all`; tenant-admin via `*`.
The previously reused `notification.alert.read` gate on bell routes was
replaced by the dedicated permissions.

## 10. Tenant isolation & security

- Every query is tenant-scoped via `withTenantContext` (RLS policies from
  Sprint 5 migrations still cover the extended tables).
- Integration Scenario 6: tenant B sees none of tenant A's notifications;
  cross-tenant detail lookup returns null. Read state is per user (Scenario 7).
- Preferences are only writable for the caller's own user id.
- Logs/metrics carry tenantId/notificationId/alarmId/userId/channel/provider/
  attempt/correlationId; no secrets (JWT/SMTP password/API keys) are ever
  logged or exposed via API (§45/§49).

## 11. Frontend

- `NotificationBell` mounted in the Topbar (replaces the static placeholder):
  live unread badge, latest list, mark-one/mark-all-read, deep links, "View all".
- `useNotificationRealtime` (new): joins `user:<tid>:<uid>` +
  `tenant:<tid>:notifications` on the authenticated socket; on
  `notification.new` it updates the React Query cache INCREMENTALLY
  (prepend + unread-count bump — no full reload, §54); 30s unread-count
  polling remains as fallback.
- `NotificationCenterPage` (`/notifications`, sidebar entry, permission-gated):
  URL-synced filters (type/severity/from/to/unread-only), server-side cursor
  pagination ("Load more"), detail drawer with the per-channel delivery
  timeline (honest statuses), and a Preferences tab (type×channel matrix;
  unavailable channels — SMS/push — render visibly disabled with a tooltip).
- i18n: full `notifications.*` key set added to en + fa locale files.
- Permissions: `PERMISSIONS.notification*` constants in `auth/permissions.tsx`.

## 12. Observability

New bounded-label counters in `packages/observability` (prefix `fleetvision_`):
`notifications_created_total{type}`, `notifications_dispatched_total{channel}`,
`notifications_sent_total{channel}`, `notifications_delivered_total{channel}`,
`notifications_failed_total{channel}`, `notifications_retried_total{channel}`,
`notifications_dlq_total{channel}`, `notifications_deduplicated_total{type}`,
`notifications_rate_limited_total{channel}`,
`notification_provider_total{channel,result}`. No unbounded labels (no
tenantId/userId as label values). Structured pino logging with correlation
context throughout the dispatcher/executor/worker.

## 13. Failure recovery (tested)

- Kafka redelivery / duplicate alarm → no duplicate notifications (idempotency
  constraint) — integration Scenario 4.
- Transient provider failure → durable retry → SENT — integration Scenario 5
  (worker restart-safe by design: state lives in PostgreSQL).
- Permanent failure → terminal FAILED, no infinite retry — unit tests.
- Provider unavailable (SMTP unset) → channel skipped, never faked — unit +
  integration Scenario 3.
- Redis rate-limiter outage → fail-open with logging (delivery continues).
- Service restart mid-retry → rows re-claimed after lease expiry (worker).

## 14. Testing

- **Unit** (`sprint-h-notification-center.spec.ts`, 19 tests): recipient
  fan-out, tenant scoping of created rows, template rendering + secret
  leakage prevention, idempotent dedup, disabled preference, disabled
  provider skip, rate-limit suppression, NOTIFICATION_ENABLED=false, durable
  retry scheduling, retry worker re-dispatch, registry statuses, SMS/PUSH
  honest refusal, en/fa templates, all-14-types coverage, severity mapping,
  rate limiter (window + Redis outage + disabled). Domain spec extended
  (delivery state machine, backoff, error classification, safe interpolation).
- **Integration** (`sprint-h-notification-center.integration.spec.ts`, 8
  scenarios, live PostgreSQL + Redis + Kafka): alarm → per-user IN_APP
  notifications + unread counts; EMAIL via injected MockEmailProvider
  (provider invocation + delivery row persisted — no external email in CI);
  disabled-email default; duplicate-dispatch idempotency; transient-failure
  retry; tenant isolation; per-user read state. Graceful skip when the stack
  is down.
- **Frontend Vitest** (`notifications.spec.tsx`, 7 tests): bell badge,
  dropdown, mark-all/mark-one read, view-all link, center filters, preferences
  matrix with disabled channels, realtime incremental cache updates.
- **Browser E2E (Playwright — new)** (`e2e/notifications.e2e.spec.ts`): login →
  bell → notification center → mark read / detail drawer; authenticated
  Socket.IO client joins the per-user room on the real gateway. **2/2 PASSED**
  against the live stack (Edge channel; Chromium CDN blocked in this
  environment).

## 15. Configuration

New env vars (all zod-validated in `notification.config.ts`, documented in
`infra/docker/.env.example`): `NOTIFICATION_ENABLED`, `NOTIF_SMS_ENABLED`,
`NOTIF_PUSH_ENABLED`, `NOTIF_MAX_DELIVERY_ATTEMPTS`, `NOTIF_RETRY_BASE_MS`,
`NOTIF_RETRY_WORKER_INTERVAL_MS`, `NOTIF_RETRY_WORKER_BATCH_SIZE`,
`NOTIF_RATE_LIMIT_PER_MIN`, `NOTIF_DEFAULT_LOCALE` (+ existing `NOTIF_SMTP_*`,
`MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`).

## 16. Boot fixes discovered during E2E (pre-existing gaps)

Running the compiled service end-to-end surfaced Sprint G latent boot defects
(never exercised because only tests ran): missing `TOKEN_VERIFIER` provider,
`MetricsController` injecting a type-only `Registry` (metadata → `Function`),
`MetricsModule` not global (feature modules couldn't inject `METRICS_TOKEN`),
controllers importing repositories as `import type` (DI tokens → `Function`),
redundant per-controller `@UseGuards(JwtAuthGuard,…)` that Nest cannot
instantiate for deps-object guards, and the shared-DB migration ledger clash
(`notification_schema_migrations` is now the per-service ledger). All fixed;
the service now boots, runs migrations, connects Kafka, serves the API + WS
gateway, and passes browser E2E.

## 17. Known limitations

- EMAIL not configured in this environment (no SMTP creds) — provider code is
  real; verified with a mock provider in integration tests. Configure
  `NOTIF_SMTP_*` (or the Mailpit profile) to enable.
- SMS/PUSH have interface-level support only (no provider integrated —
  deliberately, no fake endpoints).
- Locale selection uses `NOTIF_DEFAULT_LOCALE` (per-user locale preference not
  modeled — iam.users has no locale column).
- Recipient scope = all active tenant users (no fleet-scoping — no
  user↔fleet membership model exists; §19 forbids inventing one).
- Notification-creation dedup is ON_OPEN only (ON_RESOLVE/ON_ESCALATION
  deferred).

## 18. Deferred features

Quiet hours (§34 — no existing product requirement), ON_REPEAT dedup policy,
per-user locale preference, push device-token table + FCM/APNs provider,
admin config API for defaults, digest batching.

## 19. Verification (2026-08-15)

- `pnpm --filter @fleetvision/notification-service typecheck/build/test` —
  PASS (97 legacy + 19 Sprint H unit + 8 integration tests; integration ran
  against the live Docker stack).
- `pnpm --filter @fleetvision/web-dashboard typecheck/test` — PASS (incl. 7
  new notification tests).
- Playwright browser E2E — 2/2 PASS (live stack).
- Full-repo `pnpm typecheck/build/test/lint` results in
  PROJECT_STATUS_REPORT.md (Sprint H block).

## 20. Recommended next sprint

1. Configure a real SMTP provider (or Mailpit in dev) + end-to-end email E2E.
2. SMS provider selection (Twilio/Kavenegar) behind the existing abstraction.
3. Push provider (FCM) + device-token registration API.
4. Fleet-scoped recipient resolution once a membership model exists.
5. Notification preferences per event type (today: per category) + quiet hours.
6. Stabilize Docker Desktop dev-stack port publishing (flaky in this
   environment; documented in the Sprint H session notes).
