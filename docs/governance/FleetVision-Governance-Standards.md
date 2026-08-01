# FleetVision Governance & Coding Standards

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect  

---

## 1. Architecture Governance

### 1.1 Architecture Decision Process

| Decision Type | Authority | Process | Documentation |
|---|---|---|---|
| **Strategic** (new service, new technology, major refactoring) | Architecture Review Board | RFC → Review → Approval | ADR + Design Document |
| **Tactical** (within-service design, library choice, pattern adoption) | Tech Lead + 1 reviewer | PR review with arch annotation | ADR |
| **Operational** (config changes, scaling adjustments) | Service Owner | Change request → review → deploy | Runbook update |
| **Emergency** (production incident response) | On-Call SRE → Post-incident review | Immediate action → ADR within 48h | Incident report + ADR |

### 1.2 Architecture Review Board (ARB)

| Role | Responsibility |
|---|---|
| Chief Software Architect | Final authority, vision alignment |
| Domain Experts (per context) | Domain model correctness, invariant validation |
| Platform Engineering Lead | Infrastructure feasibility, operability |
| Security Architect | Security review, threat modeling |
| Engineering Manager | Resource planning, team impact |

**Meeting Cadence:** Weekly 1-hour review session

### 1.3 ADR Process

1. **Propose:** Author creates ADR draft in `/Decisions/ADR-NNN-{title}.md`
2. **Review:** ARB reviews at weekly meeting
3. **Decide:** Accept / Reject / Defer with rationale
4. **Implement:** Development proceeds per ADR
5. **Review Period:** ADRs reviewed annually; superseded ADRs marked `Superseded`

---

## 2. Code Structure Standards

### 2.1 Clean Architecture Package Structure (Kotlin/Spring Boot)

```
src/main/kotlin/com/fleetvision/{service}/
├── domain/                          # Enterprise Business Rules (innermost)
│   ├── model/
│   │   ├── aggregates/
│   │   │   ├── VehicleAggregate.kt
│   │   │   └── FleetAggregate.kt
│   │   ├── entities/
│   │   ├── valueobjects/
│   │   │   ├── VIN.kt
│   │   │   ├── LicensePlate.kt
│   │   │   └── Money.kt
│   │   ├── enums/
│   │   │   └── VehicleStatus.kt
│   │   └── events/
│   │       ├── DomainEvent.kt
│   │       ├── VehicleRegisteredEvent.kt
│   │       └── VehicleAssignedToFleetEvent.kt
│   ├── repositories/
│   │   ├── VehicleRepository.kt (interface)
│   │   └── FleetRepository.kt (interface)
│   └── services/
│       └── FleetAssignmentService.kt (domain service)
│
├── application/                     # Application Business Rules
│   ├── commands/
│   │   ├── RegisterVehicleCommand.kt
│   │   ├── AssignVehicleToFleetCommand.kt
│   │   └── CommandHandler.kt (interface)
│   ├── queries/
│   │   ├── GetVehicleQuery.kt
│   │   ├── SearchVehiclesQuery.kt
│   │   └── QueryHandler.kt (interface)
│   ├── usecases/
│   │   ├── RegisterVehicleUseCase.kt
│   │   ├── AssignVehicleToFleetUseCase.kt
│   │   ├── GetVehicleUseCase.kt
│   │   └── SearchVehiclesUseCase.kt
│   ├── events/
│   │   └── DomainEventPublisher.kt (interface)
│   ├── ports/
│   │   ├── inbound/
│   │   │   └── VehicleCommandPort.kt
│   │   └── outbound/
│   │       ├── VehiclePersistencePort.kt
│   │       └── FleetMembershipPort.kt
│   └── dto/
│       ├── VehicleDTO.kt
│       └── FleetDTO.kt
│
├── infrastructure/                  # Interface Adapters + External
│   ├── persistence/
│   │   ├── postgres/
│   │   │   ├── PostgreSQLVehicleRepository.kt
│   │   │   ├── schema.sql
│   │   │   └── RlsContextProvider.kt
│   │   ├── redis/
│   │   │   └── RedisVehicleCacheRepository.kt
│   │   └── elasticsearch/
│   │       └── ElasticsearchVehicleSearchRepository.kt
│   ├── messaging/
│   │   ├── kafka/
│   │   │   ├── KafkaDomainEventPublisher.kt
│   │   │   ├── KafkaEventConsumer.kt
│   │   │   ├── KafkaEventErrorHandler.kt
│   │   │   └── KafkaConfiguration.kt
│   │   └── outbox/
│   │       └── OutboxEventPublisher.kt
│   ├── external/
│   │   ├── KeycloakClientAdapter.kt
│   │   ├── MapServiceAdapter.kt
│   │   └── PaymentGatewayAdapter.kt
│   └── config/
│       ├── SecurityConfiguration.kt
│       ├── KafkaConsumerConfiguration.kt
│       └── TenantContextConfiguration.kt
│
└── interfaces/                      # Interface Adapters (outermost)
    ├── web/
    │   ├── controllers/
    │   │   ├── VehicleController.kt
    │   │   └── FleetController.kt
    │   ├── requests/
    │   │   ├── RegisterVehicleRequest.kt
    │   │   └── AssignVehicleRequest.kt
    │   ├── responses/
    │   │   ├── VehicleResponse.kt
    │   │   └── ErrorResponse.kt
    │   ├── converters/
    │   │   └── VehicleDtoConverter.kt
    │   └── exceptions/
    │       ├── GlobalExceptionHandler.kt
    │       └── DomainExceptionMapper.kt
    ├── grpc/
    │   ├── FleetMembershipGrpcService.kt
    │   └── GrpcExceptionMapper.kt
    └── websocket/
        └── TrackingWebSocketHandler.kt
```

