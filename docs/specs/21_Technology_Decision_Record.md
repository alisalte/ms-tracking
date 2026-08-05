# FleetVision — Technology Decision Record

**Version:** 1.0.0
**Status:** Approved — Foundation-Aligned
**Date:** 2026-08-02
**Owner:** Chief Software Architect / ARB
**Classification:** Confidential — Technology Governance

> **About this document.** This is the **consolidated Technology Decision Record (TDR)** for FleetVision — the single, board-readable summary of *every technology choice of consequence* on the platform, finalized in one place. For each of the twelve categories below it records: the **chosen technology**, the **alternatives considered**, the **reason** the choice carries, and the **trade-offs** accepted.
>
> **Authority.** This document is a *consolidation and restatement* of decisions already accepted as ADRs and recorded in `01_Master_Architecture.md` §4 (Technology Stack) and §13 (ADR table). It does not supersede any ADR. Where this document and an ADR appear to differ, **the ADR wins**; this TDR is the index. The two decisions that most shape the stack — **ADR-021** (Node.js LTS + NestJS + TypeScript as the primary runtime, supersedes ADR-006) and **ADR-022** (lean persistence: PostgreSQL / TimescaleDB / Redis / S3 + Kafka + RabbitMQ, supersedes ADR-008) — are reflected throughout.
>
> **A reversal worth naming up front.** The platform's first-accepted stack (ADR-006: Kotlin/Spring Boot + Go + Python over 8 polyglot stores, ADR-008) was **reversed at ARB level before implementation** in favor of a single primary runtime and a lean 4-store (+2 broker) footprint. The rationale (cost-per-vehicle BG-3, delivery velocity BG-8, reduced operational surface, reversibility BG-7) is captured per-decision below. Legacy v1.0.0 drafts in `Architecture/`, `Database/`, `README.md`, etc., still name Kotlin/Go and 8 stores — they are **non-canonical** (`01` Appendix B F-12).

---

## Table of Contents

