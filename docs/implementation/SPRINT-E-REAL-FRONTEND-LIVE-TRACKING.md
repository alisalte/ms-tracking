# Sprint E — Real Frontend Integration & Live Tracking

> **Status:** COMPLETE (verified 2026-08-15)
> Primary vertical: Login → Tenant → Fleet → Vehicle → Device → Live Position → WebSocket → Real-Time Map.
> Objective: replace mock business data with real APIs. The UI was **not** redesigned.

---

## 1. Frontend Architecture

Unchanged stack (no new framework / state library introduced):

| Concern | Implementation |
|---|---|
| Framework | React 19 + Vite 6 (`tsc -b && vite build`) |
| UI | MUI 6 (+ Tailwind tokens), Emotion with RTL stylis plugin |
| Routing | react-router 7 (`src/router/index.tsx`) |
| Server state | TanStack Query 5 (`src/api/query-client.ts`, `query-keys.ts`) |
| Auth/client state | zustand (`src/auth/auth.store.ts`) + typed `token.storage` |
| HTTP | one centralized Axios client (`src/api/client.ts`) |
| WebSocket | socket.io-client 4.7 (`src/hooks/useRealtimeSocket.ts`) |
| Map | maplibre-gl + supercluster (`src/components/map/FleetMap.tsx`) |
| i18n | i18next (en/fa + RTL, `src/i18n/`) — all user-facing strings are keys |
| Validation | zod (incl. 15-digit Luhn IMEI, `src/components/assets/AssetFormDrawer.tsx`) |
| Tests | vitest + Testing Library (21 suites, see §9) |

**Routes** (no duplicates): `/login`, `/dashboard`, `/map` (live tracking,
`tracking.read`-guarded), `/assets` (`vehicle.read`-guarded; `/fleets`, `/vehicles`,
`/devices` redirect into its tabs), plus the pre-existing pages. `/live-tracking`
is served by `/map` — the canonical live-tracking page.

**Dev proxy** (`vite.config.ts`): one origin, no CORS — `/api/v1/fleets|vehicles|devices|summary`
→ fleet-management **:3006**; `/api/v1/positions` → gps-engine **:3005** (prefix
stripped); `/api/v1/tracking/devices` → gps-engine **:3005** (`/api/v1/tracking`
stripped); `/api/v1/notification` → **:3008**; `/api/v1/fleet` → **:3007**;
`/api` catch-all → identity **:3000**. Production mirrors this in
`apps/web-dashboard/nginx.conf`. The WebSocket connects **directly** to
`VITE_GPS_WS_URL` (default `http://localhost:3001`; the gps-engine must list the
dashboard origin in `GPS_WS_CORS_ORIGIN`).

**Service port defaults were aligned with the proxy this sprint:** gps-engine REST
`PORT` 3000→**3005**, notification-service 3000→**3008**, fleet-service 3000→**3007**
(fleet-management already defaulted to 3006). Without this, every `/positions` +
`/tracking/devices` + `/notification` proxy route 404'd against a default-config
service.

## 2. Authentication

- **Real identity-service endpoints** (`src/api/auth.api.ts`): `POST /auth/login`,
  `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all`.
  Wire is snake_case (`access_token`, `tenant_id`); the client maps to camelCase.
- **Token storage** (`src/auth/token.storage.ts`): typed localStorage helpers —
  the only code touching the storage keys. Access + refresh tokens + tenantId.
- **401 handling** (`src/api/client.ts`): response interceptor with a
  **single-flight refresh promise** (concurrent 401s share one refresh), request
  replay after refresh, redirect to `/login` when refresh fails; login/refresh
  endpoints are never retried.
- **Proactive refresh** (`src/auth/useSilentRefresh.ts`, mounted in `AppLayout`):
  decodes `exp` and rotates ~60 s before expiry, so the authenticated state
  survives long sessions.
