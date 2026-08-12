# FleetVision — Enterprise Fleet Management Platform

> **Status:** Implementation in progress — post-stabilization hardening. See
> **Implementation Status** below for what is actually built today versus what
> remains planned. The aspirational sections further down describe the target
> architecture and are marked PLANNED where the code does not yet exist.
> **Version:** 1.0.0
> **Date:** 2026-08-02
> **Author:** Chief Software Architect

---

## Implementation Status (what actually runs today)

This table is the authoritative, honest picture of the repository. Anything not
listed here is **PLANNED** (not built). The aspirational sections below
("Architecture at a Glance", "Technology Stack", the ADRs) describe the target
state and were written during the design phase; where they name a technology
that is not yet implemented, treat it as PLANNED, not as a current capability.

Legend: **IMPLEMENTED** runs in code today · **PARTIAL** exists but incomplete · **PLANNED** not in the codebase.

| Area | Status | Notes |
|---|---|---|
| Runtime / languages | IMPLEMENTED | **Node.js LTS + NestJS + TypeScript** (per ADR-021). *Not* Kotlin/Go/Python — that stack in the section below is the deferred design-phase target. |
| Monorepo foundation | IMPLEMENTED | pnpm workspaces, composite TS project graph, Biome, Husky, CI. 8 services + 8 shared packages. |
| Services (NestJS) | IMPLEMENTED | identity, fleet, gps-engine, device-gateway, map-engine, media, notification, web-dashboard (React). |
| Shared packages | IMPLEMENTED | shared-kernel, config, observability, persistence-knex, cache-redis, health, web, auth. |
| Database | IMPLEMENTED | PostgreSQL 16 + TimescaleDB + Redis 7. Knex migrations, RLS-enforced. |
| Async messaging | IMPLEMENTED | Apache Kafka 3.7 (kafkajs producer/consumer). |
| Realtime | IMPLEMENTED | WebSocket / Socket.IO (gps-engine realtime gateway, alarm + notification rooms). |
| AuthN/AuthZ | PARTIAL | HS256 JWT (`@nestjs/jwt`) + argon2 + `PermissionsGuard` (RBAC). **Keycloak PLANNED. OPA PLANNED** (in-process permission evaluator is the fallback until OPA lands). |
| Secrets | PARTIAL | Config via env + zod. **Vault PLANNED** (HS256→RS256/JWKS via Vault Transit deferred). |
| Multi-tenancy | IMPLEMENTED | Single shared Postgres with **tenant-aware RLS** (`SET LOCAL app.current_tenant_id`, `fleetvision_app` NOBYPASSRLS role, FORCE RLS). |
| Audit | PARTIAL | Hash-chained audit log (SHA-256), wired to most sensitive ops; a few ops still pending (see audit phase notes). |
| REST APIs | IMPLEMENTED | Versioned REST (`/api/v1/...`); cursor pagination contract on list endpoints. |
| Frontend | PARTIAL | React 18 + TS dashboard; mock-gate (real-first) with honest DEMO/PLANNED labels. Some pages mock-only (no backend yet). |
| gRPC | **PLANNED** | Inter-service comms today are Kafka + in-process. No `.proto`/`@grpc/grpc-js` in the tree. |
| Service mesh (Istio) | **PLANNED** | No manifests. |
| API gateway (Kong) | **PLANNED** | No Kong service/config. |
| GitOps (ArgoCD) | **PLANNED** | CI is GitHub Actions only. |
| Kubernetes | **PLANNED** | Local dev is `docker compose`. No Helm/Kustomize/manifests. |
| MongoDB | **PLANNED (removed)** | Removed per ADR-022 → PostgreSQL JSONB. |
| ClickHouse | **PLANNED (deferred)** | Deferred per ADR-022 with a re-introduction trigger. |
| Elasticsearch | **PLANNED (deferred)** | Deferred per ADR-022 (Postgres FTS + Loki instead). |
| Mobile (React Native) | **PLANNED** | No mobile app in this repo. |

