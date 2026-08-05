# Architecture Decision Records

## ADR-001: Adopt CQRS with Event Sourcing for Critical Aggregates

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect, Domain Experts  
**Context:** All bounded contexts with audit-critical or high-throughput requirements.

### Context

FleetVision manages critical operational and compliance data where:
- Audit trails are regulatory requirements (FMCSA ELD compliance)
- Historical state replay is needed for analytics
- Write and read patterns differ significantly in throughput
- Event-driven communication between bounded contexts is essential

### Decision

Adopt **CQRS (Command Query Responsibility Segregation)** combined with **Event Sourcing** for critical aggregates, while using traditional CRUD for simpler contexts.

**Event-Sourced Aggregates (require audit trail, complex state):**
- `VehicleTracker` (Tracking) — full position history, regulatory
- `Trip` (Trip & Route Mgmt) — complete trip lifecycle, billing
- `MaintenanceWorkOrder` (Maintenance) — cost tracking, liability
- `HOSLog` (Compliance & Safety) — FMCSA-mandated tamper-proof logging
- `DVIRInspection` (Compliance & Safety) — regulatory requirement
- `Incident` (Compliance & Safety) — legal liability
- `Dispatch` (Trip & Route Mgmt) — operational audit
- `Invoice` (Billing) — financial audit
- `DeviceCommand` (Telematics) — OTA command history

**Traditional CRUD Aggregates (simple state, no audit requirement):**
- `Vehicle`, `Fleet`, `VehicleGroup`, `FleetPolicy` (Fleet Mgmt)
- `DriverProfile`, `LicenseRecord` (Driver Mgmt)
- `FuelCard`, `FuelStation` (Fuel Mgmt)
- `Geofence` (Tracking)
- `Vendor`, `PartsInventory`, `MaintenancePlan` (Maintenance)

### Consequences

**Positive:**
- Complete audit trail for compliance-critical data
- Ability to replay events for analytics, debugging, and disaster recovery
- Optimal read/write model separation — read models optimized for queries
- Natural event publication mechanism for cross-context communication
- Temporal queries supported natively (point-in-time state reconstruction)

**Negative:**
- Increased complexity — event schema versioning, upcasting, snapshot management
- Eventual consistency on read models (acceptable for most use cases)
- Learning curve for development teams
- Storage overhead for event store (mitigated by snapshots + compaction)

### Implementation Notes

- Event store: PostgreSQL with `pg_event_sourcing` extension or custom event store table
- Snapshots: Every 100 events, aggregate state serialized to snapshot table
- Read model projections: Materialized views in ClickHouse (analytics) or PostgreSQL (operational)
- Event schema: Apache Avro, registered in Confluent Schema Registry
- Event versioning: New event types for breaking changes; upcasters for backward compatibility
- Idempotent consumers: Use `fleetvision.causation_id` + `fleetvision.aggregate_id` for deduplication

---

## ADR-002: Apache Kafka as the Central Event Backbone

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect, Platform Engineering Lead

### Context

FleetVision requires a high-throughput, durable, ordered event streaming platform capable of:
- Ingesting 600K GPS events/second at peak
- Supporting 15+ microservice producers and consumers
- Maintaining event ordering per vehicle
- Providing replay capability for new consumers
- Multi-AZ durability with RPO < 1 minute

### Decision

Adopt **Apache Kafka (Confluent Platform)** as the central event backbone for all inter-service communication, event sourcing, and telemetry data streaming.

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| RabbitMQ | Lower throughput ceiling; no native event replay; message ordering per queue only |
| AWS Kinesis | Vendor lock-in; limited consumer group features; higher cost at scale |
| Apache Pulsar | Less mature ecosystem; smaller community; fewer integrations |
| NATS JetStream | Less proven at our target scale; smaller enterprise adoption |

### Consequences

**Positive:**
- Proven at scale (millions of events/sec in production deployments)
- Native event replay via consumer offset management
- Exactly-once semantics with transactional API
- Rich ecosystem: Kafka Connect, Kafka Streams, ksqlDB
- Schema evolution via Confluent Schema Registry

**Negative:**
- Operational complexity (cluster management, partition rebalancing)
- Requires dedicated expertise on the platform team
- Cross-datacenter replication adds complexity

### Implementation Notes

- Topics: `{domain}.{aggregate}.{event-type}.v{version}` naming convention
- Partitions: Keyed by `vehicle_id` for ordering; partition count = (throughput / partition_capacity) with 2x headroom
- Replication factor: 3 (multi-AZ)
- Retention: 7 days in-cluster; Kafka Connect S3 sink for long-term archival
- Consumer groups: One per service; multiple stream processors for analytics
- Monitoring: Consumer lag alerts via Prometheus; partition under-replication alerts
- Schema Registry: All events in Avro; backward/forward compatibility mode

