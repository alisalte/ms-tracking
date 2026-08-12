# Sprint 1: Security & Multi-Tenant Hardening — Implementation Plan

## Overview

This sprint closes the authentication, authorization, tenant-isolation, and audit gaps across all 5 backend services. The approach uses the existing identity-service JWT architecture as the single auth mechanism, extended via a new `@fleetvision/auth` shared package.

---

## Part 1: `@fleetvision/auth` shared package

**New package**: `packages/auth/`

Extract from identity-service into a reusable package:
- `Principal` interface + `getPrincipal(req)` + Express Request augmentation (from `principal.ts`)
- `JwtAuthGuard` — adapted to use `@nestjs/jwt` JwtService directly (no TokenService/RevocationStore/RoleRepository dependency; verifies JWT signature + expiry + iss/aud, builds Principal from claims). Revocation check is deferred (the access TTL is 15min; full revocation is an identity-service concern via Redis).
- `PermissionsGuard` + `@RequirePermissions()` decorator + `PERMISSIONS_KEY`
- `permissionSatisfies()` + `IamPermissions` catalog + `WILDCARD_PERMISSION` + `SYSTEM_ROLES`
- `ZodValidationPipe` (generic, reusable)
- `TenantContext` helper — `withTenantContext(knex, tenantId, fn)` + `withoutTenantContext(knex, fn)` (moved from identity-service, extended with `SET LOCAL ROLE`)
- `TenantInterceptor` — a NestJS interceptor that extracts tenantId from the Principal and stores it in ALS (AsyncLocalStorage) for the request lifetime, so repos can access it without per-method threading

**Config fields added to base-config**: `JWT_SECRET` (min 32), `JWT_ISSUER`, `JWT_AUDIENCE` — so every service validates the same JWT.

**Dependencies**: `@nestjs/common`, `@nestjs/core`, `@nestjs/jwt`, `express`, `zod`. Re-exports `Knex` type from `@fleetvision/persistence-knex`.

Identity-service switches its imports from `./shared/jwt-auth.guard.js` → `@fleetvision/auth` (same guard class, just a different import path).

---

## Part 2: Authentication — guard all 4 services

**Add `@nestjs/jwt` to**: device-gateway, gps-engine, map-engine, media-service `package.json`.

**In each service's feature module** (`gps-engine.module.ts`, `map-engine.module.ts`, `media.module.ts`, `gateway.module.ts`):
- Import `JwtModule.register({ secret: config.JWT_SECRET, signOptions: { algorithm: 'HS256', issuer, audience } })`
- Import `AuthModule.forRoot()` from `@fleetvision/auth` (registers JwtAuthGuard + PermissionsGuard + TenantInterceptor globally)

**In each service's `main.ts`**: register `app.useGlobalGuards(new JwtAuthGuard())` (or wire via AuthModule as APP_GUARD).

**Controller changes** — remove the duplicated `tenantOf(req)` helper from all 6 controllers; replace with `getPrincipal(req).tenantId`. Add `@UseGuards(JwtAuthGuard)` to every controller class.

**Endpoint classification**:
- **Public**: `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh` (identity-service only)
- **Authenticated** (any valid JWT): all gps-engine, map-engine, media-service GET endpoints; `GET /auth/me`; `POST /auth/logout`
- **Permission-gated** (specific RBAC): identity-service IAM/tenant/api-key mutations
- **Service-to-service**: device-gateway admin endpoints (require `iam.gateway.manage` permission or internal-network-only)

**Device-gateway admin**: since it has no JWT infrastructure in the ingestion path, the admin controller gets `@UseGuards(JwtAuthGuard)` with a new permission `telemetry.gateway.manage`. The TCP/UDP ingestion path continues to use the device-registry auth (unchanged).

---

## Part 3: JWT + `/auth/me` fix

**Fix `GET /api/v1/auth/me`**: make it `async`, inject `UserRepository`, call `users.findById(p.tenantId, p.userId)`. Return real email, username, display_name, status, mfa_enabled. Throw `NotFoundError('User')` (404) if the user no longer exists.

**JWT claims** remain as-is (no email in JWT — correct for security). The Principal carries `userId`, `tenantId`, `tenantTier`, `roles`, `permissions`, `sessionId`, `jti`, `authMethod`. No sensitive data added.

---

## Part 4: Authorization — RBAC consistency