> The docker-compose dev stack is intentionally lean: `postgres`, `redis`,
> `zookeeper`, `kafka`, `identity-service`, `web-dashboard`. No Kong / Keycloak /
> Vault / Istio / ArgoCD / ClickHouse / Mongo / Elasticsearch services are
> defined — those are future infrastructure.

---

## Platform Overview

FleetVision is a **cloud-native, enterprise-grade Fleet Management Platform** designed to manage, monitor, and optimize vehicle fleets ranging from 100 to 2,000,000+ vehicles across multiple organizational tenants.

## Architecture at a Glance

> **Note:** the table below is the **target architecture** from the design phase.
> Rows marked **PLANNED** are not implemented today — see *Implementation Status*
> above for the current reality. The implemented runtime is Node.js + NestJS +
> TypeScript on PostgreSQL/TimescaleDB/Redis/Kafka with JWT RBAC and tenant-aware RLS.

| Aspect | Decision | Implemented? |
|---|---|---|
| **Architectural Styles** | DDD + Clean Architecture + Microservices + Event-Driven. (CQRS + Event Sourcing are PARTIAL/PLANNED for audit-critical aggregates.) | Partial |
| **Communication** | REST (external) + Kafka (async events) + WebSocket (real-time). **gRPC (internal sync) PLANNED.** MQTT (IoT) PLANNED. | Partial |
| **Languages (target)** | Design target: Kotlin/Spring Boot, Go, Python. **Implemented runtime: Node.js LTS + NestJS + TypeScript (ADR-021).** | Implemented (Node) — Kotlin/Go/Python PLANNED |
| **Data Layer** | **Implemented: PostgreSQL 16, TimescaleDB, Redis, Kafka.** MongoDB (removed → JSONB), ClickHouse (deferred), Elasticsearch (deferred) — all PLANNED. | Partial |
| **Platform** | Design target: Kubernetes + Istio + ArgoCD. **Today: `docker compose` for local dev.** All PLANNED. | Planned |
| **Security** | **Implemented: HS256 JWT + argon2 + RBAC PermissionsGuard + tenant-aware RLS.** Keycloak (IAM) PLANNED · OPA (authz) PLANNED · Vault (secrets) PLANNED · mTLS (mesh) PLANNED. | Partial |
| **Multi-Tenancy** | Implemented as single shared Postgres + tenant-aware **RLS** (`SET LOCAL app.current_tenant_id`, FORCE RLS, NOBYPASSRLS app role). Dedicated-instance/schema-isolation tiers PLANNED. | Partial |
| **Observability** | Implemented: pino logger + W3C traceparent correlation + health checks. OTel/Prometheus/Grafana/Loki/Jaeger dashboards PLANNED. | Partial |
| **14 Bounded Contexts** | Identity, Fleet Mgmt, Tracking, Telemetry, Maintenance, Driver, Fuel, Trip, Compliance, Analytics, Asset Lifecycle, Notification, Billing, Audit. (Code covers Identity, Fleet, Tracking/Telemetry, Map, Media, Notification, Audit; others PLANNED.) | Partial |

## Scale Targets

| Metric | Year 1 | Year 3 | Year 5 |
|---|---|---|---|
| Vehicles | 50,000 | 500,000 | 2,000,000 |
| GPS Events/sec | 15,000 | 150,000 | 600,000 |
| API Requests/sec | 5,000 | 50,000 | 200,000 |
| Enterprise Tenants | 50 | 500 | 2,000 |
| Platform Availability | 99.95% | 99.95% | 99.99% |
| RPO / RTO | < 1 min / < 15 min | < 1 min / < 10 min | < 30 sec / < 5 min |

---

## Documentation Index

### 🏗 Architecture