- **Route guard** (`src/auth/auth.guard.tsx`): `ProtectedRoute` redirects with
  `?redirect=`; the zustand store hydrates synchronously from localStorage so a
  refresh never bounces through `/login`.
- **`X-Tenant-Id`**: sent only as the login/refresh tenant hint the backend
  requires. On every authenticated call the backend derives the tenant from the
  JWT (Sprint B); the header is never a client-side tenant switch.
- **`/auth/me` email fix (backend)**: identity now hydrates `email` from the user
  record (`apps/identity-service/src/api/auth/auth.controller.ts`) instead of
  returning `''`.
- Honest stubs: register/forgot/reset/MFA throw `NotImplementedError` — the
  backend has no such routes; those pages show real errors, never fake success.

## 3. API Client (centralized)

Single Axios instance (`src/api/client.ts`); no component calls `fetch`/axios directly.

- Envelope-aware helpers: `apiGet/apiPost/apiPut/apiPatch/apiDelete` unwrap
  fleet-management/identity's `{ data }` envelope; **`apiGetRaw`** is for
  gps-engine REST (raw bodies) **and** for `Page<T>` list endpoints
  (`{ data, nextCursor }` arrives raw — see §4).
- Every non-2xx is normalized (`src/api/errors.ts`) into typed
  `ApiClientError` subclasses covering 401/403/404/409/422/429/500 + network
  errors, consumed by the shared `ErrorState` component (icon + retry per class).
- **P0 wire-shape fix (this sprint):** `fetchAll` in `asset.api.ts` previously
  fetched pages with the envelope-unwrapping `apiGet`, which silently discarded
  `nextCursor` and crashed on the first page (`out.push(...undefined)`). All
  registry lists (`/fleets`, `/vehicles`, `/devices`) were broken in real mode;
  component tests missed it because they mock the API module. Now pinned by
  `src/__tests__/asset-api.spec.tsx` (cursor-chain, filters, error propagation).
- Same bug class fixed in `admin.api.ts`: `/iam/users` list/detail and
  create/update used `{ data }` double-unwrapping; update also used POST where
  the backend serves `PUT /iam/users/:id`.

## 4. Fleet / Vehicle / Device Management

`src/api/asset.api.ts` → real fleet-management-service (all tenant-scoped, RLS +
permission-guarded server-side):

| Operation | Endpoint | Notes |
|---|---|---|
| Fleet list/create | `GET/POST /fleets` | cursor `Page<T>`, `status`/`search` filters |
| Fleet detail/update/archive | `GET/PATCH/DELETE /fleets/:id` | DELETE = soft archive, 204 |
| Vehicle list/create | `GET/POST /vehicles` | `fleetId`/`status`/`search` filters |
| Vehicle update/archive | `PATCH/DELETE /vehicles/:id` | DELETE = archive |
| Device list/create | `GET/POST /devices` | `imei`/`protocol`/`vehicleId`/`status` filters |
| Device update/decommission | `PATCH/DELETE /devices/:id` | DELETE = decommission |
| Vehicle devices | `GET /vehicles/:id/devices` | binding list for the drawer |
| **Assign device** | `POST /vehicles/:id/devices/:deviceId` | body `{ role?, isPrimary? }`; 409 = already bound |
| **Unassign device** | `DELETE /vehicles/:id/devices/:deviceId` | 204 |

Lists follow the cursor chain in one bounded loop (`limit=200`, max 50 pages);
server-side pagination can replace it later without contract changes. UI
(`AssetManagementPage` + `Fleets/Vehicles/DevicesTab`, `AssetFormDrawer`,
`AssetDetailDrawers`) has loading skeletons, empty states, `ErrorState` + retry,
confirm dialogs for archive/decommission, toasts, zod validation, and
per-tab write-permission gating. 409 already-assigned conflicts surface as
mutation errors.

## 5. Live Tracking (primary feature)

