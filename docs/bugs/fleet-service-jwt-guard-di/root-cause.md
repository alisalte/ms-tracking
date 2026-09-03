# Root cause

## Crash

`fleet-service` never binds port 3007. Nest fails during DI:

`jwtAuthGuardProvider()` injects `TOKEN_VERIFIER` (required) plus optional revocation/permission tokens.

`FleetModule.forRoot` listed that provider but never registered `TOKEN_VERIFIER` / `SharedJwtVerifier`. Notification-service does register it; fleet-management does not use `jwtAuthGuardProvider` at all.

## Why 502 in the UI

Dashboard `GET /api/v1/fleet/drivers` is reverse-proxied by nginx to `http://fleet-service:3007`. A restarting container → nginx 502 → axios `Request failed with status code 502`.

## Two auth styles mixed

`AuthModule.forRoot()` already installs:

- `APP_GUARD` → `CompositeAuthGuard` (JWT / API key)
- `APP_GUARD` → `PermissionsGuard` (`@RequirePermissions`)

That is how notification-service and fleet-management-service work. `fleet-service` additionally applied `@UseGuards(JwtAuthGuard, PermissionsGuard)` and tried to construct `JwtAuthGuard` via the composable provider, which needs a token AuthModule does not export.

## Latent follow-on (surfaced after the guard was removed)

Both controllers used `import type` for their repositories. With `emitDecoratorMetadata`, Nest then sees constructor arg `Function` and cannot inject `DriverRepository` / `BusinessTripRepository`. Notification-service already value-imports repositories for this reason.

## Third boot blocker (same crash loop)

The fleet schema migration called `t.doublePrecision(...)`. Knex TableBuilder has `double()`, not `doublePrecision`. After the dedicated ledger was in place, boot died with `t.doublePrecision is not a function`. GPS-engine and fleet-management already use `t.double()`.


After DI succeeded, Knex refused to start because `PersistenceModule` used the default `schema_migrations` ledger (identity's). Identity's files are not in fleet-service's migrations directory → `The migration directory is corrupt`. Other services already set a dedicated `tableName` (`fleet_management_schema_migrations`, `notification_schema_migrations`, …).