| Document | Path | Description |
|---|---|---|
| **Master Architecture Document** | `docs/architecture/FleetVision-Master-Architecture.md` | Single source of truth — system overview, principles, patterns, context map |
| **Infrastructure Architecture** | `docs/architecture/FleetVision-Infrastructure-Architecture.md` | Kubernetes topology, networking, environments, cost, DR |
| **Event-Driven Architecture** | `docs/architecture/FleetVision-Event-Driven-Architecture.md` | Kafka topology, event catalog, saga patterns, schema evolution |
| **C4 Diagrams** | `docs/diagrams/FleetVision-C4-Diagrams.md` | System context, container, component, sequence, deployment diagrams |

### 🎯 Domain Model

| Document | Path | Description |
|---|---|---|
| **Domain Model Specification** | `docs/architecture/FleetVision-Domain-Model.md` | Ubiquitous language, 14 bounded contexts, 44 aggregates, domain events, context mapping |

### 🧩 Modules (Bounded Contexts)

| Module | Path |
|---|---|
| Identity & Access Management | `docs/modules/Identity-Access-Management.md` |
| Fleet Management | `docs/modules/Fleet-Management.md` |
| Tracking & Monitoring | `docs/modules/Tracking-Monitoring.md` |
| Telematics & Device Management | `docs/modules/Telemetry-Device-Management.md` |
| Vehicle Maintenance | `docs/modules/Vehicle-Maintenance.md` |
| Driver Management | `docs/modules/Driver-Management.md` |
| Trip & Route Management | `docs/modules/Trip-Route-Management.md` |
| Compliance & Safety | `docs/modules/Compliance-Safety.md` |
| Fuel Management | `docs/modules/Fuel-Management.md` |
| Analytics & Reporting | `docs/modules/Analytics-Reporting.md` |
| Asset Lifecycle | `docs/modules/Asset-Lifecycle.md` |
| Notification & Alerting | `docs/modules/Notification-Alerting.md` |
| Billing & Tenant Management | `docs/modules/Billing-Tenant-Management.md` |
| Audit & Compliance Log | `docs/modules/Audit-Compliance-Log.md` |

### 📐 Architecture Decisions

| ADR | Path | Decision |
|---|---|---|
| ADR-001 | `docs/adr/ADR-001-CQRS-Event-Sourcing.md` | CQRS + Event Sourcing for critical aggregates |
| ADR-002 | `docs/adr/ADR-002-Apache-Kafka.md` (in ADR-001 file) | Apache Kafka as central event backbone |
| ADR-003 | `docs/adr/ADR-003-Multi-Tenancy.md` (in ADR-001 file) | Hybrid multi-tenancy (3 isolation tiers) |
| ADR-004 | `docs/adr/ADR-004-Service-Communication.md` (in ADR-001 file) | gRPC (sync) + Kafka (async) dual model |
| ADR-005 | `docs/adr/ADR-005-Istio-Service-Mesh.md` (in ADR-001 file) | Istio 1.20+ ambient mesh |
| ADR-006 | `docs/adr/ADR-006-Spring-Boot-Kotlin.md` (in ADR-001 file) | Spring Boot 3.3 + Kotlin 2.0 (Go + Python exceptions) |
| ADR-007 | `docs/adr/ADR-007-PostgreSQL.md` (in ADR-001 file) | PostgreSQL 16 as primary OLTP database |
| ADR-008 | `docs/adr/ADR-008-Polyglot-Persistence.md` (in ADR-001 file) | Polyglot persistence (8 data stores) |
| ADR-009 | `docs/adr/ADR-009-Keycloak-IAM.md` (in ADR-001 file) | Keycloak 24+ for IAM |
| ADR-010 | `docs/adr/ADR-010-GitOps-ArgoCD.md` (in ADR-001 file) | GitOps with ArgoCD |
| ADR-011 | `docs/adr/ADR-011-OpenTelemetry.md` (in ADR-001 file) | OpenTelemetry for observability |
| ADR-012 | `docs/adr/ADR-012-API-Versioning.md` (in ADR-001 file) | URI-based API versioning with sunset policy |

### 🔌 API

