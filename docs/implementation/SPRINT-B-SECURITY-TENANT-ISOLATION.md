# Sprint B — Security & Tenant Isolation

**Scope:** `packages/auth` (new), `packages/health`, `packages/web`, `packages/persistence-knex`,
and all five backend services (`identity-service`, `gps-engine-service`, `map-engine-service`,
`media-service`, `device-gateway-service`). No Sprint C work. GPS trip persistence untouched
except for the one required security fix (device-status tenant scoping).
**Status:** Complete (typecheck ✓ · build ✓ · backend tests ✓ · lint ✓).

The goal was to make every backend service **authenticated, authorization-aware, and
tenant-isolated**, and to eliminate the "send `X-Tenant-Id` and read another tenant's data"
attack. This document is the evidence-based record.

---

## Existing Security Model (before Sprint B)

- **identity-service** had real JWT (HS256) issuance/verification, refresh-token rotation with
  reuse detection, Argon2id hashing, rate-limit/lockout, and an in-process RBAC permissions guard.
- **Every other service** (`gps-engine`, `map-engine`, `media`, `device-gateway` admin API) had
  **no authentication at all** — they derived the tenant from a client-supplied `tenant-id`
  header/query (`tenantOf(req)`) and trusted it verbatim into repository queries.
- **PostgreSQL RLS** was enabled on every tenant table but as a permissive stub
  (`USING (true) WITH CHECK (true)`) — it enforced nothing.
- There was **no shared auth package**; the auth code lived service-local inside identity and
  could not be reused.

## Problems Found

