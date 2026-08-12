# Sprint 5: Notification Service — Implementation Plan

## Architecture
Add a notification delivery tier to the existing `notification-service` (built in Sprint 4). The Alarm Engine already raises alarms and emits WS events; this sprint adds a **Notification dispatcher** that consumes alarm events, creates per-user notifications (with preferences + dedup + retry), and dispatches them through channel providers (WebSocket, in-app, email). The Alarm Engine is decoupled — it emits events, the dispatcher handles delivery.

## A. Database Migration — `notification.notifications` + `notification.notification_preferences` + `notification.notification_deliveries`

File: `apps/notification-service/src/infrastructure/database/migrations/20260302000000_create_notification_tables.js`

**`notification.notifications`** — the in-app notification record:
- `id` UUID PK, `tenant_id`, `user_id` (nullable — null = broadcast to all tenant users), `category` (alarm/trip/maintenance/compliance/system/billing), `severity` (critical/high/normal/low), `title`, `body`, `link` (nullable deep-link), `read` boolean default false, `read_at` timestamp nullable, `source_type` (e.g. 'alarm'), `source_id` (the alarm ID), `created_at`. Indexes: `(tenant_id, user_id, read, created_at DESC)`, `(tenant_id, user_id, created_at DESC)`.

**`notification.notification_preferences`** — per-user channel + severity preferences:
- `id` UUID PK, `tenant_id`, `user_id`, `category` (text), `min_severity` (text: critical/high/normal/low — only deliver at or above this severity), `channels` jsonb (array of enabled channels: ['websocket','in_app','email']), `enabled` boolean default true, `created_at`, `updated_at`. Unique index on `(tenant_id, user_id, category)`.

**`notification.notification_deliveries`** — delivery audit trail with retry:
- `id` UUID PK, `tenant_id`, `notification_id`, `channel` (websocket/in_app/email/sms/push/webhook), `status` (PENDING/SENT/FAILED/READ), `attempts` int default 0, `error` text nullable, `sent_at` timestamp nullable, `created_at`. Index on `(tenant_id, notification_id)`, `(tenant_id, status, channel)`.

All tables: hardened RLS (FORCE + tenant_id policy). Grants to fleetvision_app + fleetvision_platform.

## B. Domain Layer

### `domain/notification.ts`
`Notification` entity: `id`, `tenantId`, `userId`, `category`, `severity`, `title`, `body`, `link`, `read`, `readAt`, `sourceType`, `sourceId`, `createdAt`. Methods: `markRead()`, static `create()`/`rehydrate()`.

### `domain/notification-preference.ts`
`NotificationPreference`: `userId`, `category`, `minSeverity`, `channels`, `enabled`. Method: `shouldDeliver(severity, channel)` — checks severity threshold + channel enabled.

### `domain/notification-delivery.ts`
`NotificationDelivery`: `id`, `notificationId`, `channel`, `status` (PENDING/SENT/FAILED/READ), `attempts`, `error`, `sentAt`. Methods: `markSent()`, `markFailed(error)`, `canRetry(maxAttempts)`.

### `domain/notification-types.ts`
Type unions: `NotificationCategory`, `NotificationSeverity`, `NotificationChannel` (websocket/in_app/email/sms/push/webhook), `NotificationStatus` (PENDING/SENT/FAILED/READ), `severityRank`.

## C. Channel Dispatcher

### `application/channels/channel-provider.ts`
Interface: `deliver(notification, delivery): Promise<{ success: boolean; error?: string }>`. Each channel implements this.

### Concrete channels:
- **`WebSocketChannel`** — emits `notification.new` to `tenant:<tid>:notifications` room via the existing WS gateway (adds a new room + event to the gateway). Already-authenticated connection; no external provider needed.
- **`InAppChannel`** — a no-op (the notification record IS the in-app delivery — creating it in the DB makes it visible). Returns success immediately.
- **`EmailChannel`** — interface + stub: if SMTP env vars are configured, attempts send via `nodemailer`; if not configured, logs a warning and returns `success: false` with a clear "email not configured" error. **No external delivery unless configured.**

### `application/notification-dispatcher.service.ts`
The orchestrator. Injected into the AlarmEvaluatorService (replacing the direct gateway call). When an alarm is raised:
1. Creates a `Notification` record (in-app persistence) for each tenant user (or broadcast).
2. Loads each user's preferences for the alarm category + severity.
3. For each enabled channel, creates a `NotificationDelivery` (PENDING) + dispatches.
4. On failure, increments attempts + schedules retry (up to 3 attempts with backoff via setTimeout).
5. Emits `notification.new` via WS for realtime bell update.

### `application/notification-service.ts`
The application service for the REST API: list notifications, get unread count, mark as read, mark all as read, update preferences.

## D. Infrastructure