| Document | Path | Description |
|---|---|---|
| **API Gateway Architecture** | `docs/api-specs/FleetVision-API-Gateway-Architecture.md` | Routing, auth, rate limiting, WebSocket, MQTT gateway |
| **OpenAPI v1 Specification** | `docs/api-specs/FleetVision-OpenAPI-v1.yaml` | Full REST API specification (vehicles, tracking, trips, maintenance, compliance) |

### 🗄 Database

| Document | Path | Description |
|---|---|---|
| **Database Architecture** | `docs/architecture/FleetVision-Database-Architecture.md` | Polyglot persistence, schema design, CQRS write/read paths, backups |

### 🔒 Security

| Document | Path | Description |
|---|---|---|
| **Security Architecture & Threat Model** | `docs/security/FleetVision-Security-Architecture.md` | Zero-trust model, STRIDE threat analysis, auth flows, encryption, compliance |

### 📖 Runbooks

| Document | Path | Description |
|---|---|---|
| **CI/CD Pipeline** | `docs/runbooks/ci-cd-pipeline.md` | GitHub Actions + ArgoCD pipeline, canary rollout, rollback procedures |
| **Monitoring & Observability** | `docs/runbooks/monitoring-observability.md` | SLI/SLO framework, dashboards, alerting rules, chaos engineering |

### 📋 Governance

| Document | Path | Description |
|---|---|---|
| **Governance & Coding Standards** | `docs/governance/FleetVision-Governance-Standards.md` | ARB process, code structure, API standards, git workflow, tech radar |

---

## Technology Stack

> **What runs today** (IMPLEMENTED) versus the **design-phase target**
> (PLANNED). Only the rows marked IMPLEMENTED are present in the codebase /
> docker-compose; the rest are future work tracked in the ADRs.

```
IMPLEMENTED (today):
  Runtime:          Node.js 22 LTS + NestJS + TypeScript 5.6
  Frontend:         React 18 + TypeScript 5 (web-dashboard)
  Databases:        PostgreSQL 16 + TimescaleDB · Redis 7
  Event Streaming:  Apache Kafka 3.7 (kafkajs)
  Realtime:         WebSocket / Socket.IO
  AuthN/AuthZ:      HS256 JWT (@nestjs/jwt) + argon2 + RBAC PermissionsGuard
  Multi-Tenancy:    PostgreSQL tenant-aware RLS (FORCE, NOBYPASSRLS app role)
  Migrations:       Knex
  Lint/Format:      Biome
  CI:               GitHub Actions
  Local Infra:      docker compose (postgres, redis, zookeeper, kafka)

PLANNED (target state — not yet in the codebase):
  Runtime (target):   Kotlin/Spring Boot 3.3 | Go 1.22 | Python 3.12     (ADR-006, deferred)
  Mobile:             React Native                                          (no mobile app yet)
  Orchestration:      Kubernetes 1.29 (EKS/AKS/GKE)                        (no manifests)
  Service Mesh:       Istio 1.20 (ambient mesh)                            (ADR-005)
  API Gateway:        Kong Enterprise 3.x                                   (no config)
  IAM:                Keycloak 24+                                          (ADR-009)
  Authorization:      Open Policy Agent (OPA)                               (ADR-009; in-process evaluator today)
  Secrets:            HashiCorp Vault                                       (RS256/JWKS via Vault Transit deferred)
  CI/CD (target):     + ArgoCD + Argo Rollouts                              (ADR-010)
  IaC:                Terraform + Helm + Kustomize
  Container Reg:      Amazon ECR (Cosign signed)

PLANNED (data stores — removed or deferred per ADR-022):
  MongoDB:            REMOVED → PostgreSQL JSONB
  ClickHouse:         DEFERRED (re-introduction trigger documented in ADR-022)
  Elasticsearch:      DEFERRED (Postgres FTS + Loki instead)

Observability (PARTIAL):
  Implemented:        pino logger + W3C traceparent correlation + terminus health
  Planned:            OpenTelemetry + Prometheus + Grafana + Loki + Jaeger
```

