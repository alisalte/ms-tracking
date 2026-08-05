# @fleetvision/identity-service

The FleetVision **reference service** (registry #1, bounded context: Identity & Access Mgmt). Sprint 1 proves the platform foundation end-to-end: **config → logger → health → PostgreSQL/knex migration → Redis**, with graceful shutdown. No business/aggregate logic yet (later sprints).

## Run locally

```bash
# 1. Bring up the lean stack (Postgres+Timescale, Redis, Kafka, RabbitMQ, MinIO)
pnpm stack:up

# 2. Run the service (tsx watch)
pnpm dev

# 3. Verify the foundation
curl http://localhost:3000/health/live   # 200 — process is up
curl http://localhost:3000/health/ready  # 200 + PG/Redis indicators up
```

## Environment

Reads from `infra/docker/.env` (copied from `.env.example`). Required keys:

| Var | Example | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | pino level |
| `ENVIRONMENT` | `local` | local/dev/staging/production |
| `DBURL` | `postgres://fleetvision:pw@localhost:5432/fleetvision` | Postgres |
| `REDISURL` | `redis://localhost:6379/0` | Redis |
| `JWT_ISSUER` | `fleetvision` | placeholder (auth epic) |
| `JWT_AUDIENCE` | `fleetvision-identity` | placeholder (auth epic) |

## Layout

```
src/
  main.ts               # bootstrap: validate env → Nest app → graceful shutdown
  app.module.ts         # composition root (config/logger/persistence/redis/health)
  config/               # identity zod schema
  api/health/           # mounted via @fleetvision/health
  infrastructure/
    persistence/        # knex repos land here (later sprints)
    cache/              # cache adapters land here (later sprints)
    database/migrations/# per-service knex migrations
```