**Add `telemetry.gateway.manage` permission** to the catalog for device-gateway admin.

**Apply `@RequirePermissions` to admin endpoints**: `AdminController` methods require `telemetry.gateway.manage`.

**Fix role-assign escalation**: `AssignRoleUseCase` adds a check — the caller's permissions must satisfy the target role's permissions (subset check). A `fleet-admin` (no wildcard) cannot assign `tenant-admin` (wildcard). This is enforced by comparing `permissionSatisfies(callerPermissions, role.permissions)` — if any role permission isn't held by the caller, throw `PermissionDeniedError`.

**Fix `GET /iam/users/:id` returning `{data:null}`**: throw `NotFoundError('User')` → 404 via GlobalExceptionFilter.

---

## Part 5: WebSocket security

**gps-engine `realtime.gateway.ts`**:
- Add `io.use(authMiddleware)` that verifies a JWT from `socket.handshake.auth.token` using the same JwtModule config. Reject if invalid → `next(new Error('Unauthorized'))`.
- In the `subscribe` handler: parse the room name (`tenant:<tid>:fleet` or `tenant:<tid>:vehicle:<vid>`), extract the tenant id, compare against the verified principal's `tenantId`. Reject if mismatch.
- Tighten CORS from `origin: '*'` to a configurable origin.

**media-service `signaling-gateway.ts`**:
- Fix the token-verification bug: the middleware currently looks up the token by sessionId but never compares the token string. Add a constant-time comparison of the client-supplied token against the stored hash.
- Tighten CORS.

---

## Part 6: PostgreSQL RLS hardening

**New migration** (`20260811000000_harden_rls.js` in identity-service):
1. Create role `fleetvision_app` (NOLOGIN, NOBYPASSRLS)
2. Create role `fleetvision_platform` (NOLOGIN, BYPASSRLS)
3. Grant both roles to `fleetvision` (so the superuser can SET LOCAL ROLE to either)
4. GRANT SELECT, INSERT, UPDATE, DELETE on ALL tenant-scoped tables to both roles
5. GRANT USAGE on schemas (iam, audit, tracking, telemetry, geo, media)
6. Drop all existing `USING(true) WITH CHECK(true)` policies
7. Create real policies:
   - Standard tables: `USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid)`
   - Nullable-tenant tables (`geo.pois`, `geo.addresses`): `USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (...)`
   - `iam.role_permissions` (no tenant_id column): `USING (EXISTS (SELECT 1 FROM iam.roles WHERE iam.roles.id = role_permissions.role_id AND iam.roles.tenant_id = current_setting('app.current_tenant_id')::uuid))`
   - `iam.tenants`: permissive (platform-readable by design)
   - `audit.audit_entries`: enable RLS + tenant-scoped policy
8. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on all tenant tables
9. `ALTER TABLE audit.audit_entries NO UPDATE, NO DELETE` via trigger (append-only, INV-A01)

**Update `withTenantContext`** (in `@fleetvision/auth`):
```ts
export async function withTenantContext(knex, tenantId, fn) {
  assertUuid(tenantId);
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL ROLE fleetvision_app`);
    await trx.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(trx);
  });
}
```

**Update `withoutTenantContext`**:
```ts
export async function withoutTenantContext(knex, fn) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL ROLE fleetvision_platform`);
    return fn(trx);
  });
}
```

**Non-identity services**: repos continue to use `WHERE tenant_id = ?` (app-layer isolation). RLS provides defense-in-depth. The JWT guard ensures tenantId comes from verified claims, not a spoofable header. For full RLS enforcement in non-identity services, repos would need to adopt `withTenantContext` — documented as remaining work.

---

## Part 7: Tenant isolation bug fixes

Fix the confirmed cross-tenant leaks:
1. **device-status DB fallback**: `DeviceStatusRepository.find(deviceId)` → add `tenantId` param + `WHERE tenant_id = ?`
2. **media session close**: `SessionRepository.close(sessionId)` → add `tenantId` param + `WHERE tenant_id = ?`
3. **media updateViewerCount**: same pattern
4. **poi delete**: `PoiRepository.delete(id)` → add `tenantId` param
5. **position exists dedup**: `PositionRepository.exists(messageId)` → add `tenantId` to the WHERE
6. **map-engine geo cache keys**: add tenant segment to Redis keys (`geo:rev:${tenantId}:${lat}:${lng}`)
7. **map-engine LocalProvider**: add tenantId to geocode/reverseGeocode/searchPlaces queries

