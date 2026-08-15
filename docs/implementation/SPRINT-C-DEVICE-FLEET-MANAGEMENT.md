# Sprint C — Device & Fleet Management

> Implementation report for the Fleet/Vehicle/Device bounded context + the persistent,
> tenant-aware device registry, wired into the existing `device → gateway → Kafka →
> gps-engine → TimescaleDB` pipeline. Evidence-based; verified against the actual code.

## Existing Architecture

Sprint A (GPS Data Integrity) and Sprint B (Security & Tenant Isolation) were complete
on entry. Relevant prior facts (verified in source):

- **Telemetry vertical (real):** `device-gateway-service` decodes GT06/JT808/Meitrack/stub
  binary → `PacketDispatcher` (decode → validate → **auth/resolve** → normalize → publish)
  → `DeviceGatewayKafkaProducer` (CloudEvents JSON, keyed by `device_id`) →
  `gps-engine-service` Kafka consumer → `PositionPipeline` → `tracking.vehicle_positions`
  (TimescaleDB hypertable) + Redis caches + WebSocket. Identity is bound fail-closed:
  a `DeviceMessage` is never published before the session is AUTHENTICATED.
- **Device registry was `InMemoryDeviceRegistry`** (seeded from config/tests). A clean
  `DeviceRegistry` port already existed (`resolve(imei) → {deviceId,tenantId,status,
  pairedVehicleId}` + `tenantActive(tenantId)`), consumed by the `AuthResolver`
  3-tier cache ladder: L1 in-process LRU (~30s) → L2 Redis (~5min) → L3 registry.
- **Auth (Sprint B):** shared `@fleetvision/auth` — `CompositeAuthGuard` (JWT + API key)
  + `PermissionsGuard` (`@RequirePermissions`, `*` wildcard for tenant-admin) registered
  globally. Tenant derived from the verified credential (INV-I02), never a header.
- **Conventions:** Clean Architecture per service; `@fleetvision/persistence-knex`
  (`KNEX_TOKEN`, `withTenantContext`, `?::uuid` binds); shared `audit.audit_entries`
  table (hash-chained, but **never written** before Sprint C); cursor pagination in
  `@fleetvision/shared-kernel`; RLS permissive-stub-then-harden pattern (repository-layer
  `WHERE tenant_id` is the enforcing boundary today — app connects as superuser).
- **Connection state already flows via events:** the gateway emits
  `telemetry.session.lifecycle` (AUTHENTICATED/ACTIVE/DISCONNECTED); gps-engine consumes
  it into `tracking.device_status` (ONLINE/OFFLINE/STALE, last_seen_at).

## Domain Model

`fleet-management-service` owns three aggregates + one relationship:

- **Fleet** — tenant-scoped grouping of vehicles (`fleet.fleets`).
- **Vehicle** — belongs to a fleet; plate/VIN/code (`fleet.vehicles`).
- **Device** — the persistent device registry: IMEI, serial, manufacturer, model,
  protocol, lifecycle **status**, connection timestamps (`fleet.devices`).
- **Vehicle↔Device** — current bindings; ≤1 vehicle per device, ≤1 primary per vehicle
  (`fleet.vehicle_devices`).

Deliberately **not** added (future sprints, per §3): Driver, Fuel, Maintenance, WorkOrder,
Part, Alarm, Notification.

**Status separation (§9):** `Device.status` is the lifecycle/authorization status
(`ACTIVE | SUSPENDED | DECOMMISSIONED | UNPAIRED`) — reused verbatim from the gateway's
existing `DeviceStatus` so the resolve contract is unchanged. It is distinct from the
**connection** state (ONLINE/OFFLINE/STALE in `tracking.device_status`).

## Database Model

Migration `20260814100000_create_fleet_schema.js` (schema `fleet`) + RLS harden
`20260814110000_harden_fleet_rls_policies.js`:

