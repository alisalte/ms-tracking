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
| **Master Architecture Document** | `Architecture/FleetVision-Master-Architecture.md` | Single source of truth — system overview, principles, patterns, context map |
| **Infrastructure Architecture** | `Architecture/FleetVision-Infrastructure-Architecture.md` | Kubernetes topology, networking, environments, cost, DR |
| **Event-Driven Architecture** | `Architecture/FleetVision-Event-Driven-Architecture.md` | Kafka topology, event catalog, saga patterns, schema evolution |
| **C4 Diagrams** | `Diagrams/FleetVision-C4-Diagrams.md` | System context, container, component, sequence, deployment diagrams |

### 🎯 Domain Model

| Document | Path | Description |
|---|---|---|
| **Domain Model Specification** | `Domain/FleetVision-Domain-Model.md` | Ubiquitous language, 14 bounded contexts, 44 aggregates, domain events, context mapping |

### 🧩 Modules (Bounded Contexts)

| Module | Path |
|---|---|
| Identity & Access Management | `Modules/Identity-Access-Management.md` |
| Fleet Management | `Modules/Fleet-Management.md` |
| Tracking & Monitoring | `Modules/Tracking-Monitoring.md` |
| Telematics & Device Management | `Modules/Telemetry-Device-Management.md` |
| Vehicle Maintenance | `Modules/Vehicle-Maintenance.md` |
| Driver Management | `Modules/Driver-Management.md` |
| Trip & Route Management | `Modules/Trip-Route-Management.md` |
| Compliance & Safety | `Modules/Compliance-Safety.md` |
| Fuel Management | `Modules/Fuel-Management.md` |
| Analytics & Reporting | `Modules/Analytics-Reporting.md` |
| Asset Lifecycle | `Modules/Asset-Lifecycle.md` |
| Notification & Alerting | `Modules/Notification-Alerting.md` |
| Billing & Tenant Management | `Modules/Billing-Tenant-Management.md` |
| Audit & Compliance Log | `Modules/Audit-Compliance-Log.md` |

### 📐 Architecture Decisions

| ADR | Path | Decision |
|---|---|---|
| ADR-001 | `Decisions/ADR-001-CQRS-Event-Sourcing.md` | CQRS + Event Sourcing for critical aggregates |
| ADR-002 | `Decisions/ADR-002-Apache-Kafka.md` (in ADR-001 file) | Apache Kafka as central event backbone |
| ADR-003 | `Decisions/ADR-003-Multi-Tenancy.md` (in ADR-001 file) | Hybrid multi-tenancy (3 isolation tiers) |
| ADR-004 | `Decisions/ADR-004-Service-Communication.md` (in ADR-001 file) | gRPC (sync) + Kafka (async) dual model |
| ADR-005 | `Decisions/ADR-005-Istio-Service-Mesh.md` (in ADR-001 file) | Istio 1.20+ ambient mesh |
| ADR-006 | `Decisions/ADR-006-Spring-Boot-Kotlin.md` (in ADR-001 file) | Spring Boot 3.3 + Kotlin 2.0 (Go + Python exceptions) |
| ADR-007 | `Decisions/ADR-007-PostgreSQL.md` (in ADR-001 file) | PostgreSQL 16 as primary OLTP database |
| ADR-008 | `Decisions/ADR-008-Polyglot-Persistence.md` (in ADR-001 file) | Polyglot persistence (8 data stores) |
| ADR-009 | `Decisions/ADR-009-Keycloak-IAM.md` (in ADR-001 file) | Keycloak 24+ for IAM |
| ADR-010 | `Decisions/ADR-010-GitOps-ArgoCD.md` (in ADR-001 file) | GitOps with ArgoCD |
| ADR-011 | `Decisions/ADR-011-OpenTelemetry.md` (in ADR-001 file) | OpenTelemetry for observability |
| ADR-012 | `Decisions/ADR-012-API-Versioning.md` (in ADR-001 file) | URI-based API versioning with sunset policy |

### 🔌 API

| Document | Path | Description |
|---|---|---|
| **API Gateway Architecture** | `API/FleetVision-API-Gateway-Architecture.md` | Routing, auth, rate limiting, WebSocket, MQTT gateway |
| **OpenAPI v1 Specification** | `API/FleetVision-OpenAPI-v1.yaml` | Full REST API specification (vehicles, tracking, trips, maintenance, compliance) |

### 🗄 Database

| Document | Path | Description |
|---|---|---|
| **Database Architecture** | `Database/FleetVision-Database-Architecture.md` | Polyglot persistence, schema design, CQRS write/read paths, backups |

### 🔒 Security

| Document | Path | Description |
|---|---|---|
| **Security Architecture & Threat Model** | `Security/FleetVision-Security-Architecture.md` | Zero-trust model, STRIDE threat analysis, auth flows, encryption, compliance |

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
├── Architecture/                      # Architecture documents
│   ├── FleetVision-Master-Architecture.md
│   ├── FleetVision-Infrastructure-Architecture.md
│   └── FleetVision-Event-Driven-Architecture.md
├── Domain/                            # Domain model & ubiquitous language
│   └── FleetVision-Domain-Model.md
├── Modules/                           # Bounded context specifications (14)
│   ├── Identity-Access-Management.md
│   ├── Fleet-Management.md
│   ├── Tracking-Monitoring.md
│   ├── Telemetry-Device-Management.md
│   ├── Vehicle-Maintenance.md
│   ├── Driver-Management.md
│   ├── Trip-Route-Management.md
│   ├── Compliance-Safety.md
│   ├── Fuel-Management.md
│   ├── Analytics-Reporting.md
│   ├── Asset-Lifecycle.md
│   ├── Notification-Alerting.md
│   ├── Billing-Tenant-Management.md
│   └── Audit-Compliance-Log.md
├── Decisions/                         # Architecture Decision Records (12 ADRs)
│   └── ADR-001-CQRS-Event-Sourcing.md
├── API/                               # API specifications & gateway design
│   ├── FleetVision-API-Gateway-Architecture.md
│   └── FleetVision-OpenAPI-v1.yaml
├── Database/                          # Database architecture & schemas
│   └── FleetVision-Database-Architecture.md
├── Security/                          # Security architecture & threat model
│   └── FleetVision-Security-Architecture.md
├── Diagrams/                          # C4 & deployment diagrams
│   └── FleetVision-C4-Diagrams.md
├── Documents/                         # Additional documentation
├── docs/
│   ├── adr/                           # Additional ADR storage
│   ├── api-specs/                     # Additional API specifications
│   ├── architecture/                  # Supplementary architecture docs
│   ├── diagrams/                      # Supplementary diagrams
│   ├── governance/
│   │   └── FleetVision-Governance-Standards.md
│   ├── runbooks/
│   │   ├── ci-cd-pipeline.md
│   │   └── monitoring-observability.md
│   └── security/                      # Supplementary security docs
└── infrastructure/                    # (future) Terraform, Helm, Kustomize
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