### Repositories
- `notification.repository.ts` — `create`, `findById`, `listPage` (cursor + filter by read/unread), `getUnreadCount`, `markRead`, `markAllRead`.
- `notification-preference.repository.ts` — `getOrDefault` (returns defaults if no preference set), `upsert`, `listForUser`.
- `notification-delivery.repository.ts` — `create`, `updateStatus`, `listPending`.

### WS Gateway update
Add `emitNotification(tenantId, notification)` method to `alarm-realtime.gateway.ts` → emits `notification.new` to `tenant:<tid>:notifications` room. Add this room to the allowed-rooms check.

## E. REST API

### `api/notifications.controller.ts` — `@Controller('api/v1/notification/notifications')`
- `GET /` — list (cursor-paginated, filter: unreadOnly) (`notification.alert.read` — reuse alarm read perm).
- `GET /unread-count` — `{ total, critical, high }`.
- `POST /:id/read` — mark one as read.
- `POST /read-all` — mark all as read.
- `GET /preferences` — list user preferences.
- `PUT /preferences` — update preferences (category + channels + minSeverity).

## F. Alarm Engine Integration

Update `AlarmEvaluatorService.raiseIfAllowed`: instead of (or in addition to) calling `gateway.emitAlarmCreated`, call `notificationDispatcher.dispatchAlarm(alarm)`. The dispatcher creates the notification records + deliveries. This decouples the Alarm Engine from delivery — it just calls `dispatcher.dispatchAlarm(event)` and the dispatcher handles the rest.

Also wire `alarms.controller.ts` acknowledge/resolve to dispatch lifecycle notifications (optional — can be deferred).

## G. Frontend

### `api/notification.api.ts` (new)
- `useNotifications()` → `GET /notification/notifications` with cursor pagination.
- `useUnreadCount()` → `GET /notification/notifications/unread-count` (polls every 30s).
- `useMarkAsRead()` / `useMarkAllAsRead()` → mutations.
- `useNotificationPreferences()` / `useUpdatePreferences()`.

### `types/notification.types.ts` — update
Add `NotificationWire` (snake_case mapper), align types to the backend.

### `hooks/useNotificationRealtime.ts` (new)
Connects to the existing notification-service WS (port 3010), joins `tenant:<tid>:notifications` room, listens for `notification.new`, increments the unread count in the query cache.

### `components/shell/NotificationBell.tsx` (new)
Replaces the static placeholder bell in Topbar. Renders a Popover with: unread count badge, notification list (first 10), mark-as-read buttons. Uses `useUnreadCount` + `useNotifications` + `useMarkAsRead`.

### `api/query-keys.ts` — add `notifications` namespace.

### Wire the bell into `Topbar.tsx`.

## H. Config

Add to `notification.config.ts`:
- `NOTIF_SMTP_HOST`, `NOTIF_SMTP_PORT`, `NOTIF_SMTP_USER`, `NOTIF_SMTP_PASS`, `NOTIF_SMTP_FROM` — all optional (email channel is disabled when unset).

Add `nodemailer` to package.json deps (used only when SMTP configured).

## I. Tests

### Domain:
- `notification-domain.spec.ts` — Notification.markRead, NotificationPreference.shouldDeliver (severity threshold, channel enabled/disabled), NotificationDelivery lifecycle (PENDING→SENT, PENDING→FAILED, canRetry).

### Application:
- `notification-dispatcher.spec.ts` — dispatchAlarm creates notification records, respects preferences (suppresses below min severity), creates deliveries for enabled channels, WebSocket channel emits, InApp channel succeeds, Email channel fails gracefully when unconfigured.
- Retry: a failed delivery increments attempts, retries up to max.

### API:
- Validation schemas for preference updates.

## J. Verification
`pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` all green.

## Sequencing
1. Migration. → 2. Domain (notification, preference, delivery, types). → 3. Repositories. → 4. Channel providers (WS, in-app, email stub). → 5. Notification dispatcher + service. → 6. Alarm engine integration. → 7. WS gateway update. → 8. REST controllers. → 9. Config + nodemailer dep. → 10. Frontend (API + bell + realtime). → 11. Tests. → 12. Verification.

## Rules adherence
- Alarm Engine NOT coupled to delivery (calls dispatcher, not email/SMS directly).
- SMS/push/webhook are interfaces only (not implemented unless provider available).
- Email only sends when SMTP configured (honest stub otherwise).
- Multi-tenant (RLS + tenant_id on all tables).
- User preferences (severity filtering + channel selection).
- Retry (max 3 attempts with backoff).
- Idempotency (source_type + source_id unique per notification — duplicate alarm events don't create duplicate notifications).
- Delivery status (PENDING/SENT/FAILED/READ).
- Audit trail (notification_deliveries table).