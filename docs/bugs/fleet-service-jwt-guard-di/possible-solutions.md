# Possible solutions

1. **Drop the composable JwtAuthGuard path in fleet-service.** Keep `AuthModule.forRoot` global guards and `@RequirePermissions` on routes. Matches notification + fleet-management.

2. **Provide `TOKEN_VERIFIER` via `SharedJwtVerifier`** (notification-service pattern) and keep `@UseGuards(JwtAuthGuard)`. Duplicate auth (global CompositeAuthGuard plus per-controller JwtAuthGuard).

3. **Stop registering `jwtAuthGuardProvider` but leave `@UseGuards(JwtAuthGuard)`.** Still fails: Nest cannot construct `JwtAuthGuard` from its constructor (`JwtAuthGuardDeps`).