---

## Project Structure

```
FleetVision/
├── README.md                          ← You are here
├── docs/                              # All documentation (single location)
│   ├── architecture/                  # Architecture + domain + database docs
│   │   ├── FleetVision-Master-Architecture.md
│   │   ├── FleetVision-Infrastructure-Architecture.md
│   │   ├── FleetVision-Event-Driven-Architecture.md
│   │   ├── FleetVision-Domain-Model.md
│   │   └── FleetVision-Database-Architecture.md
│   ├── specs/                         # Numbered & named design specs (vision, master, domain, DB, engines, API/SDK, TDR, codebase)
│   ├── modules/                       # Bounded-context module specs (24)
│   ├── adr/                           # Architecture Decision Records (4 implemented)
│   │   ├── ADR-001-CQRS-Event-Sourcing.md
│   │   ├── ADR-019-Architecture-Consistency-Reconciliation.md
│   │   ├── ADR-021-Node-NestJS-Runtime.md
│   │   └── ADR-022-Lean-Persistence.md
│   ├── api-specs/                     # API specifications & gateway design
│   │   ├── FleetVision-API-Gateway-Architecture.md
│   │   └── FleetVision-OpenAPI-v1.yaml
│   ├── diagrams/                      # C4 & deployment diagrams
│   │   └── FleetVision-C4-Diagrams.md
│   ├── security/                      # Security architecture & threat model
│   │   └── FleetVision-Security-Architecture.md
│   ├── governance/
│   │   └── FleetVision-Governance-Standards.md
│   └── runbooks/
│       ├── ci-cd-pipeline.md
│       └── monitoring-observability.md
├── apps/                              # Deployable services (NestJS apps)
├── packages/                          # Shared workspace packages (shared-kernel, config, ...)
├── tools/                             # Generators & dev tooling
└── infra/                             # Docker compose stack + env templates
```

---

## Migration Strategy

| Phase | Timeline | Scope | Milestone |
|---|---|---|---|
| **Phase 0: Foundation** | Months 1-3 | Platform infra, CI/CD, service scaffolding | All services deployable |
| **Phase 1: Core MVP** | Months 4-6 | Identity, Fleet Mgmt, Tracking, Telemetry | 100 vehicles tracked |
| **Phase 2: Operations** | Months 7-9 | Driver Mgmt, Trip & Route, Maintenance | Full fleet operations |
| **Phase 3: Compliance** | Months 10-12 | Compliance (ELD), Fuel Mgmt, Billing | Regulatory compliance |
| **Phase 4: Intelligence** | Months 13-15 | Analytics, ML Predictions, Reporting | Predictive maintenance |
| **Phase 5: Scale** | Months 16-18 | Multi-region, HA, 100K+ vehicles | Platform scaled to target |
| **Phase 6: Ecosystem** | Months 19-24 | Marketplace, API platform, SDK | Self-service onboarding |

---

## Key Design Decisions Summary

1. **DDD + Clean Architecture** — Domain isolation, testability, maintainability
2. **CQRS + Event Sourcing** — For audit-critical aggregates (HOS, Trips, Work Orders, Positions)
3. **Event-Driven (Kafka)** — All cross-service communication via domain events
4. **Hybrid Multi-Tenancy** — Three tiers matching customer needs and budget
5. **Zero-Trust Security** — mTLS, OPA, Vault, defense-in-depth
6. **GitOps (ArgoCD)** — Declarative, auditable, automated deployments
7. **Polyglot Persistence** — Right data store for each access pattern
8. **Cloud-Native (Kubernetes)** — Portable, scalable, self-healing infrastructure

---

*This architecture is designed as a multi-year software product. All documents are implementation-ready and cross-referenced for consistency.*

---

## Getting Started

