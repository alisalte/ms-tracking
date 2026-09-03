# Recommended fix

Use option 1.

- Remove `jwtAuthGuardProvider()` from `FleetModule`.
- Remove `@UseGuards(JwtAuthGuard, PermissionsGuard)` from `DriversController` and `BusinessTripsController`.
- Value-import `DriverRepository` / `BusinessTripRepository` in those controllers (not `import type`).
- Set `migrations.tableName` to `fleet_schema_migrations` so Knex does not treat identity's ledger as this service's.
- Replace invalid `t.doublePrecision()` with `t.double()` in the fleet schema migration.
- Import `HealthModule.forRoot()` so `/health/live` exists (compose healthcheck).
- Keep `@RequirePermissions(...)` on every route.
- Rebuild/restart `fleet-service` so nginx has a live upstream.
