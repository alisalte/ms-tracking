# ADR-021: Node.js LTS + NestJS + TypeScript as the Primary Runtime

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Chief Software Architect, ARB
**Supersedes:** ADR-006 (Spring Boot 3.3 + Kotlin for Core Microservices)
**Superseded by:** —
**Related:** ADR-019 (reconciliation — corrected the polyglot baseline to 15 Kotlin / 3 Go / 2 Python), ADR-001 (CQRS + Event Sourcing — preserved, language-agnostic), ADR-002 (Kafka — preserved), ADR-022 (lean persistence, same session)

---

## 1. Context

ADR-006 selected Spring Boot 3.3 + Kotlin as the primary runtime, with documented exceptions for Go (high-concurrency ingestion) and Python (ML). Following an ARB-level review of the technology foundation, the runtime decision is being **reversed and replaced**. This ADR records the replacement; it does not edit ADR-006 in place (per the precedent set by ADR-019 §6: prior Accepted ADRs are not rewritten, they are superseded).

The baseline being changed, as corrected by ADR-019 finding **R3**, is:

| Runtime (prior, per ADR-006 + ADR-019 R3) | Services |
|---|---|
| Kotlin / Spring Boot | 15 |
| Go 1.22 (ingestion / streaming) | 3 — `device-gateway-service`, `telemetry-ingestion-service`, `media-streamer` |
| Python 3.12 (ML) | 2 — `video-ai-engine`, `analytics-engine` |
| **Total** | **20** |

The architecture principles in the project rules — **Clean Architecture, DDD, CQRS, Event-Driven Architecture** — are language-agnostic. ADR-001 (CQRS + Event Sourcing), ADR-002 (Kafka backbone), ADR-004 (sync gRPC + async Kafka), and ADR-005 (Istio mesh) are all **preserved unchanged**. Only the application runtime changes.

## 2. Decision

### 2.1 Primary runtime — Node.js LTS + NestJS + TypeScript

**Node.js LTS + NestJS + TypeScript** is the primary runtime for **18 of 20 services** — i.e. every service *except* the two ML tiers covered by §2.2. This replaces both the Kotlin and Go runtimes from ADR-006; Go is no longer used on the platform.

| Concern | Selection |
|---|---|
| Runtime | **Node.js LTS** (Active LTS track; upgraded on each LTS release) |
| Framework | **NestJS** (modular, DI-first, opinionated — maps cleanly to DDD modules and Clean Architecture layers) |
| Language | **TypeScript** (strict mode; `strictNullChecks`, `noImplicitAny`) |
| Package manager | pnpm (workspace monorepo) |
| Inter-service contract | gRPC via `@grpc/grpc-js` + `buf`-generated TS (ADR-004 preserved) |
| Event client | `kafkajs` (Avro via `@avro/types`) — ADR-002 preserved |
| Real-time | Socket.IO (Node) + WebRTC — ADR-015 preserved |
| CQRS / Event Sourcing | In-repo framework (NestJS modules): command bus, event store on PostgreSQL, outbox table, projections — ADR-001 preserved |
| Validation | `class-validator` + `zod` at trust boundaries |
| ORM | No heavy ORM. `knex` (query builder) for aggregate-aligned SQL; raw SQL for hot paths. **JPA/Hibernate-equivalent magic is explicitly rejected** (matches ADR-006 §"Rejected Alternatives" philosophy). |
| Testing | Jest + Supertest (integration); Testcontainers; `pact` (consumer-driven contracts) |
| Observability | `@opentelemetry/api` + `@opentelemetry/auto-instrumentations-node` — ADR-011 preserved |

### 2.2 Python exception — ML tiers only

