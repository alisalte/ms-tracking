# ADR-022: Lean Persistence — PostgreSQL / TimescaleDB / Redis / S3 (+ Kafka backbone)

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Chief Software Architect, ARB
**Supersedes:** ADR-008 (Polyglot Persistence Strategy — 8 stores)
**Superseded by:** —
**Related:** ADR-007 (PostgreSQL 16 as primary OLTP — **preserved, expanded role**), ADR-002 (Kafka — preserved), ADR-021 (Node runtime — same session), ADR-019 (reconciliation baseline)

---

## 1. Context

ADR-008 adopted an 8-store polyglot persistence strategy: PostgreSQL, TimescaleDB, MongoDB, Redis, Kafka, ClickHouse, Elasticsearch, and S3. The ARB has decided to **consolidate to a leaner 4-store (+ Kafka) footprint** to reduce operational complexity and cost-per-vehicle (BG-3), consistent with the single-runtime consolidation in ADR-021.

This ADR records the consolidation. Per ADR-019 precedent, ADR-008 is **superseded, not edited**. ADR-007 (PostgreSQL as primary OLTP) is **preserved and its role expanded** — it absorbs workloads previously assigned to MongoDB.

### 1.1 Baseline being changed

| Store (prior, ADR-008) | Role | Status after this ADR |
|---|---|---|
| PostgreSQL 16 | Primary OLTP, event store, geospatial | **Kept — role expanded** (absorbs document workloads via JSONB) |
| TimescaleDB | Time-series: GPS, telemetry | **Kept** |
| MongoDB 7 | Documents: device configs, profiles, DVIR | **Removed** → PostgreSQL JSONB |
| Redis 7 | Cache, sessions, rate limiting, pub/sub | **Kept** |
| Apache Kafka | Event backbone, ES replay, CDC | **Kept** (per ADR-002; primary broker) |
| ClickHouse | OLAP analytics, aggregated reporting | **Deferred** (see §2.3) |
| Elasticsearch 8 | Full-text search, log aggregation | **Deferred** (see §2.3) |
| S3 / MinIO | Object storage | **Kept** |
| **+ RabbitMQ** | (not in ADR-008) | **Added** — task/work queue (see ADR-021 §5 and `01` §6) |

## 2. Decision

### 2.1 The lean store set

| Store | Version | Architectural role | Multi-tenant strategy |
|---|---|---|---|
| **PostgreSQL 16** | + PostGIS, pg_partman, pgvector | **System of record**: OLTP, event store (ES aggregates), geospatial (PostGIS), and **document storage (JSONB)** for device configs / driver profiles / DVIR detail / POD | 3-tier per ADR-003: dedicated instance / dedicated schema / shared+RLS |
| **TimescaleDB** | PG extension | Time-series: GPS positions, telemetry, IO. Compressed hypertables. | Per-tenant partitioning |
| **Redis 7** | cluster mode | Hot path: latest vehicle position, sessions, rate limits, pub/sub, command idempotency | Namespace per tenant |
| **Apache Kafka** (MSK) | — | Event backbone, outbox relay, CDC, **replay for Event Sourcing (ADR-001/002)** | Per-tenant partition key, ACL per topic |
| **S3 / MinIO** | S3-compatible | Objects: firmware, video segments, exports, backups | Bucket / prefix per tenant, SSE-KMS |
| **RabbitMQ** | — | **Transient task/work queues** (report rendering, notification dispatch, batch jobs). No persistence guarantee beyond task lifetime; **not** an event-store and **not** used for state changes. | Per-tenant virtual host |

> **Two brokers, two jobs.** Kafka (ADR-002) is the **event backbone** — domain events, ES replay, cross-context coordination. RabbitMQ is the **task queue** — short-lived work items that do not need replay. Mixing these would either lose replay (RabbitMQ as backbone) or over-engineer simple jobs (Kafka for transient tasks). See `01` §6 for the routing rule.

### 2.2 Workload relocation

Where ADR-008's removed/deferred stores were used, the workloads move as follows:

| Workload (ADR-008 store) | New home | Why it works |
|---|---|---|
| Device configs, driver profiles, DVIR detail, POD (MongoDB) | **PostgreSQL JSONB columns** with GIN indexes | These are aggregate-owned documents, not wide-schemaless collections. JSONB keeps them transactional with their parent aggregate (no cross-store consistency), supports partial/flexible schema, and GIN handles the query patterns. Eliminates a whole store and a consistency boundary. |
| Aggregated OLAP / fast analytics (ClickHouse) | **TimescaleDB continuous aggregates** for time-series rollups; **PostgreSQL materialized views** for dimensional rollups (Phase 1–3 scale) | At Year-1–3 scale (50K–500K vehicles), Timescale's continuous aggregates + Postgres materialized views meet the analytics SLAs without a separate OLAP store. See §2.3 for the Year-5 trigger. |
| Full-text search (Elasticsearch) | **PostgreSQL `pg_trgm` + `tsvector`/`tsquery` (GIN)** | Vehicle/driver/device search at the platform's MVP–Phase-3 scale is well within Postgres FTS capabilities. Elasticsearch is re-introduced only when query volume or relevance demands it (§2.3). |
| Log aggregation (Elasticsearch/ELK) | **Loki** (already in the observability stack, ADR-011) | Logs already route to Loki per `01` §11. Removing ES eliminates a duplicate log store. |

### 2.3 Deferred stores — explicit re-introduction triggers

The deferred stores are **not canceled**; they are paused with explicit, measurable triggers that re-introduce them. This converts "we dropped ClickHouse" into "ClickHouse returns when its trigger fires", avoiding both premature complexity and silent scaling ceilings (BG-7 — scale without re-platforming).

| Store | Re-introduction trigger | Threshold (measurable) | Owner of the trigger review |
|---|---|---|---|
| **ClickHouse** | Analytics query latency or rollup cost exceeds budget | Any dashboarding query P99 > 2s, **or** Timescale continuous-aggregate storage > 40% of cluster, **or** Year-5 scale band (≥ 1M vehicles) approaching | Analytics team + ARB |
| **Elasticsearch** | Full-text search volume or relevance exceeds Postgres FTS | Search QPS > 200 sustained, **or** relevance/typo-tolerance requirements unmet by `pg_trgm` | Search team + ARB |
| **MongoDB** | (none planned) | — | Not anticipated; JSONB covers the documented workloads. A future ADR would be required to re-introduce. |

> **Why defer rather than reject.** The vision's Year-5 target is 2M vehicles / 600K GPS ev/s (`00_Project_Vision.md` §8.1). Postgres+Timescale handles the *transactional + time-series + basic OLAP* load across that range; the *pure OLAP at scale* and *high-QPS relevance search* loads are the ones that may eventually demand a specialty store. Deferring with triggers keeps the lean footprint now while preserving a documented, non-replatforming growth path — consistent with the vision's reversibility guardrail (§9).

### 2.4 Architectural invariants (carried forward from ADR-008, restated)

1. **One writer per aggregate's event stream** — Kafka ACL enforced (same as `01` §3.2 invariant #2).
2. **No cross-context joins** — a service reads only its own store; cross-context data arrives as an event-fed projection.
3. **Tenant isolation mandatory at every store** — RLS (Postgres), namespacing (Redis), partition keys (Kafka), prefixes (S3), vhosts (RabbitMQ). A tenant-isolation breach is SEV-1.
4. **Retention explicit per store** — Kafka raw 3d / domain 7–30d; Timescale compressed months; audit permanent; S3 lifecycle per object class. Detail in `03_Database_Architecture.md`.
5. **Object storage is the cold tier** — video, firmware, exports, backups live in S3, never in a database.

## 3. Why (rationale tied to the vision)

| Reason | Vision link |
|---|---|
| **Fewer stores = lower ops cost and cost-per-vehicle** | BG-3 (<$1/vehicle/month by Y5). Each store has its own backup, monitoring, patching, on-call, and failure mode. 4 stores + Kafka + RabbitMQ is materially cheaper to run than 8. |
| **JSONB removes a consistency boundary** | Removing MongoDB means device configs/DVIR/POD are transactional with their aggregate — no cross-store saga for what should be a single write. Strengthens the *Trust* pillar (BG-5). |
| **Postgres FTS + Timescale aggregates cover MVP→Phase-3 analytics** | The deferred stores' workloads are not felt until Year-3+ scale; building them now is premature optimization that contradicts the phased roadmap (vision §7). |
| **Triggers, not deletions, for the deferred stores** | BG-7 (scale without re-platforming). The growth path is documented and measurable, not hand-waved. |
| **RabbitMQ right-sizes the task workload** | Report rendering, notification fan-out, and batch jobs are *tasks*, not *events*. Using Kafka for them either loses per-task semantics or pollutes the event backbone. A dedicated task queue is the cleaner fit. |