| Table | Key columns / constraints |
|---|---|
| `fleet.fleets` | id, tenant_id, name, code, description, status[ACTIVE,ARCHIVED], version; UNIQUE(tenant_id,code) |
| `fleet.vehicles` | + fleet_id→fleets (ON DELETE RESTRICT), name, code, plate, vin; UNIQUE(tenant_id,code), UNIQUE(tenant_id,plate), UNIQUE(tenant_id,vin) |
| `fleet.devices` | id, tenant_id, **imei (GLOBAL UNIQUE)**, serial_number, manufacturer, model, protocol[gt06,jt808,meitrack,stub], status[ACTIVE,SUSPENDED,DECOMMISSIONED,UNPAIRED], last_seen_at, connected_at, disconnected_at, version; idx(tenant_id,status/protocol/manufacturer/serial) |
| `fleet.vehicle_devices` | id, tenant_id, vehicle_id→vehicles, device_id→devices, role[TRACKER,MDVR,CAN,SENSOR,OTHER], is_primary, bound_at; **UNIQUE(device_id)**, partial UNIQUE(vehicle_id) WHERE is_primary |

Indexes match real access patterns (tenant-scoped list/filter + global IMEI lookup).
UUID PKs via `gen_random_uuid()`; `created_at`/`updated_at` `useTz`; optimistic `version`.

## API

All routes under `/api/v1/...`, JWT+RBAC guarded (Sprint B), tenant from the credential.
Cursor pagination (`{data, nextCursor}`), zod-validated bodies.

- **Fleets** `fleet.read/.write`: `POST/GET/GET:id/PATCH:id/DELETE:id` (DELETE=archive;
  filters status, search).
- **Vehicles** `vehicle.read/.write`: same shape (filters fleetId, status, search) +
  `GET /vehicles/:id/devices` + binding `POST/DELETE /vehicles/:id/devices/:deviceId`.
- **Devices** `device.read/.write`: same shape (filters status, protocol, manufacturer,
  vehicleId, imei, search) + `GET /devices/:id/vehicle` (DELETE=DECOMMISSION).
