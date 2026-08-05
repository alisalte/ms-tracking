# @fleetvision/health

NestJS `@nestjs/terminus`-based health endpoints (01 §10.1, Sprint 1 DoD #5):

- `GET /health/live` — **liveness**: always `200` while the process is alive. Runs no dependency checks (a slow DB must not restart the pod).
- `GET /health/ready` — **readiness**: `200` only when **Postgres** (knex `SELECT 1`) **and Redis** (`PING`) respond; otherwise `503` with the failing indicators.

Response is the standard terminus `HealthCheckResult`: `{ status, info, error, details }`.

## Usage

```ts
@Module({ imports: [HealthModule] })
export class AppModule {}
```

The module expects `PersistenceModule` and `RedisModule` to be present (the indicators inject their clients). Import it after them.