## 4. Alternatives Considered

| Alternative | Outcome |
|---|---|
| **Keep all 8 stores (status quo, ADR-008)** | Rejected — ARB decision to consolidate; the operational and cost weight of 8 stores is not justified at MVP→Phase-3 scale, and JSONB + Postgres FTS cover the removed stores' workloads. |
| **Drop everything to Postgres-only (no Timescale, no Redis)** | Rejected — TimescaleDB is load-bearing for 600K ev/s time-series (compression, continuous aggregates, retention); Redis is load-bearing for sub-ms latest-position and rate limiting. Both stay. |
| **Use Kafka Streams for task queues instead of RabbitMQ** | Rejected — Kafka is the wrong primitive for transient per-task work items (delayed retry, per-consumer ack, dead-letter). RabbitMQ is purpose-built for it. |
| **Re-introduce MongoDB instead of JSONB** | Rejected — the document workloads are aggregate-owned and benefit from transactional co-location with their parent aggregate. MongoDB would re-introduce a consistency boundary for no gain. |
| **Adopt ClickHouse now (don't defer)** | Rejected as premature — at Year-1 scale the analytics load is comfortably served by Timescale continuous aggregates + Postgres materialized views. The trigger (§2.3) brings ClickHouse back when justified. |

## 5. Consequences

**Positive:**
- 4 stores + 2 brokers instead of 8 stores + 1 broker → simpler ops, smaller blast radius per failure, lower cost-per-vehicle (BG-3).
- Document workloads become transactional with their aggregate (no cross-store saga) → stronger consistency, simpler code.
- One search engine to operate (Postgres FTS) for MVP→Phase-3; Loki already owns logs.
- Explicit, measurable re-introduction triggers protect the Year-5 scale path without premature complexity.

**Negative:**
- **PostgreSQL bears more load** — OLTP + event store + geospatial + document (JSONB) + FTS. Mitigation: schema-per-aggregate isolation, PgBouncer connection pooling, read replicas, Timescale for time-series offload, and the ClickHouse trigger (§2.3) before OLAP pressure becomes structural.
- **Postgres FTS is weaker than Elasticsearch** for typo-tolerance, relevance tuning, and very-high QPS. Acceptable through Phase-3; the trigger (§2.3) restores ES when needed.
- **Migration cost**: the document workloads currently specced for MongoDB in `02_Domain_Model.md` / `03_Database_Architecture.md` move to JSONB. Tracked in `01` Appendix B; spec changes are mechanical (column type + GIN index), not redesigns.
- **Two brokers** to operate (Kafka + RabbitMQ). Justified by their distinct jobs (§2.1); the alternative — Kafka for tasks — was rejected (§4).

**Neutral / carried forward:**
- ADR-007 (PostgreSQL as primary OLTP) — **preserved and expanded** (now also the document store).
- ADR-003 (multi-tenant 3-tier isolation) — preserved; the per-store isolation strategies in §2.1 implement it.

## 6. Explicit Non-Changes

- ADR-007 (PostgreSQL 16 primary OLTP) — preserved; role expanded to documents.
- ADR-002 (Kafka backbone) — preserved; primary broker.
- ADR-003 (multi-tenant 3-tier isolation) — preserved.
- The **aggregate inventory** in `02_Domain_Model.md` — unchanged; only the *storage mapping* per aggregate changes (MongoDB → JSONB).
- The **15 bounded contexts** — unchanged; storage decision, not domain decision.

## 7. Audit Trail

| Date | Event |
|---|---|
| 2026-08-02 | ADR-008 Accepted (8-store polyglot persistence). |
| 2026-08-02 | ADR-019 recorded the polyglot baseline. |
| 2026-08-02 | ARB decides to consolidate; **this ADR-022 Accepted**, supersedes ADR-008. |
| 2026-08-02 | `01_Master_Architecture.md` §4.2, §4.4, §4.5, §6 updated; §13 ADR table marks ADR-008 **Superseded by ADR-022**. `03_Database_Architecture.md` reconciled in a follow-up (Appendix B). |