---

## ADR-003: Multi-Tenancy Strategy — Hybrid Isolation

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect, Security Architect

### Context

FleetVision serves tenants ranging from small fleets (10 vehicles) to enterprise customers (10,000+ vehicles) with varying:
- Data isolation requirements (regulatory, contractual)
- Performance expectations
- Customization needs
- Compliance obligations (data residency, GDPR, HIPAA)

### Decision

Adopt a **hybrid multi-tenancy strategy** with three isolation tiers, matching tenant tier to isolation level:

| Tenant Tier | Vehicle Count | Isolation Model | Database |
|---|---|---|---|
| **Enterprise** | 1,000+ | Dedicated Instance | Dedicated PostgreSQL + TimescaleDB + Redis per tenant |
| **Professional** | 100–1,000 | Schema Isolation | Shared PostgreSQL instance; dedicated schema + RLS per tenant |
| **Standard** | < 100 | Row-Level Security | Shared database; `tenant_id` column + PostgreSQL RLS |

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Database-per-tenant (all tiers) | Prohibitive cost at scale; thousands of databases unmanageable |
| Shared database (all tiers) | Insufficient isolation for enterprise/regulatory requirements |
| Container-per-tenant | Over-provisioning; poor resource utilization for small tenants |

### Consequences

**Positive:**
- Right-sized isolation per customer requirement
- Cost-efficient for small tenants; strong isolation for large
- Gradual upgrade path (Standard → Professional → Enterprise)
- Regulatory compliance achievable for enterprise customers

**Negative:**
- Three codepaths for tenant data access (mitigated by repository abstraction)
- Schema migrations must handle all three tiers
- Tenant migration between tiers requires careful planning

### Implementation Notes

- Repository pattern abstracts isolation strategy from domain logic
- Tenant metadata service resolves tenant → isolation tier at request time
- Database migration tool (Flyway) supports schema-per-tenant migrations
- Connection pooling: PgBouncer for shared instances; dedicated pools for Enterprise
- Automated tenant provisioning orchestrates across all tiers
- Data migration tooling for tier upgrades (downtime window required)

---

## ADR-004: Service Communication — Synchronous (gRPC) + Asynchronous (Kafka)

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect

### Context

Inter-service communication in FleetVision must support:
- Real-time queries (e.g., "is this driver HOS-eligible for dispatch?")
- High-throughput event propagation (GPS positions, telemetry)
- Choreographed sagas for multi-service transactions
- External IoT device communication (MQTT)

### Decision

**Dual communication model:**

| Pattern | Protocol | Use Case |
|---|---|---|
| **Synchronous** | gRPC (Protobuf) | Cross-context queries requiring immediate response: driver eligibility checks, fleet membership validation, authentication |
| **Asynchronous** | Apache Kafka | All state change notifications, event sourcing, telemetry pipeline, saga choreography |
| **Real-time** | WebSocket (Socket.IO) | Server-to-client live tracking, push notifications |
| **IoT** | MQTT v5.0 | Telematics device-to-platform communication |

**Rules:**
1. Commands (writes) → always asynchronous via domain events (Kafka)
2. Queries requiring current state → synchronous via gRPC (when eventual consistency is unacceptable)
3. Cross-context reads from read models → synchronous via REST (API Gateway)
4. All cross-service state changes → domain events on Kafka (never direct database access)

### Consequences

**Positive:**
- Clear separation between command and query paths
- Loosely coupled services via event-driven communication
- High throughput for telemetry data via Kafka
- Low latency for critical queries via gRPC

**Negative:**
- Two communication patterns to learn and maintain
- gRPC service discovery and load balancing require service mesh
- Saga compensation logic adds complexity

---

## ADR-005: Istio Service Mesh for Cross-Cutting Concerns

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect, Platform Engineering Lead, Security Architect

### Context

FleetVision has 14+ microservices requiring:
- Mutual TLS for all inter-service communication
- Distributed tracing without code changes
- Traffic management (canary, circuit breaking)
- Authorization policies between services
- Observability (metrics collection)

### Decision

Adopt **Istio 1.20+ (ambient mesh)** as the service mesh, running in Kubernetes with:
- Sidecar-less ambient mode (simpler operations, lower resource overhead)
- mTLS enforced for all pod-to-pod communication
- AuthorizationPolicy for service-to-service access control
- VirtualService for traffic routing (canary, A/B)
- PeerAuthentication for mTLS strict mode
- Telemetry V2 for metrics, logs, traces export

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Linkerd | Less feature-complete; no ambient mesh; smaller ecosystem |
| No service mesh | Would require per-service implementation of all cross-cutting concerns |
| Consul Connect | Less Kubernetes-native; smaller community |
| Cilium Service Mesh | Promising but ambient mesh is less mature than Istio's |