- **Resolve (service-only):** `GET /devices/resolve?imei=` — `device.registry.resolve`;
  **API-key-only** (rejects JWTs, incl. tenant-admin's wildcard), so no user can
  enumerate cross-tenant devices.

## Tenant Isolation

Every read filters `WHERE tenant_id = ?::uuid`; cross-tenant ids resolve to 404 (no
enumeration oracle). Writes run inside `withTenantContext` (sets `app.current_tenant_id`
+ opens the transaction). RLS hardened to fail-closed predicates (forward-ready; the
repository filter is today's boundary since the app connects as superuser). Verified by
real-PostgreSQL cross-tenant integration tests (§33): Tenant A cannot read/update/archive
Tenant B fleet/vehicle/device, cannot bind across tenants, and a position is not leaked
cross-tenant in `tracking.vehicle_positions`.

## Device Registry

The `InMemoryDeviceRegistry` (tests/dev) is joined by the production **`HttpDeviceRegistry`**
behind the existing `DeviceRegistry` port. The gateway resolves IMEI → identity over HTTP
to fleet-management's resolve endpoint. **The gateway never knows fleet's DB schema** (§17) —
it depends only on the port + the resolve response contract. `InMemoryDeviceRegistry` is
retained for unit tests.

## Gateway Integration

`gateway.module.ts` now provides `HttpDeviceRegistry` (config: `FLEET_REGISTRY_URL`,
`FLEET_REGISTRY_API_KEY`) as the `DEVICE_REGISTRY`. The `AuthResolver`, `PacketDispatcher`,
session lifecycle, and Kafka producer are **unchanged** — the resolve result still yields
`{deviceId, tenantId, status, pairedVehicleId}`, which the dispatcher binds onto the
session and every published message (trusted identity, never device-supplied).

## Device Authentication

LOGIN flow: device sends IMEI → `AuthResolver` L1→L2→L3(HTTP resolve) → found?
No → **unknown → reject/close**. Yes → tenant active? No → reject. Status ACTIVE → accept;
SUSPENDED/DECOMMISSIONED → **disabled → reject**. Tenant ownership comes from the
persistent Device record, never from the device. No device-supplied tenant is trusted.

## Connection State

The gateway stays a pure producer. fleet-management runs a **Kafka consumer** of
`telemetry.session.lifecycle` that projects connection state onto `fleet.devices`:
AUTHENTICATED/ACTIVE → `connected_at` + `last_seen_at`; DISCONNECTED → `disconnected_at`
+ `last_seen_at`. Not per packet (the gateway emits only transitions). Per-packet liveness
stays in Redis + `tracking.device_status`.

## Caching

The gateway's existing L1 LRU (~30s) / L2 Redis (~5min) cache the L3 resolve result, so
HTTP is hit only on a cache miss (~once per device per 5 minutes) — never per packet.
**Invalidation is TTL-bounded** (§29): a just-disabled/reassigned device is rejected
within ≤30s. This safe, simple strategy was chosen over a new invalidation event channel
(§29 explicitly allows it). Documented limitation.

## Kafka Integration

No event model was redesigned. The gateway continues to publish the same CloudEvents
envelopes (deviceId/tenantId/protocolId/…) with identity sourced from the trusted
registry. fleet-management adds one NEW consumer (session lifecycle → device connection
state) on the existing topic.

## Tests

- **Unit (no DB):** IMEI Luhn/normalize; zod schemas (incl. INV-I02 — no `tenant_id`
  from body); binding invariants (cross-tenant/duplicate/primary) with mock repos;
  `HttpDeviceRegistry` (known/unknown/disabled/HTTP-500/network-error/no-key fail-closed).
- **Integration (real PostgreSQL):** fleet/vehicle/device CRUD + uniqueness + archive +
  audit; binding + cross-tenant denial + IMEI global uniqueness + duplicate/primary rules;
  device resolve (known/unknown/disabled + tenant-active).
- **Gateway E2E (§32 leg):** real device in fleet DB → real HTTP resolve server → real
  `PacketDispatcher`/`StubAdapter` → captured envelope with trusted deviceId/tenantId;
  unknown + disabled rejected fail-closed.
- **gps-engine E2E (§32 leg):** the gateway CloudEvents envelope → real
  `parsePositionEnvelope` + `PositionRepository` → row persisted under the correct
  tenant + cross-tenant read returns nothing.
- Integration tests use a throwaway DB in the local docker-compose Postgres with graceful
  skip (no Docker ⇒ skip ⇒ green CI). Migrations are applied by importing the `.js`
  modules and calling `up(knex)` (knex's own loader cannot eval ESM `.js` under jest's
  vm-module sandbox — a pre-existing condition; production `knex.migrate` is unaffected).

## End-to-End Flow

`Device → Gateway → DeviceRegistryPort (HTTP) → fleet-management → fleet.devices`
(resolution) and `Gateway → Kafka → gps-engine → tracking.vehicle_positions`
(persistence). The two integration tests span the gateway leg and the gps-engine leg,
joined by the CloudEvents envelope contract (the documented Kafka seam — the codebase runs
no real Kafka in tests). Trusted tenantId/vehicleId originate from the persistent registry,
propagate through the envelope, and land under the correct tenant in TimescaleDB.

## Architectural Decisions

1. **HTTP registry adapter** (not direct DB / not event projection) — the gateway stays
   fully decoupled from fleet's schema; cache ladder keeps it off the hot path.
2. **IMEI globally unique** — physical identity is tenant-independent (resolve is
   cross-tenant); enforced by a global unique index.
3. **Device status = the gateway's existing lifecycle enum** — no new state machine; it
   is separate from connection state.
4. **DELETE = archive/disable, never hard delete** — telemetry history in
   `tracking.vehicle_positions` is never destroyed (§27).
5. **Cursor pagination** everywhere (shared-kernel standard).
6. **Audit via the existing `audit.audit_entries`** (ported `AuditRepository.append`),
   atomic with each mutation. Required fixing a latent column-type bug
   (`request_id` was `uuid`; altered to `text` via a forward migration) — the first
   service to actually write audit exposed it.
7. **Resolve endpoint is API-key-only** — `device.registry.resolve` granted to no user
   role; JWTs (even tenant-admin wildcard) are rejected outright.

## Remaining Limitations

- TTL-bounded cache invalidation (≤30s window for disable/reassign) — no push-based
  invalidation channel (intentional, per §29).
- Provisioning the gateway's service API key (`FLEET_REGISTRY_API_KEY`) is a manual/ops
   step; without it the gateway fail-closes (rejects all devices) until set.
- The pre-existing gps-engine integration suites (Sprint A/B) still skip under jest due
  to the knex/ESM loader quirk above (green, not failing). The Sprint C suite avoids it.
- No real-Kafka end-to-end test (consistent with the codebase); the envelope contract is
  the verified seam.
- RLS is forward-ready but not the enforcing boundary today (superuser app connection);
  the repository-layer filter enforces tenant isolation.