### 2.2 Test Structure

```
src/test/kotlin/com/fleetvision/{service}/
├── domain/
│   ├── model/
│   │   ├── aggregates/
│   │   │   └── VehicleAggregateTest.kt
│   │   └── valueobjects/
│   │       └── VINTest.kt
│   └── services/
│       └── FleetAssignmentServiceTest.kt
├── application/
│   ├── usecases/
│   │   ├── RegisterVehicleUseCaseTest.kt
│   │   └── GetVehicleUseCaseTest.kt
│   └── events/
│       └── DomainEventPublisherTest.kt
├── infrastructure/
│   ├── persistence/
│   │   └── PostgreSQLVehicleRepositoryTest.kt
│   ├── messaging/
│   │   └── KafkaDomainEventPublisherTest.kt
│   └── external/
│       └── KeycloakClientAdapterTest.kt
├── interfaces/
│   ├── web/
│   │   ├── controllers/
│   │   │   └── VehicleControllerTest.kt
│   │   └── converters/
│   │       └── VehicleDtoConverterTest.kt
│   └── integration/
│       ├── VehicleRegistrationIntegrationTest.kt
│       └── KafkaEventFlowIntegrationTest.kt
└── architecture/
    └── ArchitectureBoundaryTest.kt (ArchUnit)
```

---

## 3. Coding Standards

### 3.1 Kotlin Standards

| Rule | Standard |
|---|---|
| Naming | camelCase (functions, variables), PascalCase (classes, interfaces, objects) |
| Package naming | All lowercase, no underscores (e.g., `domain.model.aggregates`) |
| Nullable types | Explicit nullable (`?`); avoid `!!` operator in production code |
| Immutability | Prefer `val` over `var`; prefer immutable collections (`listOf`, `mapOf`) |
| Functions | Single expression functions preferred; max 20 lines; single responsibility |
| Classes | Single responsibility; max 200 lines; favor composition over inheritance |
| Error handling | Result type or custom exceptions; never swallow exceptions silently |
| Coroutines | Use structured concurrency; always provide dispatcher; cancel scopes |
| Extensions | Extension functions for utility behavior; domain behavior in entities |
| Logging | Use `logger.info { }` (lazy evaluation); structured fields via SLF4D MDC |
| Documentation | KDoc on all public APIs; domain invariants documented |

### 3.2 Go Standards (Telemetry Ingestion Service)

| Rule | Standard |
|---|---|
| Naming | camelCase (unexported), PascalCase (exported); abbreviations uppercase (ID, not Id) |
| Error handling | Always check errors; wrap with `fmt.Errorf("context: %w", err)` |
| Contexts | Always pass `context.Context` as first parameter; never store in struct |
| Concurrency | Prefer goroutines + channels; use `sync.WaitGroup` for coordination |
| Structs | Zero-value friendly; use constructor functions `NewX()` |
| Interfaces | Small interfaces (1-3 methods); accept interfaces, return structs |
| Testing | Table-driven tests; `t.Parallel()` for independent tests |
| Logging | Structured logging (`slog`); correlation ID in all log entries |

### 3.3 Python Standards (Analytics Engine)