### Consequences

**Positive:**
- Zero-trust security with mTLS by default
- Code-free distributed tracing, metrics, and logging
- Advanced traffic management (canary, fault injection)
- Policy-as-code authorization between services

**Negative:**
- Operational complexity (sidecar lifecycle management in sidecar mode)
- Performance overhead (~1-2ms latency per hop)
- Debugging complexity (service mesh issues can be opaque)
- Team learning curve

---

## ADR-006: Spring Boot 3.3 + Kotlin for Core Microservices

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect, Engineering Leads

### Context

FleetVision core microservices require:
- Mature DDD/CQRS framework support
- Strong type safety
- Excellent testability
- Large enterprise talent pool
- Proven scalability in production

### Decision

**Spring Boot 3.3 with Kotlin 2.0** as the primary technology stack for core microservices (12 of 14 bounded contexts).

**Exceptions:**
| Service | Language | Rationale |
|---|---|---|
| `telemetry-ingestion-service` | **Go 1.22** | Maximum throughput with minimal latency; efficient concurrency for GPS event processing |
| `analytics-engine` | **Python 3.12** | ML ecosystem (PyTorch, scikit-learn); data science team productivity |

### Consequences

**Positive:**
- Spring Boot's mature ecosystem (Spring Data, Spring Security, Spring Kafka)
- Kotlin's null safety, concise syntax, and Java interoperability
- Large talent pool (Java/Kotlin developers)
- Excellent framework support for DDD patterns (Axon Framework)

**Negative:**
- JVM memory overhead (mitigated by GraalVM native images for some services)
- Slower cold starts compared to Go/Rust
- Kotlin + Spring learning curve for pure Java teams

### Implementation Notes

- Axon Framework for CQRS + Event Sourcing infrastructure
- Spring Data JDBC (not JPA) for simpler aggregates — better control over SQL
- Spring Modulith for bounded context enforcement within monolithic deployment option
- Micrometer + OpenTelemetry for observability
- Testcontainers for integration testing

---

## ADR-007: PostgreSQL 16 as Primary OLTP Database

**Status:** Accepted  
**Date:** 2026-08-02  
**Deciders:** Chief Software Architect, Database Architect

### Context

FleetVision needs a primary relational database for:
- Transactional data (vehicles, fleets, drivers, trips, work orders, billing)
- Row-level security for multi-tenancy
- JSONB support for flexible metadata
- PostGIS for geospatial queries
- Event store tables for event-sourced aggregates

### Decision

**PostgreSQL 16** as the primary OLTP database for all core services, with extensions:
- **PostGIS 3.4** — Geospatial queries (geofence evaluation, route planning)
- **pg_partman** — Automatic table partitioning (by tenant_id + time)
- **pg_cron** — Scheduled maintenance tasks
- **pgvector** — Embedding storage for future AI/ML features

### Consequences

**Positive:**
- Single database technology reduces operational complexity
- PostGIS eliminates need for separate geospatial database
- Row-level security is a first-class feature
- Mature replication (streaming replication, logical replication)
- Strong ACID guarantees

**Negative:**
- Horizontal scaling requires Citus extension (adds complexity)
- Write throughput ceiling (~100K writes/sec on single instance; Citus scales reads better)
- Connection management requires PgBouncer at scale

### Implementation Notes

- Patroni for automatic failover and leader election
- PgBouncer for connection pooling (transaction mode)
- TimescaleDB extension for time-series data (GPS positions)
- Citus (Hyperscale) for horizontal sharding if single-node becomes bottleneck
- WAL-G for backup to S3
- Read replicas for query offloading

---

## ADR-008: Polyglot Persistence Strategy

**Status:** Accepted  
**Date:** 2026-08-02

### Context

Different data access patterns in FleetVision have fundamentally different requirements:
- Time-series: 600K GPS positions/second, range queries by time + vehicle
- Documents: Device configurations, driver profiles, inspection forms with variable schemas
- Cache: Session data, rate limiting, real-time position cache
- Search: Full-text search across vehicles, drivers, reports
- Analytics: Aggregated OLAP queries across billions of data points
- Objects: Firmware binaries, document uploads, report exports

### Decision

Adopt a **polyglot persistence** strategy:

| Data Store | Use Case | Selection Criteria |
|---|---|---|
| PostgreSQL 16 | OLTP, event store, relational data | ACID, RLS, PostGIS |
| TimescaleDB (PG extension) | Time-series: GPS, telemetry | Compression, retention policies, time-based partitioning |
| MongoDB 7 | Documents: device configs, profiles, inspections | Flexible schema, aggregation pipeline |
| Redis 7 | Cache, sessions, rate limiting, pub/sub | Sub-millisecond latency, data structures |
| Apache Kafka | Event streaming, event sourcing | High throughput, replay, ordering |
| ClickHouse | OLAP analytics, aggregated reporting | Columnar storage, fast aggregation on billions of rows |
| Elasticsearch 8 | Full-text search, log aggregation | Relevance ranking, faceted search |
| MinIO / S3 | Object storage: firmware, documents, backups | S3-compatible, durable, cost-effective |

### Consequences

**Positive:**
- Each data store optimized for its access pattern
- No single database becomes a bottleneck
- Cost-effective storage selection per data type

**Negative:**
- Operational complexity: 8 different data store technologies
- Data consistency across stores requires careful event design
- Development teams must learn multiple query languages
- Backup/restore strategies differ per store

---

## ADR-009: Keycloak for Identity & Access Management

**Status:** Accepted  
**Date:** 2026-08-02

### Context

FleetVision requires enterprise-grade IAM supporting:
- Multi-tenant authentication (each tenant can have own users)
- SSO via OIDC/SAML2
- MFA (TOTP, WebAuthn, SMS)
- SCIM 2.0 provisioning from HR systems
- Fine-grained authorization (ABAC + RBAC)
- API token management

### Decision

**Keycloak 24+** as the IAM platform, with:
- Realm-per-tenant for enterprise customers
- Shared realm with groups for standard/professional customers
- SPIFFE/SPIRE for service identity (separate from user identity)
- OPA (Open Policy Agent) for fine-grained authorization decisions

### Consequences

**Positive:**
- Feature-complete IAM out of the box
- Multi-tenant support via realms
- Enterprise SSO (SAML2, OIDC federation)
- Extensible via SPI (Service Provider Interface)

**Negative:**
- Keycloak operational overhead (cluster management, database)
- Realm-per-tenant scaling limit (thousands of realms)
- Custom authorization requires OPA integration layer

---

## ADR-010: GitOps Deployment with ArgoCD

**Status:** Accepted  
**Date:** 2026-08-02

### Context

FleetVision requires:
- Fully automated, repeatable deployments
- Kubernetes-native deployment management
- Multi-environment promotion (dev → staging → production)
- Rollback capability
- Audit trail of all deployment changes

### Decision

**GitOps with ArgoCD** as the deployment strategy:
- All Kubernetes manifests in Git (Helm charts + Kustomize overlays)
- ArgoCD watches Git repositories and reconciles desired state
- ApplicationSets for multi-tenant/multi-environment deployments
- Argo Rollouts for canary and blue-green deployments
- GitHub Actions for CI (build, test, scan); ArgoCD for CD (deploy)

### Consequences

**Positive:**
- Git as single source of truth for deployment state
- Declarative infrastructure; no ad-hoc `kubectl` changes
- Automatic drift detection and reconciliation
- Easy rollback (Git revert)

**Negative:**
- GitOps learning curve
- Secrets management requires external tooling (External Secrets Operator + Vault)
- Multi-cluster ArgoCD adds complexity

---

## ADR-011: OpenTelemetry for Observability

**Status:** Accepted  
**Date:** 2026-08-02

### Context

Unified observability across 14+ microservices written in Java, Kotlin, Go, and Python.

### Decision

**OpenTelemetry** as the standard instrumentation framework:
- Auto-instrumentation for Java/Kotlin services (OTel Java Agent)
- Manual SDK for Go services (telemetry-ingestion)
- Python SDK for analytics engine
- Collector pipeline: OTel Collector → Prometheus (metrics) + Jaeger (traces) + Loki (logs)
- Correlation ID propagation across all services (W3C TraceContext)

---

## ADR-012: API Versioning — URI-Based with Sunset Policy

**Status:** Accepted  
**Date:** 2026-08-02

### Context

FleetVision APIs are consumed by web, mobile, IoT devices, and third-party integrations requiring:
- Predictable evolution
- Non-breaking changes within a version
- Clear deprecation timeline
- Simultaneous multi-version support

### Decision

**URI-based API versioning** (`/api/v1/`, `/api/v2/`) with:
- Maximum 3 active versions simultaneously (N, N-1, N-2)
- 12-month deprecation notice before sunset
- Sunset header (`Sunset: Sat, 01 Aug 2027 00:00:00 GMT`) and `Deprecation: true` header
- API evolution guide: additive changes only (new fields nullable); breaking changes → new version
- Internal gRPC versioning via Protobuf `package` version suffix

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Header-based (`Accept: application/vnd.api.v1+json`) | Less discoverable; harder to debug |
| Query parameter (`?version=1`) | Not cache-friendly; easy to miss |