- **Bootstrap (REST, no N+1):** `useMapVehicles()` = registry vehicles
  (`/vehicles` + `/devices`) ⋈ `GET /tracking/devices/status` (gps-engine,
  ONLINE/OFFLINE/STALE + `lastSeenAt`) ⋈ `GET /positions/latest` (one call).
  Unbound-device positions (keyed by deviceId fallback) are joined too.
- **Live deltas (WebSocket):** `useLiveTracking(tenantId)` connects to
  gps-engine Socket.IO, joins `tenant:<id>:fleet`, and folds
  `position.update` (`{ vehicleId, latitude, longitude, speedKph, headingDeg,
  capturedAt, quality }`) and `device.status` (`{ deviceId, state, lastSeenAt }`)
  into `Map<vehicleId, LivePosition>` — **latest position wins, no history is
  appended** to React state (§15/§32). `mergeLivePositions` patches only the
  affected vehicle rows (referentially stable otherwise) and recomputes the
  movement state exactly like the bootstrap derivation (offline → offline,
  STALE → stopped, speed > 2 → driving, else idle).
- **Status & Last Seen are backend-authoritative** (§18/§19): presence comes
  from the device-status projection (Sprint D's stale sweeper), never computed
  from browser time; `lastSeenAt` is the backend timestamp; "never seen"
  renders honestly when no position exists.
- **Map** (`FleetMap.tsx`, maplibre-gl): markers with per-status colors +
  heading rotation, supercluster clustering, imperative marker diffs (no page
  reload), list→map camera fly-to and marker→details selection sync
  (`MapPage.tsx`), WS connection chip (connecting/connected/disconnected/
  reconnecting), pause/resume.
- **Filters** (`MapPage` + `DeviceListPanel`): fleet, status, search — over
  only the vehicles the authenticated user is authorized to see.

### WebSocket lifecycle (§13)

`useRealtimeSocket`: connect → authenticate (JWT in the Socket.IO handshake
`auth.token`, read from token.storage at connect time so rotated tokens are
used) → subscribe (`tenant:<id>:fleet` room; the server re-authorizes every
room join — Sprint B) → disconnect (clean teardown). Reconnect: exponential
backoff 1 s→30 s, max 10 attempts; all event handlers are re-registered on the
new socket exactly once (no duplicate subscriptions); the fleet room is
re-joined after every reconnect. Expired-JWT handshakes fail closed server-side.

## 6. Dashboard

`DashboardGrid` renders real counters via `useFleetStats()`:
fleet-management `GET /summary` (active fleets/vehicles/devices) × gps-engine
`GET /tracking/devices/status` (online/offline/stale; vehicles without a status
record count as UNKNOWN — never guessed). Two requests total, **no N+1** and no
new aggregate endpoint was needed. Loading skeletons, error + retry, and honest
alarm-panel states (real `/notification/alerts`; error shown when the service
is absent).

## 7. Error Handling & RBAC

- Every real-API screen: loading / empty / error / retry (`ErrorState`,
  `EmptyState`, skeletons). WS states surfaced on the map. **No fake success
  when the backend is unavailable** — this sprint additionally removed the
  catch-all fallbacks in `geofence.api.ts` / `notification.api.ts` (which
  masked 401/403/500 as empty lists) by routing them through
  `withMockFallback` (mock only on network error, and only in mock mode).
- RBAC UI: real permissions from `/auth/me` (`fleet/vehicle/device.{read,write}`,
  `tracking.read`, `*` wildcard) drive `RequirePermission`/`PermissionGate`,
  route guards, nav filtering, and per-tab write actions. Client-side checks
  are UX only — the backend stays authoritative.
- **§31 mock removal:** `mock-gate` default is **real-first**
  (`?useMock=true` / localStorage / `VITE_USE_MOCK=true` re-enable fixtures for
  demo/dev only). Ungated leaks fixed this sprint: `fetchSettings` (admin) now
  throws honestly in real mode and `SettingsSection` gained an error state;
  saved-dashboard chart series (`DashboardsSection`) render the fixture only in
  mock mode.

## 8. Tenant Isolation

- WS: the client only ever asks for its own `tenant:<id>:fleet` room; the
  gateway authorizes room joins against the JWT tenant (Sprint B) and the E2E
  suite proves a tenant-B client cannot subscribe to tenant-A rooms.
- REST: tenant derived from the verified credential server-side; RLS + guards
  (Sprints B/C).

## 9. Testing

Web-dashboard (vitest, 20 suites / 154 tests green):

- `auth.api.spec` / `auth.store.spec` / `token.storage.spec` — login/refresh/me
  wire mapping, session persistence, corrupt-token handling.
- `realtime-socket.spec` (**new**) — WS connect with stored JWT, token rotation
  on reconnect, state machine, exponential backoff, max-retry give-up, handler
  re-registration without duplicates, unsubscribe, room join for the
  authenticated tenant only, `position.update` latest-wins, `device.status`
  flips, room re-join after reconnect.
- `asset-api.spec.tsx` (**new**) — Page cursor-chain contract (raw `Page<T>`),
  filter forwarding, real error propagation, fleet/vehicle/device CRUD wire
  calls, bind/unbind endpoints, 409 conflict surfacing.
- `live-tracking.spec` (merge semantics), `map.spec` / `dashboard.spec` /
  `assets.spec` (loading/empty/error/permission-denied UI), `mock-gate.spec`
  (real-first default), plus alarms/reports/trips/video/admin/validation suites.
- `admin.spec` mock corrected to model the client's **post-unwrap** semantics
  (the mismatch that hid the envelope bug).

Backend: identity 42/42 (incl. the `/auth/me` change); fleet-management and
gps-engine suites re-run green (see §11 Commands). The **§30 end-to-end
acceptance** is implemented as
`apps/gps-engine-service/src/__tests__/integration/e2e-sprint-e-frontend-flow.integration.spec.ts`:
real login → fleet/vehicle/device creation → assignment → API-key minting →
device simulator frames → gateway → Kafka → gps-engine → TimescaleDB →
authenticated Socket.IO client receives `position.update`/`device.status` →
bootstrap endpoints → disconnect→OFFLINE→reconnect→ONLINE → tenant-B isolation.
It requires Kafka/PostgreSQL/identity (skips gracefully when they are absent).

## 10. Known Limitations

- Trips page is honestly empty in real mode (gps-engine persists trip events
  but ships no trips REST endpoint yet).
- Reports/video/admin (roles, audit, settings) have no backends — real mode
  shows empty/error states; video streaming remains a synthetic canvas
  placeholder (media-service pending).
- `GET /iam/users` pages with fixed limit/offset (no cursor yet) — the client
  maps the first page and reports `nextCursor: null`.
- docker-compose does not yet include fleet-management/gps-engine/notification
  containers (nginx uses variable upstreams + resolver for exactly this
  reason); dev runs them via `pnpm --filter … dev`.
- Tokens live in localStorage (XSS trade-off; no refresh-token cookie rotation
  yet — matches the current backend design).
- The dashboard Export button is a no-op (no reporting backend).

## 11. Verification (2026-08-15)

- `pnpm --filter @fleetvision/web-dashboard typecheck` — clean
- `pnpm --filter @fleetvision/web-dashboard test` — 20 suites / 154 tests pass
- `pnpm --filter @fleetvision/web-dashboard build` — succeeds
- `pnpm --filter @fleetvision/identity-service test` — 8 suites / 42 tests pass
- `pnpm --filter @fleetvision/fleet-management-service typecheck && test` — green
- `pnpm --filter @fleetvision/gps-engine-service typecheck && test` — green
- `pnpm lint` (biome) — green on touched paths
- (fleet-management's missing `node_modules` — an install-state artifact of the
  sprint-e commit — was restored with `pnpm install --prefer-offline`.)
