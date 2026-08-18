# FleetVision TailAdmin Migration — Phase 6: Geofences, Alarms & Monitoring

**Date:** 2026-08-18
**Scope:** `apps/web-dashboard` monitoring surfaces — `/alarms`, `/notifications`, `/geofences`, **new `/events`**, and the header notification bell
**Result:** 258/258 unit tests · typecheck ✅ · lint ✅ (all touched files) · production build ✅. Zero API/WS changes; every screen consumes the existing hooks.

---

## 1. What was delivered

| Module | Surface | Notes |
|---|---|---|
| **Geofences** | `/geofences` — list / create / edit / archive / activate-deactivate / map visualization / **vehicle association** | TailAdmin table + filters + detail Modal (map preview, badges, lifecycle actions) + create/edit form (Modal chrome; the map stays the primary drawing interface). Geometry follows the backend exactly: **CIRCLE (center+radius) and POLYGON** — nothing invented. Mutations gated `maps.write` (PermissionGate). |
| **Alarm Center** | `/alarms` — list / severity / status / vehicle / timestamp / location (map view + drawer address) / **acknowledgement** / filtering / search | TailAdmin table + hour-bucketed timeline + MapLibre spatial view + detail slide-over with Acknowledge/Resolve (permission-gated, optimistic transitions preserved). URL-synced filters; three headline stat chips. |
| **Event Center** | **NEW `/events`** — event timeline / event type / vehicle / timestamp / severity | Day-grouped timeline over the notification-service event stream (the platform's event bus — every event carries eventType/vehicleId/severity/createdAt). Type+severity filters (URL-synced), client search, cursor pagination, deep-link navigation to the source entity (`n.link`, e.g. `/alarms?id=…`). Gated `notification.read` — the permission the data source enforces. Nav item in Operations (hidden without the permission). |
| **Notifications** | Bell dropdown + `/notifications` history/preferences | TailAdmin bell (unread badge, latest list, mark-read, mark-all, view-all); Center ported: history with URL-synced filters + cursor pagination, delivery-timeline drawer (SENT ≠ Delivered honesty preserved), preferences matrix with unavailable channels visibly disabled. |

**Real-time:** alarm + notification surfaces keep their WebSocket hooks (`useAlarmRealtime`, `useNotificationRealtime`) — events appear without reloads via the shared incremental cache patches; the Event Center rides the same mechanism.

## 2. Changed files

**Ported to TailAdmin (13):** `pages/AlarmCenterPage`, `components/alarms/{AlarmList, AlarmTimeline, AlarmDetailDrawer, AlarmStatusBadge, AlarmMap(chrome)}`, `pages/NotificationCenterPage`, `components/shell/NotificationBell`, `pages/GeofencePage`, `components/geofences/GeofenceFormDialog` (Modal+Input chrome; the three multi-`Select`s stay MUI — multi-select semantics + the e2e combobox→option gesture), `pages/MapPage` (MapChip a11y fix).

**New (1):** `pages/EventCenterPage.tsx`.

**Wiring:** `router/index.tsx` (+`/events` route behind `RequirePermission(notification.read)`), `components/shell/nav.config.tsx` (+Events nav item, permission-gated), locales (+`events.*` section, `nav.events`, en+fa).

**Tests updated:** `alarms.spec` (native-select filter gesture; aria-label view switching), `notifications.spec` (`.MuiBadge-badge` → `bell-unread-count` testid). **New:** `event-center.spec.tsx` (9 tests).

**Untouched:** all `api/*` modules, WS hooks, `GeofenceDrawMap`/`GeofencePreviewMap` engines, `AlarmTypeIcon`/`AlarmLiveIndicator`, `ConfirmDialog` (shared MUI dialog, gradual), `ToastProvider`.

## 3. Security

Tenant isolation unchanged (header/claim transport; no tenant surface added). Every mutation keeps its `PermissionGate` (`maps.write`, `notification.alert.ack/resolve`); the new route/nav gate is the same string the backend enforces on the notifications API; no permission is hardcoded or bypassed — the backend remains the authority.

## 4. Tests (258/258 total; +9 new this phase)

| Spec | Coverage |
|---|---|
| `event-center.spec` (9, new) | timeline rendering (type/vehicle/timestamp/severity), day grouping, deep-link navigation, URL-synced type/severity filters (params-aware server mock), client search, empty/error states, pagination affordance, 403 without `notification.read` |
| `alarms.spec` (9, updated) | header+stats, rows, drawer open, type filter (native select), timeline/map view switching, Acknowledge transition (permission-gated), mock coverage |
| `notifications.spec` (7, updated) | bell badge/dropdown/mark-all/view-all/click-through, center filters, preferences (SMS disabled), realtime cache patch |
| `alarm-live-indicator` (3) | unchanged, green |

## 5. Known limitations

1. **Geofence form selects stay MUI** (type + alerts + vehicle multi-selects) — native selects don't cover multi-select, and the e2e suite drives the type selector with a real combobox→option gesture.
2. **Event Center = the notification event stream** — there is no separate telemetry-events endpoint today; when one ships, the page swaps its hook without layout changes.
3. `ConfirmDialog` remains MUI (shared by assets/commands/geofences) — port lands with the overlay-primitives milestone.
4. Map view + preview maps keep imperative MapLibre engines untouched (clustering lives on the tracking map only).

**STOP after Phase 6.**
