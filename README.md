# FleetVision — Enterprise Fleet Management Platform

> **Status:** Architecture Design Phase — Implementation Ready  
> **Version:** 1.0.0  
> **Date:** 2026-08-02  
> **Author:** Chief Software Architect

---

## Platform Overview

FleetVision is a **cloud-native, enterprise-grade Fleet Management Platform** designed to manage, monitor, and optimize vehicle fleets ranging from 100 to 2,000,000+ vehicles across multiple organizational tenants.

## Architecture at a Glance

| Aspect | Decision |
|---|---|
| **Architectural Styles** | DDD + Clean Architecture + CQRS + Event Sourcing + Microservices + Event-Driven |
| **Communication** | REST (external) + gRPC (internal sync) + Kafka (async events) + WebSocket (real-time) + MQTT (IoT) |
| **Languages** | Kotlin/Spring Boot 3.3 (core), Go (high-throughput), Python (ML/analytics) |
| **Data Layer** | PostgreSQL 16, TimescaleDB, MongoDB, Redis, ClickHouse, Elasticsearch, Kafka |
| **Platform** | Kubernetes (EKS/AKS/GKE) + Istio Service Mesh + ArgoCD (GitOps) |
| **Security** | Zero-trust: Keycloak (IAM), OPA (authz), Vault (secrets), mTLS (service mesh) |
| **Multi-Tenancy** | Hybrid: Dedicated Instance (Enterprise) + Schema Isolation (Professional) + RLS (Standard) |
| **Observability** | OpenTelemetry + Prometheus + Grafana + Loki + Jaeger |
| **14 Bounded Contexts** | Identity, Fleet Mgmt, Tracking, Telemetry, Maintenance, Driver, Fuel, Trip, Compliance, Analytics, Asset Lifecycle, Notification, Billing, Audit |

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

```
Runtime:          Java 21 + Kotlin 2.0 (Spring Boot 3.3) | Go 1.22 | Python 3.12
Frontend:         React 18 + TypeScript 5 | React Native (Mobile)
Orchestration:    Kubernetes 1.29 (EKS/AKS/GKE)
Service Mesh:     Istio 1.20 (ambient mesh)
API Gateway:      Kong Enterprise 3.x
Event Streaming:  Apache Kafka 3.7 (Confluent Platform)
Databases:        PostgreSQL 16 | TimescaleDB | MongoDB 7 | Redis 7 | ClickHouse | Elasticsearch 8
Cache/Sessions:   Redis 7 (Cluster Mode)
Object Storage:   S3 / MinIO
IAM:              Keycloak 24+
Authorization:    Open Policy Agent (OPA)
Secrets:          HashiCorp Vault
Observability:    OpenTelemetry + Prometheus + Grafana + Loki + Jaeger
CI/CD:            GitHub Actions + ArgoCD + Argo Rollouts
IaC:              Terraform + Helm + Kustomize
Container Reg:    Amazon ECR (Cosign signed)
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

## Getting Started (Sprint 1)

> Sprint 1 delivers a **runnable pnpm monorepo** realizing the architecture in
> `docs/specs/22_Codebase_Architecture.md` and ADR-021/022 (Node.js LTS + NestJS +
> TypeScript). One reference service — `identity-service` — boots end-to-end,
> proving the foundation: config → logger → health → PostgreSQL/knex migration →
> Redis, with graceful shutdown.

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

# 2. Bring up the lean stack (Postgres+Timescale, Redis, Kafka, RabbitMQ, MinIO)
cp infra/docker/.env.example infra/docker/.env   # then edit secrets
pnpm stack:up

# 3. Run the reference service (auto-loads infra/docker/.env into the process env)
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
  shared-kernel/      DDD primitives, branded ids, value objects, tenancy
  config/             zod-validated env loader (crash-fast)
  observability/      pino logger + W3C traceparent correlation
  persistence-knex/   PgBouncer-aware knex client, BaseRepository, migrations runner
  cache-redis/        ioredis client + RedisModule
  health/             @nestjs/terminus /health/live + /health/ready
  web/                JSON:API error envelope + global exception filter stub
apps/
  identity-service/   the reference service (registry #1)
infra/docker/         compose stack + .env template
```

### Done vs. planned

**Done (Sprint 1):** monorepo foundation, all 7 shared packages, the reference
service, the full Docker stack, CI, graceful shutdown, health checks.

**Planned (Sprint 2+):** business/aggregate domain code, REST CRUD verticals,
Kafka producers/consumers, gRPC, CQRS bus, event store, auth/OPA, the service
generator, ArgoCD/Istio/Helm/Terraform, Pact contract tests, front-end.
