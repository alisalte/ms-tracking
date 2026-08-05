## EPIC 1 — Platform Foundation · Sprint 1: Project Bootstrap

### Goal
A **runnable pnpm monorepo** that realizes the codebase architecture in `Documents/22_Codebase_Architecture.md` and the technology decisions in ADR-021/022. One reference service (`identity-service`) boots end-to-end, proving the foundation: config → logger → health checks → PostgreSQL/knex connectivity + migration → graceful shutdown. Spin up the full lean stack (Postgres+Timescale, Redis, Kafka, RabbitMQ, MinIO) via Docker Compose.

> Verified env: Node v22.15.1 ✓, Docker + Compose ✓. **pnpm will be enabled via Node's bundled Corepack** (`corepack enable`) and pinned through `packageManager` in the root `package.json` — no global install required.

### Scope decisions (confirmed)
- **One reference service** — `identity-service` (registry MVP #1). Other 17 services get a generator template for later sprints.
- **Depth: Health + connectivity** — no business/aggregate logic; just prove the foundation runs.

### Out of scope for Sprint 1
- Business/aggregate domain code, REST CRUD verticals, Kafka producers/consumers, gRPC, CQRS bus, event store, auth/OPA, the generator actually producing files, ArgoCD/Istio/Helm/Terraform (Sprint 2+), Pact/contract tests, front-end.

---

### Deliverables

**1. Monorepo root**
- `package.json` — workspace root, `packageManager: pnpm@9.x`, scripts (`build`/`test`/`lint`/`typecheck`/`format`).
- `pnpm-workspace.yaml` — declares `apps/*`, `packages/*` (per §2).
- `.npmrc` — `node-linker=isolated`, `auto-install-peers=true`.
- `tsconfig.base.json` — **strict** TS config (`strict`, `strictNullChecks`, `noImplicitAny`, project references) inherited by all packages (§3, §15).
- `.gitignore`, `.dockerignore`, `.nvmrc` (Node 22 LTS), `biome.json` (primary linter/formatter, §3).
- `.husky/` + `lint-staged` — Biome + typecheck on staged files (§3).
- `.editorconfig`.

**2. Shared Kernel + cross-cutting packages** (`packages/*`) — implementing the modules from §9/§10 that Sprint 1 needs. Each is its own workspace package with `package.json` + `tsconfig.json`, exposes a NestJS `DynamicModule`, and exports a clean public barrel:
  - `@fleetvision/shared-kernel` — DDD primitives: `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent` (CloudEvents-aligned), branded `Identifier` types (`TenantId`, `UserId`…), `Result`, canonical error/code catalog types, pagination (`Cursor`/`Page<T>`).
  - `@fleetvision/config` — typed, **zod-validated** env loader (§13). Validates at boot, crashes fast on invalid config, exposes `forRoot()` that loads a service-specific zod schema and injects a typed `ConfigService`.
  - `@fleetvision/observability` — **pino** structured logger with the mandatory correlation fields from `01` §11.3 (`timestamp, level, service, trace_id, correlation_id, tenant_id, user_id, message, context`), W3C `traceparent` request-id propagation, NestJS `LoggerService` adapter + `LoggerModule.forRoot()`.
  - `@fleetvision/persistence-knex` — knex client factory (PgBouncer-aware pool), `BaseRepository`, **migrations runner** with one example migration (creates a tiny `schema_migrations`-style / sample table to prove the path). Exposes `PersistenceModule.forRoot()`.
  - `@fleetvision/cache-redis` — `ioredis` client factory + `RedisModule.forRoot()`.
  - `@fleetvision/health` — NestJS `@nestjs/terminus`-based health endpoint: `/health/live` (liveness, always 200) and `/health/ready` (readiness: PG ping via knex + Redis ping), per API_Design / `01` §10.1 smoke-test contract.
  - `@fleetvision/web` — minimal JSON:API error envelope + a global exception filter stub + request-id interceptor (the seed of §8 interceptors; only what health/root need).

**3. Reference service** — `apps/identity-service/` implementing the per-service shape from §4/§14:
  - `src/main.ts` — bootstrap: `NestFactory.create`, register config/logger/persistence/redis/health, enable shutdown hooks, **graceful shutdown** (SIGTERM/SIGINT → close DB pool + Redis).
  - `src/app.module.ts` — composition root importing the infra modules above.
  - `src/config/identity.config.ts` — zod schema for identity (port, dbUrl, redisUrl, logLevel, jwt placeholder).
  - `src/api/health/` — wires the health module.
  - `src/infrastructure/` — empty-but-present `persistence/`, `cache/` folders so the layering is real.
  - `Dockerfile` — multi-stage, **distroless/non-root final image** (gcr.io/distroless/nodejs22-debian12), `< 200MB`, parametrized (§3 Deployment runbook + TDR §10 image-signing posture).
  - `nest-cli.json`, `tsconfig.json` (extends base), `package.json` (workspace:* deps), `README.md`, Jest unit test for config validation.

**4. Docker Compose stack** — `infra/docker/docker-compose.yml` — the full lean stack with healthchecks:
  - `postgres:16` + TimescaleDB extension image, init SQL enabling `timescaledb`/`postgis`/`pg_trgm`.
  - `redis:7`.
  - `confluentinc/cp-kafka` (+ Zookeeper, single-broker dev profile) with topic auto-create.
  - `rabbitmq:3-management`.
  - `minio/minio` (S3-API; sovereign/edge parity, TDR §6).
  - `.env` template + a `make`/pnpm `stack:up` convenience script.

**5. CI/CD base** — `.github/workflows/ci.yml`: on PR, install via pnpm (Corepack in runner), typecheck, Biome lint+format check, build all packages+apps, run unit tests. Matrix-free single job for Sprint 1; matrix/scan/sign gates land in Sprint 2 per the runbook.

**6. Generator template (non-functional scaffold)** — `tools/generators/new-service/` plop template + README documenting how it will stamp the 17 remaining services from the identity-service shape in later sprints. Not wired to actually run yet (explicitly out of scope per your answer).

**7. Top-level `README.md`** updates — add a "Getting Started (Sprint 1)" section: prerequisites, `corepack enable`, `pnpm i`, `pnpm stack:up`, `pnpm dev`, health-check curl, what's done vs. planned.

---

### Definition of Done
1. `corepack enable && pnpm install` succeeds with one deterministic lockfile.
2. `pnpm typecheck` + `pnpm lint` + `pnpm test` pass across the whole workspace.
3. `pnpm build` produces dist for every package + the app.
4. `docker compose -f infra/docker/docker-compose.yml up -d` brings up PG/Redis/Kafka/RabbitMQ/MinIO, all reporting healthy.
5. `pnpm --filter identity-service dev` boots the service; `curl http://localhost:3000/health/live` → `200`, `/health/ready` → `200` with PG+Redis indicators `up`.
6. The service runs as **non-root** in its container (Dockerfile final stage).
7. Graceful shutdown verified: SIGTERM closes the DB pool and Redis without hanging.

### Risks / notes
- **pnpm absent**: handled via Corepack (ships with Node 22); the plan runs `corepack enable pnpm` first.
- **Windows host**: pnpm + TS build are cross-platform; Docker Compose uses named volumes (no host path bind for DB data) to avoid Windows permission issues.
- **No business logic** is delivered by design (your "Health + connectivity" choice); the layering and ports are established but the domain/application layers are intentionally minimal so later sprints fill them.

### Execution order
1. Root workspace + tooling (package.json, workspace, tsconfig.base, biome, husky, gitignore).
2. Shared packages (shared-kernel → config → observability → persistence-knex → cache-redis → health → web).
3. identity-service app + Dockerfile.
4. Docker Compose stack + .env.
5. CI workflow.
6. Generator template + READMEs.
7. Verify full DoD chain (install → lint → typecheck → test → build → stack up → service up → health checks).