0. [Decision Summary](#0-decision-summary)
1. [Backend Framework / Runtime](#1-backend-framework--runtime)
2. [Database](#2-database)
3. [ORM / Data Access](#3-orm--data-access)
4. [Message Broker](#4-message-broker)
5. [Cache](#5-cache)
6. [Storage (Object)](#6-storage-object)
7. [Real-time Communication](#7-real-time-communication)
8. [Video Infrastructure](#8-video-infrastructure)
9. [Cloud Infrastructure](#9-cloud-infrastructure)
10. [CI/CD](#10-cicd)
11. [Monitoring](#11-monitoring)
12. [Logging](#12-logging)
13. [Cross-Cutting Trade-offs & Risks](#13-cross-cutting-trade-offs--risks)
14. [Governance & Change Control](#14-governance--change-control)
15. [Traceability](#15-traceability)

---

## 0. Decision Summary

| # | Category | Chosen Technology | Governing ADR / Ref |
|---|---|---|---|
| 1 | Backend Framework / Runtime | **Node.js LTS + NestJS + TypeScript (strict)**; Python 3.12 for 2 ML tiers | ADR-021 |
| 2 | Database | **PostgreSQL 16** (+ PostGIS, TimescaleDB, pgvector, pg_trgm, JSONB, FTS) | ADR-007, ADR-022 |
| 3 | ORM / Data Access | **`knex` query builder** (no heavy ORM); raw SQL for hot paths | ADR-021 §2.1, ADR-022 |
| 4 | Message Broker | **Apache Kafka 3.7 (MSK)** — event backbone; **RabbitMQ** — task queue | ADR-002, ADR-022 |
| 5 | Cache | **Redis 7 (cluster mode)** | ADR-022 |
| 6 | Storage (Object) | **S3 / MinIO** (SSE-KMS) | ADR-022 |
| 7 | Real-time Communication | **Socket.IO (Node + Redis adapter)** — canonical | ADR-015 |
| 8 | Video Infrastructure | **Pion/MediaMTX (Go) or mediasoup SFU** + `media-streamer`; `video-ai-engine` (Python) | ADR-013, ADR-021 §5 |
| 9 | Cloud Infrastructure | **AWS** (EKS, MSK, ElastiCache, RDS, S3, Route 53); Kubernetes-first | `01` §10 |
| 10 | CI/CD | **GitHub Actions (CI) + ArgoCD + Argo Rollouts (CD, GitOps)** | ADR-010 |
| 11 | Monitoring | **OpenTelemetry → Prometheus/Thanos + Grafana** (metrics) | ADR-011 |
| 12 | Logging | **Loki** (structured logs via OpenTelemetry Collector) | ADR-011 |

**Consequences of the two pivotal decisions, in one line each:**
- **ADR-021** → 18/20 services on one runtime; Go and Kotlin retired; Python kept for the two ML tiers only (BG-4).
- **ADR-022** → 4 stores (PG, Timescale, Redis, S3) + 2 brokers (Kafka, RabbitMQ); MongoDB removed (→ JSONB); ClickHouse & Elasticsearch **deferred with measurable triggers**, not canceled.

---

## 1. Backend Framework / Runtime

**Chosen:** **Node.js LTS + NestJS + TypeScript (strict mode)** as the primary runtime for **18 of 20 services**; **Python 3.12** (FastAPI, PyTorch, scikit-learn, MLflow) retained as a documented polyglot exception for **exactly two ML tiers** — `video-ai-engine` (#12) and `analytics-engine` (#19).

| Aspect | Selection |
|---|---|
| Runtime | Node.js LTS (Active LTS track) |
| Framework | NestJS (modular, DI-first, opinionated) |
| Language | TypeScript, strict (`strictNullChecks`, `noImplicitAny`) |
| Package manager | pnpm (workspace monorepo) |
| Inter-service RPC | gRPC via `@grpc/grpc-js` + `buf`-generated TS (ADR-004) |
| Event client | `kafkajs` (Avro via `@avro/types`) |
| CQRS/ES | In-repo NestJS modules (command bus, outbox, projections) — ADR-001 preserved |
| Validation | `class-validator` + `zod` at trust boundaries |
| Testing | Jest + Supertest + Testcontainers + Pact |
| Observability | `@opentelemetry/api` + auto-instrumentations |

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| Keep **Kotlin/Spring Boot + Go + Python** (ADR-006 baseline, 15 Kotlin / 3 Go / 2 Python) | **Rejected.** ARB decision to consolidate to a single primary runtime. The JVM's strengths (CPU density) are not the platform's bottleneck; the hot paths are I/O-bound (device TCP, telemetry normalization, Kafka fan-out, WebSocket fan-out, Redis reads), which Node's event loop serves without a second runtime. Two runtimes for one workload class was unjustified overhead. |
| **Node + Go** (keep Go for ingestion/streaming) | **Rejected.** Preserves a second runtime for a marginal concurrency gain Node already covers at the platform's scale (15K ev/s Y1 → 600K ev/s Y5, horizontally scaled across pods, not single-node). |
| **Pure Node + ONNX Runtime for ML** (drop Python) | **Rejected.** Would weaken BG-4 (AI dashcam, predictive maintenance). Python's training/CV ecosystem has no Node equivalent. ONNX Runtime *may* still be used for inference deployment inside `video-ai-engine`, but model development stays Python. |
| **Java/JVM (non-Kotlin)**, **.NET**, **Rust**, **Elixir** | Not evaluated in depth; rejected on hire-pool / ecosystem-fit / operational-overhead grounds for a polyglot platform that already commits to TS on the frontend. |

**Reason** (tied to vision)
- **One runtime lowers operational + cognitive surface** → lower cost-per-vehicle (BG-3) and higher delivery velocity (BG-8): one hire pool, one build/test/observability pipeline, one set of shared libraries.
- **NestJS maps cleanly to Clean Architecture + DDD** — modules = bounded contexts; providers/use-cases = application layer; controllers = interface layer; repositories = infrastructure. No translation tax between the architecture in `01`/`02` and the code.
- **End-to-end TypeScript** — the React 18 + RN clients already use TS; the backend shares DTO/proto types via `fleetvision-proto`, cutting contract-drift bugs (BG-6, BG-8).
- **Node's async I/O fits the dominant workload** — the highest-volume paths are I/O-bound; the prior stack needed Go *specifically* for this reason, which Node now collapses into one runtime.
- **CQRS/ES is runtime-neutral** — ADR-001/002 are preserved; NestJS modules implement the command bus, outbox, projections; the event store stays PostgreSQL; the backbone stays Kafka.

**Trade-offs accepted**
- **CPU-bound workloads** (heavy geospatial computation, large report rendering, ML inference outside the two Python services) must be offloaded to worker threads, a Python sidecar, or a dedicated compute service. Mitigation: the CPU-bound hot spots are already batch/async and fit the task-queue model (RabbitMQ, ADR-022).
- **Migration cost** — 18 services move from Kotlin/Go to TS; phased per the vision roadmap and tracked in `01` Appendix B.
- Smaller "enterprise JVM" talent signal than Kotlin/Spring — offset by a much larger TS/Node pool and end-to-end TS benefit.
- NestJS is not as battle-proven as Spring at the very largest enterprise scales; mitigated by NestJS's mature DI/module model and the in-repo CQRS framework.

---

## 2. Database

**Chosen:** **PostgreSQL 16** as the system of record, extended with **PostGIS** (geospatial), **TimescaleDB** (time-series), **pgvector** (embeddings/ML), **pg_trgm + tsvector/tsquery** (full-text search), **JSONB** (documents), and **pg_partman** (partition management).

PostgreSQL wears five hats: **primary OLTP**, **event store** (for ES aggregates per ADR-001), **geospatial** (PostGIS), **document store** (JSONB — absorbs MongoDB's workload), and **full-text search** (FTS — absorbs Elasticsearch's MVP-scale workload).

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **8-store polyglot** (ADR-008: PG + Timescale + Mongo + Redis + Kafka + ClickHouse + ES + S3) | **Rejected (superseded by ADR-022).** Each store has its own backup, monitoring, patching, on-call, and failure mode; 8 stores is materially costlier to run than 4 and not justified at MVP→Phase-3 scale. JSONB + Postgres FTS cover the removed stores' workloads. |
| **MongoDB** for documents (device configs, driver profiles, DVIR, POD) | **Removed.** Those are aggregate-owned documents that benefit from transactional co-location with their parent aggregate (JSONB + GIN). MongoDB re-introduces a cross-store consistency boundary for no gain. |
| **ClickHouse / Elasticsearch now** (don't defer) | **Deferred with triggers (not canceled).** At Y1–Y3 scale, Timescale continuous aggregates + Postgres materialized views + Postgres FTS meet the SLAs. Re-introduced when a measurable trigger fires (analytics P99 > 2s; search QPS > 200; or Year-5 band). Protects BG-7 (scale without re-platforming). |
| **Microsoft SQL Server / Oracle** | **Rejected.** Licensing cost, lock-in, weaker fit (no PostGIS/Timescale/RLS ecosystem), contradicts cloud-agnostic strategy. |
| **Postgres-only** (no Timescale, no Redis) | **Rejected.** Timescale is load-bearing for 600K ev/s time-series (compression, continuous aggregates); Redis for sub-ms latest-position and rate limiting. Both stay. |
| **CockroachDB / YugabyteDB** (distributed SQL) | Not selected; the Year-5 scale path is addressed by Timescale multi-node + PG read replicas + the ClickHouse trigger, not by a distributed-SQL migration. |

**Reason**
- **One transactional store with deep extensions** covers OLTP, geospatial, time-series, documents, FTS, and vector search — proven, well-understood, with the strongest ecosystem fit for the platform's mix of relational integrity and semi-structured data.
- **RLS enables the multi-tenant Standard tier** (ADR-003) natively — no application-only isolation.
- **JSONB removes a consistency boundary** — documents become transactional with their aggregate (no cross-store saga for what should be one write). Strengthens the *Trust* pillar (BG-5).
- **Triggers, not deletions** for ClickHouse/ES keep the Year-5 growth path documented and measurable rather than hand-waved (BG-7, reversibility §9).

**Trade-offs accepted**
- **PostgreSQL bears a lot of load** — OLTP + event store + geospatial + documents + FTS. Mitigations: schema-per-aggregate isolation, PgBouncer pooling, read replicas, Timescale offload for time-series, and the ClickHouse trigger before OLAP pressure becomes structural.
- **Postgres FTS is weaker than Elasticsearch** for typo-tolerance, relevance tuning, and very-high QPS — acceptable through Phase-3; the trigger restores ES when needed.
- **TimescaleDB single-node ceiling** at Year-3+ ingest (600K ev/s → ~52B/day) is real; committed plan is Timescale multi-node by Year 3 (space-partitioning on `vehicle_id`), with a capacity-trigger threshold in the runbook.

---

## 3. ORM / Data Access

**Chosen:** **No heavy ORM.** `knex` (SQL query builder) for aggregate-aligned SQL; **raw SQL for hot paths**; schema management via **Flyway** (plus Confluent Schema Registry for Avro event schemas). JSONB documents accessed via Postgres JSONB operators through the same query builder.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **TypeORM** (full "magic" ORM: active-record/data-mapper, lazy loading, auto-sync) | **Rejected.** Implicit behavior (lazy loading → N+1, magic migrations, hidden SQL) fights the Clean Architecture + DDD discipline and makes performance hard to reason about on the hot paths. "JPA/Hibernate-equivalent magic is explicitly rejected" (ADR-006 §Rejected, carried into ADR-021). |
| **Prisma** | Considered; rejected for similar reasons (generated client hides SQL semantics; schema-first is nice but its migration story and raw-SQL ergonomics are weaker than `knex` + Flyway for this codebase). Also historically heavier at high concurrency. |
| **MikroORM**, **Sequelize** | Evaluated and set aside; MikroORM's identity-map is attractive for DDD but its ecosystem size and TS strictness story are weaker than the `knex` + explicit-repository pattern. |
| **Raw `pg` driver only** (no query builder) | Rejected — loses composable query building, parameter binding safety, and migrations; `knex` gives those without ORM magic. |

**Reason**
- **Explicit over implicit.** Aggregate repositories own their SQL; every query is auditable and performance-predictable — critical for 600K ev/s and a tight cost-per-vehicle budget (BG-3).
- **No object-relational impedance mismatch.** DDD aggregates map to explicit repository methods, not to ORM-managed entity graphs.
- **`knex` is composable but transparent** — you see the SQL; you tune the SQL; you index for the SQL. It does not hide lazy loads or generate surprise queries.

**Trade-offs accepted**
- **More boilerplate** than a magic ORM — repository methods are hand-written. Deliberate: the boilerplate *is* the boundary.
- **No automatic schema→entity sync** — migrations are explicit (Flyway), which is the desired posture for a regulated platform (auditable, reviewable schema changes).
- Team discipline required to keep repository SQL consistent; mitigated by shared repository base classes + lint rules.

---

## 4. Message Broker

**Chosen:** **Two brokers, two jobs.**
- **Apache Kafka 3.7 (Amazon MSK)** — the **event backbone**: domain events, transactional-outbox relay (Debezium CDC), Event Sourcing replay (ADR-001/002), cross-context coordination.
- **RabbitMQ 3.x** — the **task/work queue**: transient, short-lived work items (report rendering, notification dispatch, batch jobs). Not an event store; no persistence guarantee beyond task lifetime.

This "two brokers, two jobs" split is an architectural invariant (`01` §4.5 invariant #4): a state change is **never** written to RabbitMQ, and a task is **never** enqueued on Kafka.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Kafka only** (use Kafka for task queues too) | **Rejected.** Kafka is the wrong primitive for transient per-task work items (delayed retry, per-consumer ack, dead-letter, priority). It either loses per-task semantics or pollutes the event backbone. |
| **RabbitMQ as the event backbone** | **Rejected.** No replay, per-queue ordering only — incompatible with CQRS + Event Sourcing (ADR-001) which depends on replayable, partitioned, retention-backed streams. |
| **AWS Kinesis / SNS+SQS** | Considered; rejected on cloud-portability grounds (lock-in vs MSK's Kafka-compatibility) and the desire for one portable event protocol. |
| **NATS / JetStream**, **Pulsar** | Evaluated; NATS is attractive but its ecosystem/operational maturity for exactly-once + schema-registry integration trails Kafka at this scale. Pulsar's two-tier architecture adds operational complexity not justified by the workload. |
| **Redpanda** (Kafka-compatible) | Considered as a self-hosted alternative; deferred — MSK's managed profile fits the lean-ops posture (BG-3); Redpanda remains a documented fallback for self-hosted/sovereign deployments. |

**Reason**
- **Kafka is load-bearing for the architecture** — CQRS/ES replay, CDC outbox, event-driven cross-context flow (ADR-001, ADR-002, ADR-004) all assume a partitioned, replayable, retention-backed stream.
- **MSK removes broker ops** — managed multi-AZ, Schema Registry-compatible; lowers cost-per-vehicle (BG-3).
- **RabbitMQ right-sizes the task workload** — report rendering, notification fan-out, and batch jobs are *tasks*, not *events*. Per-task ack, delayed retry, dead-letter, and priority are RabbitMQ's strengths.

**Trade-offs accepted**
- **Two brokers to operate** — justified by their distinct jobs; the alternative (Kafka for tasks) was rejected above.
- **Kafka partition-expansion ordering caveat** — adding partitions breaks key→partition mapping; mitigated by provisioning 256+ partitions up-front for high-volume topics and a documented expansion procedure.
- **Schema-registry + Avro discipline** — `BACKWARD_TRANSITIVE` compatibility is enforced in CI; a breaking event change cannot merge (ADR-018).

---

## 5. Cache

**Chosen:** **Redis 7 in cluster mode** (Amazon ElastiCache). The hot-path store for: **latest vehicle position** (sub-ms reads for the live map), **sessions**, **rate-limit counters**, **JWT revocation lists** (`revocation:<jti>`, `revocation:user:<sub>`), **command idempotency**, and **Socket.IO pub/sub adapter**.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Memcached** | **Rejected.** No persistence, no pub/sub, no rich data structures — Redis's sorted sets (rate-limit windows), streams, and pub/sub are all load-bearing. |
| **Hazelcast / Ignite** | Evaluated; rejected — operational profile heavier than needed; Redis cluster + Socket.IO adapter covers the use cases with a smaller footprint. |
| **DragonflyDB** (Redis-compatible, multi-threaded) | Watched; not adopted yet — single-threaded Redis per-instance scaled horizontally meets the SLA, and Dragonfly's compatibility surface is still maturing. A documented future option for the few true single-node hotspots. |
| **Postgres-only** (no cache; latest-position read from Timescale) | **Rejected.** Sub-ms latest-position reads at 200K+ API req/s and the live-map workload demand an in-memory store; querying Timescale for "where is this vehicle right now" on every render is not viable. |

**Reason**
- **Redis is load-bearing on four critical paths** — latest-position, rate limiting, token revocation, and the Socket.IO adapter. Removing it was explicitly rejected in ADR-022 §4.
- **Cluster mode** gives horizontal scale + per-tenant namespacing for isolation.
- **Pub/sub adapter** is what lets Socket.IO fan out across pods (ADR-015).

**Trade-offs accepted**
- **Revocation availability depends on Redis** — Redis-down has a documented fail-mode (fail-closed for high-risk roles, fail-open-with-degradation for low-risk; resolves ARR SEC-6). Never silent.
- **Cache-consistency discipline** — latest-position is a write-through projection; stale-on-failover windows are bounded and documented.
- **Persistence is best-effort** (AOF/RDB); Redis is a cache, not the system of record — Postgres/Timescale remain authoritative.

---

## 6. Storage (Object)

**Chosen:** **S3 (AWS) / MinIO (self-hosted, sovereign/edge)** with **SSE-KMS** encryption. The cold tier for: **video segments & recordings**, **firmware artifacts**, **document/photo exports**, and **backups**. The architectural invariant (`01` §4.5 #6): *"anything large or rarely read lives in S3, never in a database."*

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Azure Blob / Google Cloud Storage** | Not chosen as primary (AWS-first); the S3 API is the de-facto interface, so MinIO + GCS/Azure-Blob are drop-in for multi-cloud/sovereign needs. |
| **Database BLOBs** (store video in Postgres) | **Rejected.** Bloats the DB, breaks backup/restore economics, fights the "object storage is the cold tier" invariant. |
| **Ceph / Swift** (self-hosted only) | Considered for sovereign deployments; MinIO preferred for its S3 fidelity and lighter ops profile. |
| **Block storage (EBS) for media** | Rejected for media (no lifecycle tiering, no per-object encryption granularity); EBS is used only for database + broker volumes. |

**Reason**
- **Durability + cost** — 11×9 durability, lifecycle tiering (e.g., Glacier for cold evidence), per-object SSE-KMS.
- **Per-tenant isolation** — bucket/prefix per tenant (`tenant=<id>/`) + per-tenant KEK (envelope encryption) enables crypto-shredding erasure (GDPR Art. 17).
- **S3-API portability** — MinIO for sovereign/edge; GCS/Azure-Blob for multi-cloud; one client library.

**Trade-offs accepted**
- **Not a database** — no query/transaction; metadata lives in Postgres, the object in S3, joined by key.
- **Eventual consistency caveats** on some operations (mitigated by read-after-write consistency on PUT in modern S3).
- **Egress cost** — mitigated by Cloudflare fronting + signed URLs + lifecycle policies.

---

## 7. Real-time Communication

**Chosen:** **Socket.IO (Node.js server + Redis adapter)** as the **canonical, sole primary real-time transport** for browser and mobile clients (ADR-015, ratified by ADR-019). Carries live positions, alerts, video signaling, and command acknowledgements. WebRTC (over the Video Gateway SFU) for live media.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **SignalR (ASP.NET Core)** as a peer surface | **Rejected (resolves ARR ARCH-3).** v1.0.0 drafts presented SignalR as a peer transport; per ADR-015 Socket.IO is the **sole primary** real-time transport. Introducing SignalR would silently introduce a .NET runtime (ASP.NET Core) with no ADR, breaking the single-runtime discipline (ADR-021). .NET partners consume real-time via **webhooks + REST + the official .NET SDK** (which wraps the Socket.IO client). |
| **Raw WebSocket** (no Socket.IO abstraction) | Considered; rejected — loses Socket.IO's reconnection, rooms, ack semantics, and the Redis adapter for multi-pod fan-out, all of which are load-bearing. |
| **Server-Sent Events (SSE)** | Evaluated for one-way push; rejected as primary (no bidirectional ack, no room subscription model); usable as a fallback for specific one-way cases. |
| **MQTT-over-WebSocket** to clients | Rejected for client RT (MQTT is the device protocol, not the client RT protocol); clients use Socket.IO. |
| **gRPC streaming** to browsers | Rejected — browser gRPC ergonomics (connect-web, etc.) are weaker than Socket.IO for this fan-out pattern; gRPC is reserved for internal service-to-service (ADR-004). |

**Reason**
- **One transport, one auth model, one observability story.** Socket.IO with the Redis adapter scales to 50K connections/node and fan-out across pods.
- **Typed event subscription** — rooms (`tenant:`, `fleet:`, `vehicle:`) gated by OPA; the SDK exposes typed event handlers.
- **Reconnection + back-pressure** built in — exponential backoff + jitter, room-subscription replay within a 30s grace window, server-side batching (≤10 position updates/s/client) and marker clustering > 2,000 visible.

**Trade-offs accepted**
- **Socket.IO's protocol is its own** (not raw WebSocket) — mitigated by official SDKs in TS/Python/.NET/Mobile that abstract it.
- **Connection-state management** is non-trivial at scale; mitigated by per-tenant channel isolation and connection quotas enforced at the gateway (not just Socket.IO).
- **Per-tenant fan-out skew** (one noisy tenant on a Redis pub/sub channel) — mitigated by per-tenant channel isolation; flagged as a load-test scenario.

---

## 8. Video Infrastructure

**Chosen:** A three-service split within the Media & Video context (ADR-013):
- **`media-service`** (#10) — Node.js + NestJS + TypeScript; the *orchestrator* (operational metadata API, channels, recordings, policies).
- **`media-streamer`** (#11, the Video Gateway / media-router) — a **specialized real-time media component** (Pion/MediaMTX in Go, or mediasoup in Node/C++): terminate JT1078/RTSP/RTMP/WebRTC, demux → transcode (NVENC GPU) → record → SFU fan-out → HLS mux. Treated as **infrastructure-class software** (like Postgres or Redis), not platform business-logic, so its language is *not* constrained by ADR-021's single-runtime rule (ADR-021 §5).
- **`video-ai-engine`** (#12) — **Python 3.12** (PyTorch); the documented ML exception (ADR-021 §2.2, protects BG-4). FCW/distracted-driver/drowsiness inference on Kafka-driven frames.

Storage is the lean set: **PostgreSQL** (metadata), **Redis** (live session state), **S3** (segments/recordings), per ADR-022. WebRTC SFU for sub-second live; HLS/fMP4 for playback/VOD.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **All-media-in-one Kotlin service** (original VideoPlatform.md v2.0.0, retired runtime) | **Rejected** — retired with ADR-021; the split is retained but the orchestrator language moves to Node. |
| **GStreamer-based custom media server** | Considered; rejected — too low-level and operationally heavy vs Pion/MediaMTX/mediasoup for the platform's mix of ingest protocols. |
| **Janus / Kurento** (full SFU/MCU servers) | Evaluated; set aside — heavier operational profile than a Pion-based router; MediaMTX/Pion or mediasoup better fit the infra-component posture. |
| **Commercial media platforms** (Mux, Wowza Cloud) | Rejected — recurring per-stream cost conflicts with BG-3 (cost-per-vehicle); sovereignty/data-residency concerns (BG-5). |
| **LiveKit** (open-source real-time platform) | Watched; attractive WebRTC stack; not adopted as the canonical router yet — the Pion/MediaMTX route covers ingest + SFU + HLS in one infra component. A documented future option. |
| **Pure cloud CDN/HLS** (no WebRTC SFU) | Rejected — cannot meet the < 1s glass-to-glass live SLO; WebRTC is required for live dispatch. |

**Reason**
- **Three concerns, three scaling axes** — ingest/SFU scales with channel count; transcode scales with GPU; AI scales with Kafka lag; orchestrator scales with API RPS. Splitting lets each scale independently.
- **Infra-class media router + Node orchestrator + Python AI** preserves ADR-021's discipline (one business-logic runtime) while honestly acknowledging that real-time media software is infrastructure, not application code.
- **BG-4 (Intelligence pillar)** — the AI dashcam is a competitive differentiator; Python is retained precisely to protect it.

**Trade-offs accepted**
- **Three services** to operate for one context (vs one) — justified by independent scaling/lifecycle/polyglot.
- **GPU pool** required for transcode + AI inference (NVENC) — a dedicated node pool (g5.xlarge); cost monitored against BG-3.
- **Media-router language choice (Go vs Node/C++)** is left to the infra-component vendor (Pion=Go, mediasoup=Node/C++); this is intentional flexibility at the infra layer, not a violation of the runtime rule.

---

## 9. Cloud Infrastructure

**Chosen:** **AWS** as primary cloud (Year 1–2), **Kubernetes-first / cloud-agnostic by abstraction** for Azure/GCP portability. Managed services where they reduce ops without locking the architecture: **EKS** (Kubernetes 1.29), **MSK** (Kafka), **ElastiCache** (Redis), **RDS for PostgreSQL 16**, **S3**, **Route 53**. Self-hosted on EKS where portability matters: **Vault**, **ClickHouse** (when its trigger fires), **Istio**, **Kong**.

- **Service mesh:** Istio 1.20 **ambient mode** (sidecar-less L4; L7 where needed), mTLS strict, AuthorizationPolicy default-deny, NetworkPolicy deny-all (ADR-005). SPIFFE/SPIRE workload identity.
- **API Gateway:** Kong Enterprise 3.x — terminates TLS, validates JWT/API-key, OPA authz, rate limit, tenant injection (ADR-009, resolves ARR API-1/SEC-1/SEC-2).
- **Edge:** Cloudflare (CDN + WAF) + AWS WAF + Shield for DDoS L3/L4/L7.
- **IAM/Authz:** Keycloak 24 (OIDC + SAML 2.0) + Open Policy Agent (ADR-009).
- **Secrets:** HashiCorp Vault (self-hosted) + External Secrets Operator; dynamic DB credentials (24h TTL); Vault Transit for signing keys (ADR per `01` §9).
- **Multi-region:** Year 1 `us-east-1`; Year 3 + `eu-west-1` (EU residency, active-active); Year 5 + `ap-southeast-1`, `us-west-2` (DR). Tenant-aware region routing at the gateway.
- **Node pools:** system (m6i.xlarge), general (m6i.2xlarge), memory (r6i.2xlarge), compute (c6i.2xlarge), gpu (g5.xlarge); **Karpenter** for fast node provisioning; Spot for interruption-tolerant workloads.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Azure (AKS) / GCP (GKE) as primary** | Not chosen for Year 1 (AWS hire pool + feature fit); the architecture is portable by abstraction (managed services abstracted behind Helm/Kustomize) so a major customer can trigger a port. |
| **On-prem / sovereign-only** | Rejected as primary (loses managed-service economics); supported via MinIO + self-hosted Vault + Redpanda-on-prem for sovereign deals. |
| **Multiple clouds from day 1** | Rejected — premature complexity; one primary cloud with a documented portability path (BG-7). |
| **App Mesh / Linkerd** instead of Istio | Rejected — Istio's ambient mode + AuthorizationPolicy + SPIFFE integration fit the zero-trust posture (ADR-005); Linkerd lacks the policy depth. |
| **AWS API Gateway / Apigee** instead of Kong | Considered; Kong chosen for portability (runs anywhere) and its plugin ecosystem (OPA, rate-limit, transform). |
| **Cloud-native auth (Cognito)** instead of Keycloak | Rejected — Keycloak's OIDC + SAML brokering to enterprise IdPs (Okta/Azure AD) and its self-hostable profile fit the enterprise-SSO + sovereignty requirements (ADR-009). |
| **AWS Secrets Manager / Parameter Store** instead of Vault | Rejected — Vault's dynamic credentials, Transit (keys never leave), and cross-cloud portability win for this threat model. |

**Reason**
- **Managed services reduce ops** (MSK, ElastiCache, RDS) → lower cost-per-vehicle (BG-3) without locking the architecture.
- **Self-host where portability or control matters** (Vault, Istio, Kong, ClickHouse-when-triggered) → avoids the deepest lock-in.
- **Zero-trust mesh + gateway + dynamic secrets** realize the *Trust* pillar (BG-5).
- **Multi-region active-active** supports data residency (EU) and the Year-5 99.99% availability target.

**Trade-offs accepted**
- **AWS as practical primary** — the architecture is portable but a real port is still work; mitigated by abstraction layers + a documented portability runbook.
- **Self-hosted Vault/Istio/Kong** carry operational weight — justified by portability/control; staffing planned.
- **Multi-region complexity** (tenant-aware routing, EU data residency, cross-region replication) — accepted as the cost of the Year-5 availability + residency commitments.

---

## 10. CI/CD

**Chosen:** **GitHub Actions (CI) + ArgoCD + Argo Rollouts (CD, GitOps)** (ADR-010). Infrastructure as Code: **Terraform + Helm + Kustomize**. Images signed with **Cosign (Sigstore)**; admission control rejects unsigned images. CI gates: `spectral`/`oasdiff` (OpenAPI breaking-change), `buf` (proto), Schema Registry compatibility, **permission-catalog drift** (OpenAPI ↔ `02_Domain_Model.md` §6), SAST (Semgrep), secret-scan (gitleaks), dependency CVE (Snyk/Trivy), image scan (Trivy).

- **Progressive delivery:** every production deploy is an Argo Rollouts canary `5% → 25% → 50% → 100%`, with **automatic rollback on SLO/error-budget breach**.
- **GitOps repo:** `fleetvision-gitops/` with Kustomize `base/` + `overlays/{dev,staging,production-*,dr}`; ArgoCD reconciles continuously; **no `kubectl apply` to prod**.
- **Environments:** local (Kind) → ci (ephemeral K3s) → dev → staging (prod-parity) → production (canary) → dr.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Jenkins / CircleCI / GitLab CI** | Considered; GitHub Actions chosen for tight GitHub integration, hosted-runner economics, and the matrix/secret model that fits the monorepo. |
| **Flux** instead of ArgoCD | Evaluated (both are CNCF GitOps); ArgoCD chosen for its UI/health-check model and Rollouts (canary) integration. |
| **Spinnaker** | Rejected — heavier than needed; Argo Rollouts covers progressive delivery with a smaller footprint. |
| **Manual / scripted deploys** | **Rejected outright.** Violates GitOps + reversibility (every deploy must be rollback-able in < 5 min) and auditable-change requirements (SOC2). |
| **Tekton** | Considered for CI; GitHub Actions + action-reusable-workflows chosen for lower setup overhead. |
| **Pulumi / CDK** instead of Terraform | Evaluated; Terraform chosen for ecosystem breadth + team familiarity + multi-cloud portability. |

**Reason**
- **GitOps = auditable + reversible** — every prod change is a PR (2-reviewer); ArgoCD reconciles; rollback is `git revert` + sync (< 5 min). Maps to SOC2 CC8.1 and the < 5% change-failure target.
- **Canary + auto-rollback** makes deploys objective — burn-rate spikes abort the rollout (`01` §10.2).
- **Signed images + admission control** close the supply-chain gap (BG-5, zero-trust).

**Trade-offs accepted**
- **GitOps learning curve** + the discipline of "the cluster is a read view of Git" — mitigated by guardrails (admission control, drift detection).
- **Terraform state management** — remote state + locking + review; standard overhead.
- **CI gate strictness** can slow early delivery — accepted; the gates exist precisely to prevent the cross-document drift the ARR catalogued.

---

## 11. Monitoring

**Chosen:** **OpenTelemetry → Prometheus / Thanos + Grafana** for metrics (ADR-011), with **KEDA** for event-driven autoscaling (Kafka-lag, GPU util) and **Litmus** for chaos engineering. SLO/error-budget framework drives alerting; burn-rate > 75% pauses feature work. Alert tiers: SEV-1 15 min PagerDuty; SEV-2 30 min; SEV-3 4h.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Datadog / New Relic / Dynatrace** (commercial APM) | Considered; deferred — per-host/per-vehicle cost conflicts with BG-3 at 2M-vehicle scale; the OSS stack (OTel + Prometheus + Grafana) is the cost-controlled choice. Datadog retained as the **SIEM** for security correlation (a different budget). |
| **InfluxDB / TimescaleDB-as-metrics** | Rejected — Prometheus is the de-facto metrics standard with the richest instrumentation ecosystem; Thanos handles long-term storage + global query. |
| **StatsD / Graphite** | Legacy; rejected — Prometheus's multi-dimensional label model + PromQL fit the multi-tenant SLO model better. |
| **Native cloud metrics (CloudWatch)** | Used for AWS-service metrics only; not the system of record for app metrics (lock-in + query limitations). |

**Reason**
- **OpenTelemetry = vendor-neutral instrumentation** — one SDK, exportable to any backend; protects against future replatforming (BG-7).
- **Prometheus + Thanos** scales horizontally with Federated/global-query for multi-region; Grafana is the universal visualization layer.
- **SLO-driven alerting** ties monitoring to user-visible quality (the vision's quality targets), not raw thresholds.

**Trade-offs accepted**
- **Self-hosted observability has an ops cost** — mitigated by OTel Collector + Thanos making it manageable; the cost is materially lower than commercial APM at scale.
- **Multi-tenancy in Prometheus** requires care (tenant labels, Thanos query federation) — mitigated by per-tenant SLO dashboards.
- **No out-of-the-box APM tracing UI** like Datadog — Jaeger (distributed tracing, see below) provides it; integration is manual but sufficient.

---

## 12. Logging

**Chosen:** **Loki** (structured logs, collected by the OpenTelemetry Collector) — the single log store (ADR-011, reinforced by ADR-022 which removed Elasticsearch's log role). Structured JSON logs with `X-Request-Id` + W3C `traceparent` propagated end-to-end. **PII redaction at the collector pipeline** (SSN, license, email, phone, VIN masked before persistence). **Distributed tracing:** Jaeger (via OTel). **SIEM:** security-relevant events streamed to Datadog/Elastic-Security via Kafka for correlation.

**Alternatives considered**

| Alternative | Outcome |
|---|---|
| **Elasticsearch / ELK** for logs | **Deferred/removed from the log role (ADR-022).** Logs already route to Loki; removing ES eliminates a duplicate log store. ES returns only when its FTS-at-scale trigger fires (QPS > 200 sustained) — for *search*, not logs. |
| **Splunk** (commercial SIEM/log) | Considered; cost-prohibitive for full-log retention at 600K ev/s; Splunk/Datadog retained for **security events only** (SIEM budget), not platform logs. |
| **CloudWatch Logs** | Used for AWS-service logs only; not the system of record for app logs (query/economics limitations at scale). |
| **Fluentd / Fluent Bit / Vector** | One of these is the collector (Fluent Bit / OTel Collector); they feed Loki. The choice between them is a pipeline implementation detail, not a storage decision. |

**Reason**
- **Loki indexes metadata (labels), not log content** — dramatically lower storage cost than full-text-indexed ES at the platform's log volume; Grafana integrates natively.
- **One log store** (Loki) eliminates the duplicate-store cost ADR-008 carried (ES for logs + ES for search).
- **Structured + correlated** — every log line carries `trace_id`/`request_id`, so logs and traces join in Grafana/Jaeger.
- **PII redaction enforced in the pipeline**, not as an application-level hope (resolves ARR for log-PII).

**Trade-offs accepted**
- **Loki's query language (LogQL) is weaker than full Lucene/Elasticsearch** for free-text log search — acceptable; the deep-search use case is what brings ES back via its trigger.
- **Retention economics** favor structured + compressed Loki storage; very-long-term cold logs can archive to S3.
- **Self-hosted log pipeline** has an ops cost — mitigated by OTel Collector standardization.

---

## 13. Cross-Cutting Trade-offs & Risks

Decisions don't live in isolation. These are the platform-level trade-offs the ARB accepted as the *price of the chosen stack*:

| Trade-off / Risk | Why accepted | Mitigation |
|---|---|---|
| **Single primary runtime (Node) has a CPU-bound ceiling** | The dominant workloads are I/O-bound; CPU-bound work is batch/async or ML | Worker threads, RabbitMQ task queues, Python sidecars for the 2 ML tiers, infra-class media router |
| **PostgreSQL is heavily loaded** (5 hats) | One transactional store with deep extensions beats 8 stores on ops + cost | PgBouncer, read replicas, Timescale offload, schema-per-aggregate, ClickHouse trigger before OLAP pressure is structural |
| **Deferred stores (ClickHouse/ES) can be mistaken for "canceled"** | Deferring protects BG-7 (scale without re-platforming) | Explicit, **measurable** triggers (P99 > 2s; QPS > 200; Y5 band) + named owner per trigger |
| **Two brokers** (Kafka + RabbitMQ) | Each is the right primitive for its job | Hard invariant: state-changes → Kafka, tasks → RabbitMQ; CI lint + review enforce |
| **Self-hosted Vault/Istio/Kong/ClickHouse** carry ops weight | Portability + control + zero-trust > managed lock-in | Staffing plan, runbooks, and a documented managed-service fallback per component |
| **End-to-end TS types require monorepo discipline** | The benefit (no contract drift) is large | pnpm workspaces, shared `fleetvision-proto` + DTO packages, contract tests (Pact) in CI |
| **Strict CI gates slow early delivery** | They exist to prevent the cross-doc drift the ARR catalogued | Gates are automated (not human review for syntax); breakages point to a clear fix |
| **AWS as practical primary** | Managed-service economics + hire pool | Abstraction layers (Helm/Kustomize/Terraform) + portability runbook for Azure/GCP |
| **Media router language is "infra-class, flexible"** | Real-time media software is infrastructure, not application code | Constrained to the infra-component posture (ADR-021 §5); orchestrator stays Node |

---

## 14. Governance & Change Control

This TDR is governed by the same rules as the ADRs it indexes:

1. **ADRs win.** This document is a consolidation; any apparent conflict with a ratified ADR is resolved in the ADR's favor. The ADR set lives in `/Decisions/` (ADR-001…ADR-022, with ADR-006 superseded by ADR-021 and ADR-008 superseded by ADR-022).
2. **Changes require an ADR.** Any new technology of consequence (a new store, a new runtime, a new broker, replacing Kong/Istio/Keycloak/Vault, re-introducing a deferred store) requires an ARB-approved ADR — not an edit to this document.
3. **Deferred-store re-introduction is ADR-gated but trigger-driven.** ClickHouse/Elasticsearch return when their measurable trigger fires (ADR-022 §2.3); the ADR records the trigger event and the scope.
4. **Polyglot discipline.** Any new non-Node service requires an ARB-approved ADR (ADR-021 §2.3). The two Python ML tiers are the only documented exception.
5. **Quarterly review.** The ARB reviews this TDR quarterly and after any material ADR, to keep the consolidation honest. The ADR table in `01_Master_Architecture.md` §13 is the live status; this document is the narrative.
6. **Legacy drafts are non-canonical.** v1.0.0 drafts in `Architecture/`, `Database/`, `Security/`, `Domain/`, `API/`, `Diagrams/`, `docs/`, and `README.md` still name Kotlin/Go + 8 stores (`01` Appendix B F-12). They are superseded; do not make decisions from them.

---

## 15. Traceability

| Decision (this TDR §) | Governing ADR / Reference | Foundation link |
|---|---|---|
| §1 Backend Framework / Runtime | **ADR-021** (supersedes ADR-006); `01` §4.1, §13 | BG-3, BG-8; Simplicity + Trust pillars |
| §2 Database | **ADR-022** (supersedes ADR-008); **ADR-007** (expanded); `01` §4.2, §4.5 | BG-3, BG-5, BG-7 |
| §3 ORM / Data Access | ADR-021 §2.1 (`knex`); ADR-022 §4 (no ORM magic) | BG-3, Clean Architecture |
| §4 Message Broker | **ADR-002** (Kafka backbone); **ADR-022** §2.1 (RabbitMQ task queue) | ADR-001 (ES replay); BG-3 |
| §5 Cache | ADR-022 §2.1 (Redis kept); resolves ARR SEC-6 (revocation fail-mode) | BG-5; tracking freshness SLO |
| §6 Storage (Object) | ADR-022 §2.1 (S3/MinIO); `01` §4.5 invariant #6 (cold tier) | BG-3, BG-5 (crypto-shredding) |
| §7 Real-time Communication | **ADR-015** (Socket.IO canonical); resolves ARR ARCH-3 | Trust; real-time SLO |
| §8 Video Infrastructure | **ADR-013** (Media context); ADR-021 §5 (infra-class media router); ADR-021 §2.2 (Python AI) | BG-4 (Intelligence pillar) |
| §9 Cloud Infrastructure | `01` §10; ADR-005 (Istio), ADR-009 (Keycloak+OPA) | BG-3, BG-5, BG-7 |
| §10 CI/CD | **ADR-010** (GitOps/ArgoCD); `01` §10.2; SOC2 CC8.1 | BG-8 (20+ deploys/wk, < 5% failure) |
| §11 Monitoring | **ADR-011** (OpenTelemetry); `01` §11 | Quality targets (`00` §8.3) |
| §12 Logging | ADR-011 + ADR-022 §2.2 (Loki replaces ES for logs) | BG-3, BG-5 (PII redaction) |

---

*This Technology Decision Record consolidates FleetVision's technology choices in one board-readable place. It is a restatement, not a source of authority — the ADRs in `/Decisions/` and `01_Master_Architecture.md` §4/§13 are authoritative. Reviewed by the ARB; any change to a decision below requires a new or amended ADR.*
