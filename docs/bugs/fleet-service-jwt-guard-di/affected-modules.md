# Affected modules

| Module | Role |
| --- | --- |
| `apps/fleet-service/src/api/fleet.module.ts` | Registered `jwtAuthGuardProvider()` without `TOKEN_VERIFIER` |
| `apps/fleet-service/src/api/drivers.controller.ts` | `@UseGuards(JwtAuthGuard, PermissionsGuard)` |
| `apps/fleet-service/src/api/business-trips.controller.ts` | Same redundant guards |
| `packages/auth/src/jwt-auth-guard.provider.ts` | Factory injects required `TOKEN_VERIFIER` |
| `packages/auth/src/auth.module.ts` | Already registers global `CompositeAuthGuard` + `PermissionsGuard` |
| `apps/web-dashboard/nginx.conf` | `/api/v1/fleet/` → `fleet-service:3007` → 502 when the process is down |
| Dashboard `/assets?tab=drivers` | Surfaces the axios 502 |
