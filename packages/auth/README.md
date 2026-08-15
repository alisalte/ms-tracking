# @fleetvision/auth

Shared authentication & authorization primitives for the FleetVision platform —
the **single source of truth** so no service implements its own auth
(Codebase Architecture §10).

## What it provides

- **`AuthModule.forRoot({ jwt })`** — turnkey wiring. Registers the global
  `CompositeAuthGuard` + `PermissionsGuard` (`APP_GUARD`), JWT verification
  (`@nestjs/jwt`), the shared Redis `RevocationStore`, and (optionally) the
  `KnexApiKeyVerifier`. A service just imports it.
- **`CompositeAuthGuard`** — authenticates a request as **JWT** _or_ **API key**
  based on the presented credential, attaches the `AuthenticatedContext` to
  `req.auth`, and validates tenant switching. Fail-closed (401 generic).
- **`PermissionsGuard`** + **`@RequirePermissions()`** — RBAC authorization
  (`*` wildcard for `tenant-admin`).
- **`@Public()`** — exempts a route from auth (health, login, refresh).
- **`@CurrentUser()` / `@CurrentTenant()`** — param decorators reading the
  verified identity.
- **Permission catalog** (`Permissions`, `SYSTEM_ROLES`) — platform-wide strings.
- **`AuthenticatedContext`** (`req.auth`) — `{ userId, tenantId, roles, permissions, authMethod }`.

## Security model

```
Authenticated Request → JWT/API-key validation → identity → tenant context
  → roles/permissions → authorization → tenant-scoped repository → database
```

- The **tenant** comes from the verified credential (JWT `tenant_id` claim or the
  API-key's stored `tenant_id`), **never** a client header.
- **`X-Tenant-Id`** is supported for tenant _switching_ only and is validated
  against the trusted tenant — any other value → `403`. Users are single-tenant
  today; multi-membership is a documented future enhancement.
- **Permissions** are embedded in the JWT at login/refresh, so downstream
  authorization is stateless (no per-request DB read). Role changes call
  `RevocationStore.revokeUser()` → outstanding tokens die within TTL → client
  refreshes → fresh permissions.
- **API keys** (`fv_<env>_<secret>`) are Argon2id-hashed at rest; verification is
  cross-tenant by prefix, then the resolved `tenantId` scopes every query — an
  API key can never reach another tenant's data.

## Note on RLS

PostgreSQL RLS is **not** the enforcing boundary today (the app connects as the
DB owner/superuser, which bypasses RLS). Enforcement is the authenticated
repository-layer `WHERE tenant_id` filter, sourced from `req.auth.tenantId`.
RLS policies are hardened to real predicates as forward-ready defense-in-depth.