> The workspace is a runnable pnpm monorepo realizing the architecture in
> `docs/specs/22_Codebase_Architecture.md` and ADR-021/022 (Node.js LTS + NestJS
> + TypeScript). Eight services boot end-to-end (identity, fleet, gps-engine,
> device-gateway, map-engine, media, notification) plus the web-dashboard,
> sharing Postgres/TimescaleDB, Redis, and Kafka.

### Prerequisites

- **Node 22 LTS** (`.nvmrc`)
- **Docker Desktop** (for the local infra stack)
- **pnpm** — enabled via Node's bundled Corepack (no global install):
  ```bash
  corepack enable && corepack prepare pnpm@9.15.0 --activate
  ```

### Bootstrap

```bash
# 1. Install dependencies (one deterministic lockfile)
pnpm install

# 2. Bring up the lean stack (Postgres+Timescale, Redis, Kafka)
cp infra/docker/.env.example infra/docker/.env   # then edit secrets
pnpm stack:up

# 3. Run a service (each auto-loads infra/docker/.env into the process env)
pnpm dev          # boots identity-service on :3000

# 4. Verify the foundation
curl http://localhost:3000/health/live   # 200 — process is up
curl http://localhost:3000/health/ready  # 200 + postgres/redis indicators up
```

### Quality gates

```bash
pnpm lint        # Biome check
pnpm typecheck   # tsc -b (composite project graph) + per-package --noEmit
pnpm build       # tsc -b builds every package + the app
pnpm test        # jest across the workspace
```

### What's in the workspace

```
packages/
  shared-kernel/      DDD primitives, branded ids, value objects, tenancy, pagination
  config/             zod-validated env loader (crash-fast)
  observability/      pino logger + W3C traceparent correlation
  persistence-knex/   PgBouncer-aware knex client, BaseRepository, tenant-context (SET LOCAL), migrations runner
  cache-redis/        ioredis client + RedisModule
  health/             @nestjs/terminus /health/live + /health/ready
  web/                JSON:API error envelope + global exception filter
  auth/               shared JWT verification, JwtAuthGuard, Principal, PermissionsGuard, ZodValidationPipe
apps/
  identity-service/   auth (login/refresh/logout), IAM users/roles/api-keys, tenant provisioning, audit log
  fleet-service/      drivers + business-trips
  gps-engine-service/ position pipeline, device status, trips, engine-hours, realtime WS gateway
  device-gateway-service/ JT808/etc. device protocol adapters, Kafka producer, admin hot-reload
  map-engine-service/ geofences, POI, route, replay, map tiles/heat
  media-service/      video channels, stream sessions, JT1078/RTSP adapters, signaling WS
  notification-service/ alarm rules/evaluator, notifications + preferences + delivery channels
  web-dashboard/      React 18 + TS dashboard (mock-gated, real-first)
infra/docker/         compose stack + .env template
```

### Done vs. planned

> The list below supersedes the Sprint-1 scope notes above and reflects the
> current repository state after the stabilization hardening pass.

**Done:** monorepo foundation; all 8 shared packages; 8 NestJS services
(identity, fleet, gps-engine, device-gateway, map-engine, media, notification)
plus the React web-dashboard; Knex migrations with tenant-aware RLS; Kafka
producer/consumer wiring; WebSocket realtime; JWT auth + RBAC; hash-chained
audit log; cursor pagination; Biome lint/format; CI; quality gates
(build/typecheck/lint/test) all green; unit + opt-in RLS integration tests.

**Planned:** Keycloak (IAM), OPA (authz — in-process evaluator is the
interim), Vault (secrets / RS256-JWKS), gRPC, CQRS bus, event store, the
service generator, ArgoCD/Istio/Helm/Terraform/Kubernetes manifests, Pact
contract tests, ClickHouse/Elasticsearch re-introduction (ADR-022 triggers),
React Native mobile, dedicated-instance/schema multi-tenancy tiers.

> **Rule of thumb for this repo:** if a technology is named in the design-phase
> sections (Architecture at a Glance, Technology Stack, ADRs) but is **not** in
> the *Implementation Status* table at the top, it is **PLANNED**, not a current
> capability.