---

## Part 8: Audit subsystem wiring

**Add `AuditRepository.appendStandalone(knex, entry)`** — a method that opens its own short transaction (doesn't require the caller to pass a trx). Fire-and-forget with error logging (audit failure must not break the business operation).

**Wire audit into use-cases** (inject `AuditRepository` + `AuditContext`):
- `LoginUseCase`: audit SUCCESS on login, DENIED on failure (bad password, locked, inactive tenant)
- `LogoutUseCase`: audit logout
- `CreateUserUseCase`: audit user creation
- `UpdateUserUseCase`: audit user update (with before/after)
- `AssignRoleUseCase`: audit role assignment
- `CreateApiKeyUseCase`: audit API key creation
- `RevokeApiKeyUseCase`: audit API key revocation
- `ProvisionTenantUseCase`: audit tenant provisioning
- Tenant suspend/activate: audit status transitions

**AuditContext**: a lightweight ALS-based context that carries `actorId`, `tenantId`, `ipAddress`, `userAgent`, `requestId` from the request, populated by the TenantInterceptor. Use-cases read it to fill audit entries without threading these values through every method.

---

## Part 9: Validation

Add `ZodValidationPipe` to the raw `@Body()` endpoints:
- `PUT /iam/users/:id` → `updateUserSchema` (email optional, display_name optional)
- `POST /iam/users/:id/roles` → `assignRoleSchema` (role_id required, UUID)
- `POST /tenants` → `provisionTenantSchema` (name, tier enum, region, admin_email, admin_username, admin_password min 12)

Schemas defined in `auth.dto.ts` alongside the existing ones.

---

## Part 10: Session persistence

**Wire `AuthRepository.createSession`** into `LoginUseCase`:
- After successful password verification, before issuing tokens, call `auth.createSession({ id: sessionId, tenant_id, user_id, status: 'ACTIVE', auth_provider: 'LOCAL', aal: 1, ip_address, user_agent, issued_at: now, last_seen_at: now, absolute_expires_at: now + refreshTtl })`.
- This populates `iam.auth_sessions` (currently always empty).
- On logout, `revokeSession('LOGOUT')` already works.

---

## Part 11: Tests

New test files:
1. `packages/auth/src/__tests__/jwt-auth.guard.spec.ts` — unit test: valid token → Principal attached; invalid/expired → 401; missing header → 401
2. `packages/auth/src/__tests__/permissions.guard.spec.ts` — permission check: has permission → pass; missing → 403; wildcard → pass
3. `packages/auth/src/__tests__/tenant-isolation.spec.ts` — tenant A token cannot access tenant B data (principal.tenantId verified from JWT, not header)
4. `apps/identity-service/src/__tests__/audit.spec.ts` — audit entries written on login/logout/user-create/role-assign/api-key-create/tenant-provision
5. `apps/identity-service/src/__tests__/auth-me.spec.ts` — `/auth/me` returns real email (not empty)
6. `apps/identity-service/src/__tests__/rls-policies.spec.ts` — verifies migration SQL defines real policies (not USING(true)), FORCE RLS, app role
7. `apps/gps-engine-service/src/__tests__/realtime-auth.spec.ts` — WS subscribe rejected without valid JWT; rejected for wrong tenant
8. `apps/identity-service/src/__tests__/validation.spec.ts` — updateUserSchema, assignRoleSchema, provisionTenantSchema validation

---

## Execution order

1. Create `@fleetvision/auth` package (Principal, guards, permissions, ZodValidationPipe, tenant-context)
2. Refactor identity-service to import from `@fleetvision/auth`
3. RLS hardening migration + role creation
4. Wire audit into use-cases
5. Fix `/auth/me`, validation, error handling, session persistence
6. Add guards to the 4 non-identity services
7. Fix tenant-isolation repo bugs
8. Secure WebSocket gateways
9. Write all tests
10. Run all 4 gates + fix until green

## Rules respected
- No Keycloak/OPA/Vault added
- JWT not replaced (same HS256 + @nestjs/jwt)
- Identity-service not redesigned (same use-cases, same repos — just wired)
- No `USING(true)` — all real policies
- No `any`/`@ts-ignore` to silence errors
- No public APIs changed (except `/auth/me` returning real data + `GET /:id` returning 404)