| # | Problem | Severity |
|---|---------|----------|
| 1 | Downstream services trust a spoofable `tenant-id` header as the authoritative tenant | **P0** |
| 2 | gps-engine WebSocket: any client joins any `tenant:<tid>:*` room (live cross-tenant data) | **P0** |
| 3 | WS CORS `origin: '*'` on gps + media | **HIGH** |
| 4 | gps-engine `device_status.find(deviceId)` missing `tenant_id` filter (cache-miss leak) | **HIGH** |
| 5 | media `DELETE /streams/:id` + `session.close` not tenant-scoped; `POST /streams` trusted `body.userId` | **HIGH** |
| 6 | device-gateway admin API fully unauthenticated (dump all tenants' sessions, disable adapters) | **HIGH** |
| 7 | API keys could be created/revoked but **never authenticated anything** (no guard; dead `findByPrefix`) | **HIGH** |
| 8 | Permissive RLS everywhere; `USING(true)` presented as a (false) tenant boundary | **MED** |
| 9 | Permissions resolved via a per-request DB hit; not shareable across services | MED |

## Authentication

A new **`@fleetvision/auth`** package is now the single source of truth. It exposes:

- `CompositeAuthGuard` (registered globally via `APP_GUARD`) — authenticates a request as **JWT**
  _or_ **API key** based on the credential (`Bearer <jwt>`, `Bearer fv_...`, or `X-API-Key`).
  Fail-closed: missing/invalid/expired/revoked → **401** (generic, no enumeration oracle).
- `PermissionsGuard` + `@RequirePermissions()` — RBAC; wildcard `*` (tenant-admin) satisfies all.
- `@Public()` — exempts a route (health, login, refresh).
- `AuthenticatedContext` on `req.auth` (`{ userId, tenantId, roles, permissions, authMethod }`),
  plus `@CurrentUser()` / `@CurrentTenant()` param decorators.
- `AuthModule.forRoot({ jwt })` wires `JwtModule`, the shared Redis `RevocationStore`, the
  `KnexApiKeyVerifier`, and both global guards.

identity-service and every downstream service import it — **no service implements its own auth**.
`@Public()` lives in `@fleetvision/web` (re-exported by auth) so the lightweight `health` package
can declare public routes without a hard dependency on the full auth package.

**Token claims (HS256):** `{ sub, tenant_id, tenant_tier, roles, permissions, scope, aal,
session_id, auth_time }` + registered `jti/iat/exp`. The audience is standardized platform-wide
(`JWT_AUDIENCE=fleetvision`) so one token verifies in every service.

## Authorization

- **Permissions are embedded in the JWT** at login and at refresh (re-resolved from the DB on
  each refresh). Downstream authorization is therefore **stateless** (no per-request DB read, no
  iam-schema coupling).
- The catalog adds only the permissions existing endpoints need: `tracking.read`, `maps.read`,
  `maps.write`, `media.read`, `media.write`, `telemetry.gateway.manage` (all iam/billing/audit
  permissions retained). `viewer` gets the reads, `fleet-admin` gets reads+writes, `tenant-admin`
  already has `*`.
- Permission propagation: a role change in identity calls `RevocationStore.revokeUser()` (shared
  Redis) → the user's outstanding tokens die within the access TTL → the client refreshes → the
  new token carries the fresh permission set.

Per-endpoint permissions: gps positions/device-status → `tracking.read`; map reads → `maps.read`;
map POI/geofence create+delete → `maps.write`; media channel reads → `media.read`; media
stream/channel create+close → `media.write`; device-gateway admin → `telemetry.gateway.manage`.

## Tenant Context

The tenant is **always** taken from the verified credential — the JWT `tenant_id` claim, or the
API key's stored `tenant_id` — never a client header. The shared guard attaches it to
`req.auth.tenantId`; controllers read it via `@CurrentTenant()`. The duplicated `tenantOf(req)`
helpers that trusted the header are deleted from all six downstream controllers.

## X-Tenant-Id Handling

`X-Tenant-Id` is supported only for **tenant switching**, and is validated against the trusted
tenant: a value equal to the caller's own tenant is allowed; any other value → **403** (JWT path)
/ **401** (API-key path). Absent header → use the trusted tenant. Login/refresh still use it
pre-auth (server-resolved via `resolveTenantId`, already validated). **Users are single-tenant
today; real multi-tenant membership (a user in N tenants) is a documented future enhancement.**

Classification: the only `X-Tenant-Id` usages remaining on guarded downstream routes are
read-only (validated by the guard) — no longer an authoritative tenant source anywhere.

## WebSocket Security

- **gps-engine realtime gateway:** a Bearer JWT is verified in the `io.use` handshake (from
  `auth.token` or `Authorization`) — fail-closed (no/invalid token → connection rejected). On
  `subscribe`, the room is parsed and the caller may only join rooms within **its own tenant**
  (`tenant:<tid>:fleet` / `tenant:<tid>:vehicle:<vid>`); cross-tenant subscribe → denied (no join).
  CORS restricted to a configurable list (`GPS_WS_CORS_ORIGIN`), no `*`.
- **media-service signaling gateway:** CORS restricted to `MEDIA_WS_CORS_ORIGIN`. The existing
  opaque signaling-token handshake (already room-bound) is retained. The token is now **minted
  from the verified principal** (`StreamsController` uses `auth.tenantId`/`auth.userId`), not the
  spoofable header / trusted `body.userId`.

## Repository Isolation

- gps-engine `device_status.find(tenantId, deviceId)` now filters by tenant — the cache-miss
  cross-tenant read is closed. (Sprint A's `vehicle_positions`/`trip_events` repos already filter
  by tenant; confirmed unchanged.)
- media `session.close(sessionId, tenantId?)` / `updateViewerCount(...)` are tenant-scoped;
  `StreamManager.closeSessionForTenant()` returns 0 for a cross-tenant/unknown close → controller
  returns 404 (no existence oracle).
- media `POST /streams` uses the verified `auth.userId` (API keys get `null`), never `body.userId`.
- map-engine POI/geofence/address/replay/cluster queries already filter by tenant; POI includes
  global (nullable tenant_id) shared rows by design.
- `withTenantContext` / `withoutTenantContext` are promoted to `@fleetvision/persistence-knex`
  (identity re-exports them) so the `SET LOCAL app.current_tenant_id` GUC is available app-wide.

## PostgreSQL RLS

Every permissive `USING (true) WITH CHECK (true)` policy is replaced with a **real, fail-closed
tenant predicate**:

```sql
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
```

`current_setting(..., true)` returns NULL when the GUC is unset → `tenant_id = NULL` is never
true → **fail-closed (0 rows)** for any query that forgets the tenant context. Applied across
`iam.*`, `audit.audit_entries`, `tracking.{device_status,trip_events,idle_periods,parking_periods,
engine_hours}`, `tracking.geofences`, `geo.{pois,addresses,speed_limits}`, `media.{video_channels,
stream_sessions}` (per-service migrations `20260813120000_*`). `geo.pois`/`geo.addresses` keep
global rows visible via `tenant_id IS NULL OR tenant_id = <ctx>`.

**`tracking.vehicle_positions` is deliberately NOT RLS-enabled.** It is a TimescaleDB hypertable;
Sprint A dropped its RLS to enable compression (Timescale forbids compression + RLS). Its tenant
isolation stays at the **repository layer** (`PositionRepository` filters by `tenant_id`).

### CRITICAL current limitation (honestly documented)

The application connects to PostgreSQL as the **`fleetvision`** role, which is the table owner
**and a superuser**. PostgreSQL **bypasses Row-Level Security** for table owners and superusers
(`FORCE ROW LEVEL SECURITY` does not affect superusers). Therefore **RLS is NOT the enforcing
tenant boundary today** — the authenticated repository-layer `WHERE tenant_id = ?` filter is.
These hardened policies are **forward-ready**: they take effect with no code change once a
non-superuser application role is introduced (a future infrastructure sprint). They are no longer
`USING(true)`, so they are not presented as a (false) security boundary. Verified:
`SELECT rolsuper FROM pg_roles WHERE rolname='fleetvision'` confirms superuser status.

## API Keys

- The new `KnexApiKeyVerifier` (in `@fleetvision/auth`) resolves a presented `fv_<env>_<secret>`
  key by its 11-char prefix (cross-tenant), **Argon2id-verifies** the secret, and checks
  ACTIVE/non-expired. The resolved `tenant_id` becomes the authenticated tenant and `scopes`
  become the permissions — so an API key can **never** reach another tenant's data (every
  repository filters by tenant_id).