| Rule | Standard |
|---|---|
| Formatting | Ruff (replaces flake8 + isort + black) |
| Type hints | Required for all function signatures (mypy strict mode) |
| Async | `asyncio` for I/O-bound; Faust for stream processing |
| Error handling | Custom exceptions; never bare `except:`; log + reraise |
| Dependencies | Poetry for dependency management; pinned versions |
| Testing | pytest + pytest-asyncio; fixtures for async contexts |

---

## 4. API Design Standards

### 4.1 REST API Conventions

| Convention | Standard |
|---|---|
| URL style | kebab-case, plural nouns: `/api/v1/vehicles`, `/api/v1/fleet-memberships` |
| Resource relations | Nested URLs for navigation: `/api/v1/vehicles/{id}/maintenance-orders` |
| Filtering | Query params: `?status=active&vehicle_type=TRUCK` |
| Sorting | `?sort=-created_at,name` (prefix `-` for desc) |
| Pagination | `?page[number]=1&page[size]=20` (JSON:API style) |
| Field selection | `?fields=vin,make,model,status` |
| Inclusion | `?include=fleet,telematics_device` (sparse fieldsets + included resources) |
| Search | `?q=honda&search=vin,make,model` |
| Bulk operations | `POST /api/v1/vehicles/bulk` (max 100 items) |
| HTTP methods | GET (read), POST (create), PUT (full replace), PATCH (partial update), DELETE |
| Status codes | 200 (OK), 201 (Created), 204 (No Content), 400 (Bad Request), 401/403, 404, 409 (Conflict), 422 (Validation), 429 (Rate Limited), 500, 503 |

### 4.2 gRPC Standards

| Convention | Standard |
|---|---|
| Service naming | PascalCase: `FleetMembershipService` |
| Method naming | PascalCase: `GetVehicleById`, `AssignVehicleToFleet` |
| Package | `com.fleetvision.{service}.v1` |
| Error mapping | gRPC status codes → HTTP status codes; custom error details |
| Deadlines | Client-side deadline propagation; server-side timeout |
| Metadata | `tenant-id`, `correlation-id`, `user-id` in gRPC metadata |
| Streaming | Server streaming for position updates; client streaming for bulk uploads |

### 4.3 Event Standards

| Convention | Standard |
|---|---|
| Naming | `{domain}.{aggregate}.{event-type}.{version}` |
| Envelope | CloudEvents v1.0 with `fleetvision` extensions |
| Serialization | Apache Avro (registered in Schema Registry) |
| Key | `aggregate_id` for ordering within aggregate |
| Headers | `tenant-id`, `correlation-id`, `causation-id` as Kafka headers |
| Idempotency | All events carry `event_id` (UUID); consumers deduplicate |

---

## 5. Git Workflow

### 5.1 Branch Strategy

| Branch | Purpose | Protection |
|---|---|---|
| `main` | Production-ready code | Require 2 approvals, CI pass, no direct push |
| `develop` | Integration branch | Require 1 approval, CI pass |
| `feature/{ticket-id}-{description}` | Feature development | CI pass before merge |
| `bugfix/{ticket-id}-{description}` | Bug fixes | CI pass before merge |
| `hotfix/{description}` | Production hotfix | Require 2 approvals, CI pass; merge to main + develop |
| `release/v{version}` | Release stabilization | No new features; only bug fixes |

### 5.2 Commit Message Convention

```
type(scope): description [ticket-id]

feat(fleet): add vehicle bulk registration API [FLEET-1234]
fix(tracking): resolve geofence evaluation race condition [TRACK-5678]
refactor(maintenance): extract parts inventory domain service [MAINT-9012]
perf(telemetry): optimize GPS position batch processing [TELEM-3456]
docs(api): update OpenAPI spec for vehicle endpoints [API-7890]
test(driver): add behavior score computation tests [DRVR-2345]
chore(deps): upgrade Spring Boot to 3.3.2 [DEPS-1111]
break(fuel): change fuel transaction event schema v1→v2 [FUEL-6666]
```

### 5.3 PR Requirements

| Requirement | Criteria |
|---|---|
| Description | Clear description of change, motivation, testing done |
| Linked tickets | At least one Jira/GitHub ticket referenced |
| Reviewers | Minimum 2 approvals (1 from domain expert if domain change) |
| CI status | All checks green (build, test, scan, lint) |
| Size limit | < 400 lines changed (excluding generated code); larger requires architecture review |
| Test coverage | New code must have tests; minimum 80% coverage |
| Documentation | Updated ADR, API spec, or runbook if applicable |

---

## 6. Documentation Standards

### 6.1 Document Types