**Python 3.12 is retained for exactly two services:** `video-ai-engine` (#12) and `analytics-engine` (#19). This is the documented polyglot exception required to honor **Business Goal BG-4** (AI dashcam leadership, predictive maintenance) and the **Intelligence** pillar of `00_Project_Vision.md` §2 — the Node.js ML ecosystem (ONNX Runtime, TF.js) is materially weaker than Python's for training, experimentation, and the computer-vision workloads these two services perform.

The Python services are bounded the same way as in ADR-006: they expose versioned **gRPC** contracts (inference, scoring) and consume/produce only **Kafka events**; they never share a database or internal library with a Node service. This keeps the polyglot surface to two services, not a slippery slope.

### 2.3 Polyglot discipline (revised)

| Runtime | Services | Count | Rule |
|---|---|---|---|
| **Node.js LTS / NestJS / TS** | All except the two ML tiers | **18** | Default; no ADR needed |
| **Python 3.12** | `video-ai-engine`, `analytics-engine` | **2** | Permitted only for ML/CV workloads (BG-4) |
| ~~Kotlin / Spring Boot~~ | — | 0 | **Retired by this ADR** |
| ~~Go~~ | — | 0 | **Retired by this ADR** (ingestion/streaming now Node) |

> Any new non-Node service requires an ARB-approved ADR — the same governance rule as ADR-006, restated. The intent is a single primary runtime; the Python exception exists to protect BG-4, not to generalize polyglot.

## 3. Why (rationale tied to the vision)

| Reason | Vision/Architecture link |
|---|---|
| **One runtime reduces operational and cognitive surface** | A single hire pool, single observability story, single build pipeline, shared libraries — directly lowers cost-per-vehicle (BG-3) and increases engineering velocity (BG-8). |
| **NestJS maps naturally to Clean Architecture + DDD** | Modules = bounded contexts; providers/use-cases = application layer; controllers = interface layer; repositories = infrastructure. No translation tax between the architecture in `01`/`02` and the code. |
| **First-class TypeScript across stack and front-end** | The web (`React 18 + TS`) and mobile (`React Native + TS`) clients already use TS. A TS backend shares types end-to-end via the `fleetvision-proto` and shared DTO packages — fewer contract drift bugs, faster delivery (BG-8). |
| **Node's async I/O model fits the platform's dominant workload** | The highest-volume paths are I/O-bound: device TCP termination, telemetry normalization, Kafka fan-out, WebSocket fan-out, Redis latest-position reads. Node's event loop is well-suited to these; the prior stack needed Go specifically for this reason — Node lets us collapse two runtimes into one. |
| **Event-driven + CQRS are runtime-neutral** | ADR-001 and ADR-002 are preserved. NestJS modules implement the command bus, outbox, and projections; the event store remains PostgreSQL; the backbone remains Kafka. |

## 4. Alternatives Considered

| Alternative | Outcome |
|---|---|
| **Keep Kotlin/Spring Boot (status quo, ADR-006)** | Rejected — ARB decision to consolidate to a single primary runtime. The JVM's strengths (compute density for pure CPU) are not the platform's bottleneck; I/O concurrency is, and Node serves it without a second runtime. |
| **Node + Python for everything, drop the ML exception** | Rejected — would weaken BG-4 (AI dashcam, predictive maintenance). Python's training/CV ecosystem has no Node equivalent; faking it in Node would slow the Intelligence pillar. |
| **Node + Go (keep Go for ingestion)** | Rejected — preserves a second runtime for a marginal concurrency gain that Node's I/O model already covers at the platform's scale (15K ev/s Year-1, 600K ev/s Year-5 target, horizontally scaled across pods, not single-node). Adds operational surface for no net benefit. |
| **Pure Node + ONNX Runtime for ML** | Rejected for training/iteration (see §2.2); ONNX Runtime *may* still be used for inference deployment inside `video-ai-engine`, but model development stays Python. |

## 5. Consequences

**Positive:**
- Single primary runtime → one hire pool, one build/test/observability pipeline, shared TS types across client and server.
- NestJS's module system enforces bounded-context isolation at the framework level (matches `02_Domain_Model.md`'s context boundaries).
- Front-end and back-end share DTO/proto types → fewer contract-drift bugs (supports BG-8, BG-6).
- Two runtimes instead of three → lower operational cost (supports BG-3).

**Negative:**
- **CPU-bound workloads** (heavy geospatial computation, large report rendering, ML inference *outside* the two Python services) must be offloaded — either to worker threads, to a Python sidecar, or to a dedicated compute service. Mitigation: the platform's CPU-bound hot spots (report generation, route simplification) are already batch/asynchronous and fit the task-queue model (ADR-022 adds RabbitMQ for this — see `01` §6).
- **Migration cost**: the 18 affected services' implementations move from Kotlin/Go to TS. This ADR governs the *decision*; the migration itself is phased per the vision roadmap and tracked in `01` Appendix B.
- A smaller "enterprise JVM" talent signal than Kotlin/Spring — offset by a much larger TS/Node talent pool and the end-to-end TS benefit.

**Neutral / carried forward:**
- CQRS + Event Sourcing (ADR-001), Kafka backbone (ADR-002), gRPC+Kafka comms (ADR-004), Istio mesh (ADR-005), GitOps (ADR-010), OpenTelemetry (ADR-011) — all **unchanged**; they are language-agnostic and remain in force.

## 6. Explicit Non-Changes

To prevent scope creep, this ADR **does not** change:
- ADR-001 (CQRS + Event Sourcing) — preserved; implemented in TS via in-repo NestJS modules.
- ADR-002 (Kafka backbone) — preserved.
- ADR-004 (gRPC sync + Kafka async) — preserved; gRPC clients generated to TS via `buf`.
- ADR-005 (Istio mesh) — preserved; mesh is runtime-agnostic.
- ADR-009 (Keycloak + OPA) — preserved.
- ADR-010 (ArgoCD GitOps), ADR-011 (OpenTelemetry) — preserved.
- The **20-service registry** in `01` §3 — unchanged in count; only the *Language* column changes.
- The **15 bounded contexts** in `00_Project_Vision.md` §6 — unchanged; this is a technology decision, not a domain-modeling decision.

## 7. Audit Trail

| Date | Event |
|---|---|
| 2026-08-02 | ADR-006 Accepted (Kotlin/Spring Boot + Go + Python exceptions). |
| 2026-08-02 | ADR-019 R3 corrected polyglot arithmetic to 15 Kotlin / 3 Go / 2 Python. |
| 2026-08-02 | ARB reverses the runtime decision; **this ADR-021 Accepted**, supersedes ADR-006. |
| 2026-08-02 | `01_Master_Architecture.md` §2, §3, §4 updated to reflect Node/NestJS/TS; §13 ADR table marks ADR-006 **Superseded by ADR-021**. |