- Endpoints accept JWT **or** API key (composite guard).
- `CreateApiKeyUseCase` now validates requested scopes ⊆ the creator's permissions (wildcard
  creator `*` may mint any scope) — closing the gap the domain comment claimed but didn't enforce.

## Service-to-Service Security

Kafka (gateway → gps-engine) and in-process eventing were already internal/trusted (tenant_id in
message headers comes from gateway processing, not the client). No mTLS introduced (out of scope).
The device-gateway admin HTTP port was the one internal API reachable without auth — it is now
JWT-guarded; its binding is configurable (documented that it should be cluster-internal).

## Tests

- **`packages/auth` (23 unit tests):** missing/invalid JWT → 401 (1,2); valid JWT attaches context
  (3); insufficient permission → throw (4); correct permission → allow (5); wildcard (5b);
  tenant switch own→allow (9) / other→403 (10); `@Public` bypass; API key valid→allow (16) /
  revoked→401 (17) / cross-tenant→denied (18); permission-catalog additions; Argon2 verify path
  (match / wrong-secret / REVOKED / expired).
- **gps-engine integration suite (`tenant-isolation.integration.spec.ts`):** real PostgreSQL +
  TimescaleDB against a throwaway DB; proves device_status + trip_events cross-tenant SELECT
  returns nothing, complete/discard only touches the caller's tenant, and the tests would FAIL if
  the `tenant_id` filter were removed. Gracefully skips when no DB is available.
- All pre-existing backend tests remain green (identity 42, gps 72, map 26, media 58,
  device-gateway 124).

## Security Decisions

1. **Permissions embedded in the JWT** (not live-DB per request) — stateless downstream auth,
   zero iam-schema coupling. Role-change revocation gives near-instant propagation.
2. **One shared auth package** — no duplicated guard/Principal across services.
3. **API-key auth path built once** in the shared package — closes the dead-code gap.
4. **RLS hardened as forward-ready defense-in-depth**, with the superuser-bypass limitation
   documented; the repository layer is the real boundary.
5. **Tenant switching limited to own-tenant** today (single-tenant membership); multi-membership
   is a documented future enhancement.
6. **Revocation check fails OPEN on Redis outage** for availability (signature/expiry is the hard
   boundary) — documented as a remaining risk.

## Remaining Risks

- **RLS ineffective under the superuser connection** — needs a non-superuser app role (future
  infra). Repo-layer filtering is the boundary.
- **No `RevokeRoleUseCase`/route** and **`RoleRepository.save` (role-permission edits)** have no
  revocation side-effect today — only `AssignRoleUseCase` invalidates tokens. Adding those paths
  must also call `revokeUser` for affected users.
- **Multi-tenant membership / tenant switching** beyond own-tenant is not implemented.
- **Revocation check fails open** if Redis is unreachable (availability tradeoff).
- **System-role reconciliation for existing tenants** — newly provisioned tenants get the Sprint B
  permissions; existing tenants' `viewer`/`fleet-admin` roles do not auto-receive the new
  downstream permissions (the seed admin has `*` and works everywhere; a reconcile migration is a
  follow-up).
- **HS256 shared secret** (not RS256/JWKS); **no mTLS / OPA / Keycloak / Vault** — all documented
  future hardening, out of Sprint B scope.
- **gps-engine WS vehicle-level enforcement** is deferred (tenant-scoping is the hard boundary;
  no vehicle registry exists yet).