| Document | Owner | Review Cycle | Location |
|---|---|---|---|
| Master Architecture Document | Chief Architect | Quarterly | `/Architecture/FleetVision-Master-Architecture.md` |
| Domain Model | Domain Expert | Per release | `/Domain/FleetVision-Domain-Model.md` |
| Architecture Decision Records | Author + ARB | Annual | `/Decisions/ADR-NNN-{title}.md` |
| Module Design Document | Service Owner | Per release | `/Modules/{Context-Name}.md` |
| API Specification | API Owner | Per API change | `/API/{service}-api.yaml` |
| Database Schema | DBA + Service Owner | Per migration | `/Database/{schema}.sql` |
| Security Architecture | Security Architect | Quarterly | `/Security/FleetVision-Security-Architecture.md` |
| Infrastructure Architecture | Platform Lead | Quarterly | `/Architecture/FleetVision-Infrastructure-Architecture.md` |
| Runbook | Service Owner + SRE | Per incident/process change | `/docs/runbooks/{name}.md` |
| Governance Standards | Chief Architect | Semi-annually | `/docs/governance/FleetVision-Governance-Standards.md` |

### 6.2 ADR Template

```markdown
# ADR-NNN: {Title}

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXX  
**Date:** YYYY-MM-DD  
**Deciders:** {Names}  
**Context:** {Why is this decision needed?}

## Context
{Forces, constraints, and background}

## Decision
{What was decided}

## Alternatives Considered
{What else was evaluated and why rejected}

## Consequences
{Positive and negative outcomes}

## Implementation Notes
{Technical details for implementation}

## Review History
| Date | Reviewer | Outcome |
|------|----------|---------|
| YYYY-MM-DD | Name | Approved / Changes requested |
```

---

## 7. Technology Radar

### 7.1 Adopt (Use in Production)

| Technology | Category | Context |
|---|---|---|
| Spring Boot 3.3 + Kotlin | Runtime | All Java/Kotlin microservices |
| PostgreSQL 16 + TimescaleDB | Data | OLTP + time-series |
| Apache Kafka (Confluent) | Messaging | Event backbone |
| Kubernetes + Istio | Platform | Container orchestration + service mesh |
| ArgoCD + Argo Rollouts | CI/CD | GitOps deployment |
| OpenTelemetry | Observability | Metrics, traces, logs |
| HashiCorp Vault | Security | Secrets management |
| Keycloak | IAM | Authentication + authorization |
| Grafana + Prometheus | Observability | Monitoring + alerting |

### 7.2 Trial (Evaluate for Adoption)

| Technology | Category | Trial Scope |
|---|---|---|
| Envoy Gateway | Platform | Evaluate as alternative to Istio ambient mesh |
 Temporal.io | Orchestration | Evaluate for complex saga workflows |
 Apache Flink | Streaming | Evaluate for complex event processing at scale |
 OpenFeature | Feature Flags | Evaluate as open-source alternative to LaunchDarkly |
 Rust | Runtime | Evaluate for next-gen telemetry ingestion |

### 7.3 Assess (Research)

| Technology | Category | Interest |
|---|---|---|
 wasmCloud | Platform | WebAssembly-based microservices |
 Apache Pulsar | Messaging | Alternative to Kafka for geo-distributed use cases |
 gRPC-Web | API | Alternative to REST for BFF communication |
 eBPF (Cilium) | Security | Kernel-level networking and security |

---

## 8. Dependency Management

### 8.1 Shared Library Strategy

| Library | Purpose | Versioning |
|---|---|---|
| `fleetvision-common` | Shared value objects (TenantId, Money, GeoCoordinate) | Semantic versioning |
| `fleetvision-events` | Domain event definitions (Avro schemas, Kotlin classes) | Schema registry version aligned |
| `fleetvision-security` | Security utilities (tenant context, auth helpers) | Semantic versioning |
| `fleetvision-test` | Test utilities (Testcontainers, fixtures, mocks) | Semantic versioning |

**Rule:** Shared libraries are limited to infrastructure/technical concerns. Domain logic is NEVER shared across bounded contexts.

### 8.2 Dependency Version Policy

| Dependency Type | Update Policy | Tool |
|---|---|---|
| Framework (Spring Boot) | Minor version updates monthly; major version per quarter | Dependabot |
| Libraries (Jackson, etc.) | Patch version auto; minor version monthly | Renovate |
| Security vulnerabilities | Immediate update (critical); within 24h (high) | Snyk auto-PR |
| Internal libraries | PR-based with changelog | Manual |
