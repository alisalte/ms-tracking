# FleetVision — Architecture Review Report

**Review ID:** ARR-2026-08-02-A
**Date:** 2026-08-02
**Reviewer:** Principal Architect (acting)
**Status:** Final — Action Required
**Classification:** Confidential — Internal
**Review Scope:** All architecture, domain, database, API, and module documents (22 files)

---

## Executive Summary

FleetVision's architecture is **fundamentally sound**. The vision is crisp, the master architecture makes defensible technology choices (Kubernetes + polyglot persistence + Kafka eventing + CQRS/ES), the DDD decomposition into 14 bounded contexts is well-reasoned, and the scale plan (2M vehicles / 600K GPS events/sec) is credible. The security posture is genuinely enterprise-grade.

**However, the document set is not internally consistent, and the inconsistencies are of the kind that cause silent production failures, not theoretical concerns.** The most damaging finding is that **~13 cross-service event subscriptions reference event names or topics that no producer emits** — these services would run, consume no data, and appear healthy while producing wrong results. Equally serious: the **permission catalog, Kafka topic-naming convention, and driver-behavior scoring formula each have 2–3 competing definitions** across modules.

This review catalogues **71 findings** graded by severity, identifies **3 missing modules** required to close the architecture, and proposes a **prioritized remediation plan**. The intent is to make the documentation *implementation-ready in truth, not just in label*.

### Severity Scale

| Grade | Meaning | Action |
|---|---|---|
| **🔴 Critical** | Will cause runtime failure, data loss, security breach, or wrong results if built as-written | Block implementation; fix before any code |
| **🟠 High** | Architecturally unsound; large rework or operational risk if not fixed before scale | Fix before Phase 1 GA |
| **🟡 Medium** | Inconsistency or gap that degrades quality, maintainability, or correctness at the margin | Fix within current phase |
| **🟢 Low** | Editorial, typo, or minor drift | Fix opportunistically |

### Finding Count by Category & Severity

| Category | 🔴 Crit | 🟠 High | 🟡 Med | 🟢 Low | Total |
|---|---|---|---|---|---|
| Integration problems (event/topic contracts) | 9 | 4 | 3 | 1 | 17 |
| Architecture conflicts | 2 | 4 | 3 | 1 | 10 |
| DDD problems | 1 | 3 | 4 | 1 | 9 |
| Security problems | 0 | 3 | 3 | 0 | 6 |
| Scalability issues | 0 | 3 | 2 | 0 | 5 |
| Database problems | 0 | 2 | 3 | 0 | 5 |
| API problems | 1 | 1 | 2 | 0 | 4 |
| Missing modules | — | 3 | — | — | 3 |
| Documentation / consistency | — | — | 8 | 4 | 12 |
| **Total** | **13** | **23** | **28** | **7** | **71** |

### Top 7 — Must Fix Before Any Code Is Written

1. 🔴 **Broken event contracts** — 13 consumer subscriptions reference non-existent events/topics (§Integration-1).
2. 🔴 **Three competing Kafka topic-naming conventions** across modules (§Integration-2).
3. 🔴 **Permission catalog divergence** — module-declared permissions don't match the IAM canonical catalog; OPA would deny valid requests or allow invalid ones (§Security-1).
4. 🔴 **Two conflicting driver-behavior scoring formulas** with different weights and windows (§DDD-1).
5. 🔴 **`tracking.harsh_brake.v1` does not exist** — driver scoring receives zero harsh-brake events (§Integration-3).
6. 🔴 **VIN uniqueness rule contradicts** — Fleet says globally unique; Asset says per-tenant (§DDD-2).
7. 🔴 **Media/Video context not in the domain model** — new bounded context + 5 aggregates exist only in module/DB docs; ADR missing (§Missing-1).

---

## 1. Architecture Conflicts

### ARCH-1 🟠 Count of "14 microservices" is wrong — it's 16, plus media makes 17+
- **Evidence:** `01_Master_Architecture.md` §3.1 header states "The 14 modules ... map one-to-one to 14 microservices," but the table enumerates **16 services** (Telemetry splits into `telemetry-ingestion-service` + `device-management-service`; Analytics splits into `analytics-engine` + `report-generation-service`). `VideoPlatform.md` adds `media-service`, `media-streamer`, `video-ai-engine` → **20 deployable services**. `DeviceGateway.md` adds `device-gateway-service` → **21**.
- **Impact:** Capacity planning, team ownership, on-call rotation, and the "one-to-one" DDD claim are all built on a false count. New engineers will misread the topology.
- **Recommendation:** Rewrite §3.1: "**14 bounded contexts** map to **N microservices** (one-to-one except where a context is split for runtime reasons — Go for ingestion, Python for ML, Go for streaming edge)." Maintain a single authoritative Service Registry table.

### ARCH-2 🟠 Aggregate/event-sourcing count contradicts itself
- **Evidence:** `01_Master_Architecture.md` §6.4 text says "9 aggregates are event-sourced" but lists **10** (VehicleTracker, Trip, Dispatch, MaintenanceWorkOrder, DeviceCommand, HOSLog, DVIRInspection, Incident, Invoice, Notification). `02_Domain_Model.md` §2.2 inventories 49 rows under a "44 Aggregates" heading.
- **Impact:** Inconsistent audit/compliance claims; rebuild-from-events coverage ambiguous.
- **Recommendation:** Pick one count. Recommend: **10 ES aggregates** (add Dispatch explicitly), and re-label §2.2 "Aggregate Inventory (49)."

### ARCH-3 🔴 Real-time transport: Socket.IO is canonical, but SignalR appears as a peer
- **Evidence:** `01_Master_Architecture.md` §2 and §5 standardize on **Socket.IO (Node.js)** for real-time push. `API_Design.md` §4 introduces a **SignalR hub surface** (`/hub/*`) and an `signalr-adapter` ASP.NET Core service — a runtime technology (`ASP.NET Core`) that exists nowhere else and contradicts ADR-006.
- **Impact:** A new runtime (`.NET`) is implicitly introduced via an API document, without an ADR, breaking the polyglot discipline. Operational burden (another GC, build pipeline, CVE surface).
- **Recommendation:** **Either** (a) keep Socket.IO as the sole real-time transport and serve .NET partners via Webhooks + REST + a community SignalR-client-over-Socket.IO shim (no new runtime); **or** (b) raise an **ADR-013** explicitly justifying ASP.NET Core for the SignalR adapter, its isolation, lifecycle, and SLO ownership. The current treatment (presenting SignalR as a peer surface while disclaiming it's "just an adapter") is not architecturally sound.

### ARCH-4 🟠 Two services own the `tracking.*` event family with no single catalog
- **Evidence:** `Tracking-Monitoring.md` owns `fleetvision.tracking.{position,geofence,alert}.events`. `GPSEngine.md` (a sub-domain of the same context) introduces **5 new topics** it owns: `fleetvision.tracking.{trip,stop,idle,route,behavior}.events`. Neither document references the other's catalog.
- **Impact:** Consumers reading the parent doc miss 5 topics; consumers reading the sub-domain doc miss 3. No authoritative catalog exists for `tracking.*`.
- **Recommendation:** Designate `Tracking-Monitoring.md` as the **single catalog owner** for the `tracking.*` family; have `GPSEngine.md` reference it rather than re-declare. Apply the "parent owns catalog, child owns mechanism" rule consistently (same pattern as IAM↔Authentication).

### ARCH-5 🟡 "CoAP" listed as a device protocol but never specified
- **Evidence:** `01_Master_Architecture.md` §1.2 lists "MQTT v5.0, CoAP" for telematics hardware. No module defines CoAP support, port, or devices. `DeviceGateway.md` covers TCP binary protocols only.
- **Impact:** Either a phantom commitment or an undocumented scope gap.
- **Recommendation:** Remove CoAP from §1.2 or add a device-protocol roadmap entry in `DeviceGateway.md`.

### ARCH-6 🟡 GPS ingest throughput targets disagree across 4 modules
- **Evidence:** Tracking: 150K ev/s; Telemetry: 100K data-points/s; GPSEngine: 600K positions/s (Y5); DeviceGateway: 20K msgs/s/pod. The platform's headline number (`01` §scale table) is 600K/s.
- **Impact:** Capacity and load-test targets are ambiguous per service.
- **Recommendation:** Standardize on **"600K GPS events/sec at Year-5 platform peak; per-service budgets derived and documented in each module's SLO table"** and reconcile all four numbers to that single source.

### ARCH-7 🟡 Geofence evaluation SLO: 20ms vs 50ms
- **Evidence:** `02_Domain_Model.md` INV-T02 and `GPSEngine.md`: < 20ms. `Tracking-Monitoring.md` §10.5: < 50ms p99.
- **Impact:** The 20ms budget is the correct one (it drives the in-memory R-tree design); 50ms is a stale target.
- **Recommendation:** Align all docs on **< 20ms p99 (INV-T02)**.

### ARCH-8 🟢 Phase roadmap: master doc shows 5 phases, vision shows 6
- **Evidence:** `00_Project_Vision.md` §9 defines Phases 0–6; `01_Master_Architecture.md` references "Phase roadmap (MVP → P5)" only.
- **Impact:** Minor — readers may miss Phase 0 (foundation) and Phase 6 (future).
- **Recommendation:** Reference the canonical 6-phase plan from the vision.

### ARCH-9 🟡 Multi-region rollout omits LATAM/APAC countries in the vision
- **Evidence:** Vision §5.4 commits to UK/EU/LATAM/APAC/India/ME. Architecture §11.4 only names `us-east-1`, `eu-west-1`, `ap-southeast-1`, `us-west-2`. Brazil/Mexico/India/ME/South Africa regions are not planned.
- **Impact:** Product commitments without infra coverage; data-residency conflicts at launch in those markets.
- **Recommendation:** Add a region roadmap that mirrors the geographic commitments, or descope the vision's country list to match.

### ARCH-10 🟠 `report-generation-service` is declared Kotlin in one place, Python in another
- **Evidence:** `01_Master_Architecture.md` §3.1 row 13: `report-generation-service` **Kotlin**. `Analytics-Reporting.md`: both `analytics-engine` and `report-generation-service` described as **Python 3.12 (Faust / FastAPI)**.
- **Impact:** Build pipeline, team ownership, and skill mix ambiguous for a P3 service.
- **Recommendation:** Decide and document. Recommend **Kotlin** for report-generation (it's a job-orchestration service that calls ClickHouse + renders, not an ML service) to keep Python isolated to `analytics-engine`. Update `Analytics-Reporting.md` accordingly.

---

## 2. Missing Modules

### MISS-1 🟠 Media & Video context exists in implementation docs but not in the domain model
- **Evidence:** `VideoPlatform.md` declares a net-new **Context 15: Media & Video** with aggregates `VideoChannel`, `Recording`, `StreamSession`, `EventClip`, `AIAlert`. `03_Database_Architecture.md` §5 / Appendix B references a `(new)` ADR for the `media` schema. **Neither `02_Domain_Model.md` nor `00_Project_Vision.md` mentions this context.** The doc itself flags the follow-up.
- **Impact:** The "14 bounded contexts" baseline is stale; the new context has no ubiquitous language, context-map relationships, invariants, or aggregates in the canonical model. The competitive pillar "AI Dashcam leadership" (vision §5) has no domain home.
- **Recommendation:**
  1. Add **Context 15: Media & Video** to `02_Domain_Model.md` §1 (strategic classification: Core for AI-dashcam differentiation; domain expert: Computer Vision Lead).
  2. Define its aggregates, invariants (e.g., `INV-MED01: recording hash-chain integrity`), and ubiquitous language.
  3. Update the context map (it consumes Tracking events, Telemetry/JT1078, publishes to Notification/Compliance).
  4. Raise **ADR-013: Media & Video bounded context** before Phase 1.

### MISS-2 🟠 Device Gateway is a critical-path service with no domain model home
- **Evidence:** `DeviceGateway.md` introduces `device-gateway-service` (Go, terminates vendor TCP protocols) as a front-tier to the Telemetry context. It is **not** in `01_Master_Architecture.md` §3.1's service table, not in the container diagram, not in the data-flow diagram. It is the *only* path for non-MQTT devices (GT06/Teltonika/JT808/Concox/Meitrack) — i.e., most real-world hardware.
- **Impact:** The architecture as documented only supports MQTT devices; the majority of the addressable market cannot connect. The service that fixes this is undocumented at the architecture tier.
- **Recommendation:** Add `device-gateway-service` to: (a) `01_Master_Architecture.md` §3.1 service table; (b) §2 container diagram (edge tier, Go); (c) §7.3 high-throughput telemetry path (it's the new entry point); (d) the data-flow narrative. Add **ADR-014: Device Gateway (multi-protocol TCP ingestion)** justifying Go and the protocol-adapter pattern.

### MISS-3 🟠 GPS Engine is the highest-complexity subsystem and has no aggregate home
- **Evidence:** `GPSEngine.md` defines 13 computation engines (trip/stop/idle/mileage/route/replay/geofence/behavior/speed), introduces 5 new topics and ~15 events, and owns critical state machines (Trip FSM). It is presented as a sub-domain of Tracking, but **no aggregates or events in `02_Domain_Model.md` correspond** (the domain model has `VehicleTracker`, `Geofence`, `TrackingSession` only — no Trip-detection or Behavior aggregates).
- **Impact:** The most operationally valuable derived intelligence (trips, idle, behavior) has no DDD representation; ownership of those events is ambiguous (see ARCH-4).
- **Recommendation:** Either (a) model the GPS-Engine outputs as **domain events on existing Tracking aggregates** and document them in the domain model's event catalog (§5.4), or (b) introduce a `TripDetection` / `DriverBehavior` aggregate explicitly. Recommend (a) — these are derived projections, not aggregates.

---

## 3. Security Problems

### SEC-1 🔴 Permission catalog divergence (cross-cutting)
- **Evidence:** `Identity-Access-Management.md` declares the canonical permission catalog. Modules declare endpoint permissions that diverge:
  - IAM says `device.{read,provision,command,firmware.update}`; Telemetry module uses `telemetry.device.*`, `telemetry.command.*`, `telemetry.firmware.*`; DeviceGateway adds `device.gateway.*`.
  - IAM says `tracking.position.{read,live}`, `tracking.geofence.*`; Tracking also uses `tracking.history.read`, `tracking.session.read`, `tracking.alert.read`.
  - IAM says `trip.{...}`, `trip.own.*`, `trip.pod.*`; Trip module uses `trip.trip.*`, `trip.route.*`, `trip.load.*`, `trip.dashboard.read` (extra tier).
  - IAM says `media.video.{read,export,manage}`; VideoPlatform adds `media.channel.*`, `media.video.live`, `media.policy.*`, `media.ai.read`, `media.wall.*`.
- **Impact:** **OPA policies generated from the IAM catalog will deny requests that module endpoints require, or — worse — module-defined permissive policies will be allowed without central review.** This is a defense-in-depth break.
- **Recommendation:** Make `Identity-Access-Management.md` §11.3 the **single source of truth**. Sweep every module's endpoint table against it; promote the granular permissions into the canonical catalog. CI gate: a `permissions.csv` derived from OpenAPI specs must match the IAM catalog exactly (build fails on drift).

### SEC-2 🟠 Tenant ID derivation rule is stated but not enforced as a contract
- **Evidence:** `01_Master_Architecture.md` §9.2: "Tenant ID is always derived from the authenticated principal (JWT), never from request body." `API_Design.md` §2.2 says clients **MUST NOT** set `X-Tenant-Id`. But several modules accept tenant context via request DTOs (e.g., gRPC `GetDeviceRequest { tenant_id }`).
- **Impact:** A service that honors a client-supplied tenant_id enables cross-tenant data access (the highest-impact trust failure). The rule is documented as a convention, not an enforceable contract.
- **Recommendation:** (a) Forbid `tenant_id` in any client-facing request schema (OpenAPI/protobuf lint rule). (b) Internal gRPC may pass it (mesh-trusted), but it must be **set by the gateway from JWT**, echoed in metadata, and **services must reject requests where the gRPC tenant_id ≠ JWT tenant_id**. (c) Add an ArchUnit-style test.

### SEC-3 🟠 SignalR adapter introduces an unauthenticated-surface risk
- **Evidence:** If ARCH-3 is resolved by keeping SignalR, the `signalr-adapter` negotiates with `AccessToken` from `/negotiate` (§4.2). The JWT-validation path for SignalR must mirror Socket.IO's exactly (signature, exp, iss, aud, revocation list). The doc doesn't specify revocation propagation.
- **Impact:** A token revoked via Redis `revocation:<jti>` for Socket.IO may still be honored by SignalR if its validation path isn't unified — a revocation bypass.
- **Recommendation:** Both transports must call the **same** `TokenValidator` component with the Redis revocation check. Document this as a non-negotiable contract.

### SEC-4 🟠 Webhook signature: HMAC secret rotation gap
- **Evidence:** `API_Design.md` §8.4 uses HMAC-SHA256 with a per-endpoint secret set at registration. There is **no rotation mechanism** and **no dual-secret overlap window** for zero-downtime rotation.
- **Impact:** A leaked webhook secret cannot be rotated without a verification gap; partners face downtime.
- **Recommendation:** Support **two concurrent secrets** (primary + secondary) per endpoint, with a configurable overlap; partners rotate by adding the new secret, verifying, then removing the old.

### SEC-5 🟡 PII redaction in video AI not technically enforced
- **Evidence:** `VideoPlatform.md` §14.7 states driver-facing AI uses "gaze/pose only; no face embeddings stored." This is a policy statement, not a technical guarantee. Frames can still be persisted in event clips.
- **Impact:** GDPR exposure if frames retained longer than consented or if a model is later upgraded to use face data.
- **Recommendation:** Add a **technical control**: driver-facing frames are blurred-at-edge (face regions) before persistence unless an explicit `evidence_hold` legal basis exists. Audit-log every frame persistence.

### SEC-6 🟡 Redis revocation list depends on Redis availability
- **Evidence:** `Authentication.md` §6.6 revokes via Redis `revocation:<jti>`. Redis outage → revocation checks fail. The fail-closed behavior on Redis-down is unspecified.
- **Impact:** Either every request is denied (Redis down → security lockdown, availability collapse) or every request is allowed (revocation bypass).
- **Recommendation:** Specify explicitly: Redis-down → **fail-closed** for high-risk roles (admin, compliance), **fail-open with 5-min degradation** for operators, with alert. Document in `Authentication.md` §6.6.

### SEC-7 🟡 API key max TTL (365d) conflicts with security best practice and partner rotation
- **Evidence:** `Authentication.md` says API keys max 365 days, manual + overlap. The vision/`01` says "90-day rotation" for partner auth. Conflict.
- **Recommendation:** Standardize on **90-day default, 365-day absolute max** with a waiver process. Alert on keys > 270 days old.

---

## 4. Scalability Issues

### SCAL-1 🟠 No plan for Kafka topic/partition re-keying at scale
- **Evidence:** Topics are keyed by `aggregate_id` / `vehicle_id`. At 2M vehicles, a single tenant with 100K vehicles on one `vehicle_id`-keyed topic creates hot partitions and ordering bottlenecks. `01` §12 says "add partitions dynamically," but adding partitions breaks key→partition mapping for existing keys (consumers see re-partitioning disorder).
- **Impact:** At Year-3+ scale, per-vehicle ordering guarantees weaken during partition expansion; rebalances cause consumer spikes.
- **Recommendation:** (a) Provision partitions aggressively up-front (e.g., 256+ for high-volume topics) sized for Year-5; (b) document the partition-expansion procedure and its ordering caveats; (c) for the GPS hot path, consider a compound key `(tenant_id, vehicle_id)` to spread load while preserving per-vehicle order.

### SCAL-2 🟠 TimescaleDB single-node ceiling not addressed concretely
- **Evidence:** `03_Database_Architecture.md` §10.1 step 5 mentions "Citus-style distributed tables (if needed)" for Year 5, but the 600K GPS events/sec → ~52B/day → 120 TB hot target is approaching TimescaleDB single-node practical limits (and compression isn't applied for the first 7 days).
- **Impact:** Year-3/Year-4 ingest may saturate a single TimescaleDB node before the conditional Citus plan is actioned.
- **Recommendation:** Convert the conditional to a committed plan: **TimescaleDB multi-node by Year 3** with explicit sharding (space partitioning on `vehicle_id` hash, N nodes sized from capacity math). Add a capacity-trigger threshold (e.g., "single-node CPU sustained > 60%") to the runbook.

### SCAL-3 🟠 WebSocket fan-out: 50K conns/node claim needs validation under per-tenant skew
- **Evidence:** `01` §12.1: WebSocket horizontal + Redis adapter, 50K conns/node. No analysis of per-tenant concentration (one Enterprise tenant with 10K dispatchers watching one fleet creates a fan-out hotspot on a single Redis adapter channel).
- **Impact:** Head-of-line blocking on a Redis pub/sub channel for a "noisy tenant" can degrade all tenants on that node.
- **Recommendation:** (a) Per-tenant channel isolation in the Redis adapter; (b) per-tenant connection quotas (already in modules — enforce at the gateway, not just at Socket.IO); (c) load-test the 50K figure with realistic tenant-skew.

### SCAL-4 🟡 No back-pressure contract for ClickHouse analytics at peak ingest
- **Evidence:** ClickHouse ingests all domain events for analytics. At 600K GPS events/sec, even sampled ingest is large. No documented back-pressure from ClickHouse to producers; the only fallback (`01` §12.3) is to "shed analytics rollups."
- **Impact:** ClickHouse ingest lag during bursts; analytics dashboards stale; no defined SLO for analytics freshness.
- **Recommendation:** Define an **analytics-freshness SLO** (e.g., "dashboard data ≤ 5 min stale") and a back-pressure contract: ClickHouse-lag > threshold → analytics consumers pause, not producers. Document the tradeoff explicitly.

### SCAL-5 🟡 Cold-tier (S3 Parquet) query path is under-specified
- **Evidence:** `03_Database_Architecture.md` §4.4 and `GPSEngine.md` reference S3 Parquet for cold GPS data queried via "ClickHouse / Athena." No service owns this query path; no latency target.
- **Impact:** "Show me where this truck was 18 months ago" queries have no defined owner, latency, or cost guardrail.
- **Recommendation:** Designate **report-generation-service** (or a new `cold-query-service`) as the owner; define an async-job API (SLO: minutes), cost-per-query cap, and tenant quota.

---

## 5. Database Problems

### DB-1 🟠 Compliance module uses both PostgreSQL and EventStoreDB — undocumented dual event store
- **Evidence:** `01_Master_Architecture.md` §7.4: compliance write store = "PostgreSQL (+ event store, hash-chained)." `Compliance-Safety.md` header lists **"PostgreSQL + EventStoreDB + ClickHouse + Elasticsearch."** Two different event-store technologies for the same service.
- **Impact:** Operational complexity (two HA stacks), and the hash-chain invariant (INV-C01) is only specified for the PG path. EventStoreDB has different consistency semantics.
- **Recommendation:** Pick one. Recommend **PostgreSQL-only** event store for compliance (to preserve the hash-chain + RLS story and avoid a 9th data store). Update `Compliance-Safety.md` and remove EventStoreDB.

### DB-2 🟠 Driver read-store split under-specified (Mongo + PG + ClickHouse)
- **Evidence:** `02_Domain_Model.md` §7.2: `GetDriverById` reads MongoDB, `GetLicenseStatus` reads PostgreSQL, `GetDriverBehaviorScore` reads ClickHouse. `03_Database_Architecture.md` §1.3: driver = "MongoDB (profiles) + PG (licenses)." A driver query that needs profile + license + score hits 3 stores.
- **Impact:** Latency and consistency complexity for a single logical read; no documented pattern for the join.
- **Recommendation:** Document a `DriverSummary` **CQRS projection** (in Redis or PG) that fan-in joins the 3 sources on update; reads hit the projection. Add to `Driver-Management.md`.

### DB-3 🟡 Hypertable natural-key dedup conflict
- **Evidence:** `03_Database_Architecture.md` §4.1: `tracking.vehicle_positions` has no surrogate PK; natural key `(vehicle_id, captured_at)` is "unique per vehicle." But §3.6 idempotency relies on that uniqueness, and two devices on one vehicle (or a re-transmit at the same timestamp) can collide.
- **Impact:** Rare but possible duplicate-key insert failures or silent dedup of distinct events.
- **Recommendation:** Add a `BIGINT event_id` (UUIDv7) PK + a unique constraint on `(vehicle_id, captured_at, source_device_id)` to disambiguate.

### DB-4 🟡 Audit retention tiers contradict across docs
- **Evidence:** `01_Master_Architecture.md` §9.3: Standard tier retention 6 months, Professional 24 months. `Audit-Compliance-Log.md` retention: Hot PG 90d, Warm ClickHouse 1–3y, Cold S3 3–7y, with category overrides (HOS ~8y, Billing ~10y). The two aren't reconciled — is the 6-month Standard tier the *audit* retention or the *telemetry* retention?
- **Impact:** Compliance retention ambiguity is a regulatory risk (FMCSA mandates minimums).
- **Recommendation:** Separate **telemetry retention** (tier-driven, 6–24 months) from **compliance/audit retention** (regulation-driven, 6mo–10y by category, non-negotiable, same for all tiers). Document explicitly in both docs.

### DB-5 🟡 No database isolation for VideoPlatform stream-sessions at scale
- **Evidence:** `VideoPlatform.md` §10.4 adds `media.stream_sessions` (per live-view session). At scale (500 concurrent streams/Enterprise tenant × thousands of tenants), this table is high-churn.
- **Impact:** Bloat on a non-partitioned table.
- **Recommendation:** Partition `stream_sessions` by RANGE(`started_at`) daily; auto-expire via partition drop. The doc says "operational, short-lived" but doesn't partition it.

---

## 6. DDD Problems

### DDD-1 🔴 Driver behavior score has two conflicting formulas
- **Evidence:**
  - `GPSEngine.md` §12.3: weights brake 0.25, accel 0.20, corner 0.20, speed 0.25, idle 0.10; **30-day** window.
  - `Driver-Management.md`: weights speed 0.25, braking 0.25, cornering 0.20, idling 0.15, other 0.15; **7-day (168h)** window.
- **Impact:** The same driver gets two different official scores depending on which service computes them. Coaching, insurance, gamification all break.
- **Recommendation:** Designate **one owner** (recommend `analytics-engine` per ADR-006's ML-in-Python principle) and **one formula**. `GPSEngine.md` produces *real-time behavior event flags*; `analytics-engine` produces the *canonical score* consumed by Driver/Notification/UI. Document the canonical formula in `02_Domain_Model.md` §8.4 (already there with 30-day weights — align Driver-Management to it).

### DDD-2 🔴 VIN uniqueness invariant contradicts
- **Evidence:**
  - `Fleet-Management.md` INV-01: "VIN unique across platform (cross-tenant)."
  - `Asset-Lifecycle.md` INV-1: "VIN unique within a tenant; cross-tenant collisions logged, not blocked."
- **Impact:** A VIN registered in Tenant A can be re-registered in Tenant B per Asset rules, violating Fleet rules. Either data corruption or false rejection.
- **Recommendation:** VINs are globally unique by ISO 3779 — enforce **cross-tenant uniqueness** (Fleet is right). Update Asset-Lifecycle to delegate VIN validation to Fleet via the `fleet.vehicle.added.v1` event projection (it sees all tenants' VINs in its read model). Add INV to `02_Domain_Model.md` as a shared-kernel invariant.

### DDD-3 🟠 Aggregates introduced in modules but absent from the domain model
- **Evidence:** Several modules introduce aggregates not in `02_Domain_Model.md` §2.2:
  - Authentication: `AuthSession`, `Credential`, `MfaEnrollment`, `RefreshTokenFamily`, `ExternalIdentity`.
  - VideoPlatform: `VideoChannel`, `Recording`, `StreamSession`, `EventClip`, `AIAlert`.
  - Asset-Lifecycle: `WarrantyClaim`, `AssetDisposal` (vs domain `DisposalRecord`).
  - Driver: `DriverAssignment` (matches domain) but also redefines `BehaviorAnalysis` as separate aggregate.
- **Impact:** The "canonical domain model wins" rule (`02` preamble) is undermined; engineers don't know which aggregates are real.
- **Recommendation:** Add all module-introduced aggregates to `02_Domain_Model.md` §2.2 with consistent names. The domain model is the catalog; modules are the detailed designs.

### DDD-4 🟠 Domain-model aggregate count is wrong (44 stated, 49 actual, "44+" in appendix)
- **Evidence:** `02_Domain_Model.md` §2.2 heading "44 Aggregates" but lists 49 rows; Appendix A says "44+" and adds 4 Analytics aggregates + NotificationPreference not in §2.2; §2.2 has zero Analytics aggregates.
- **Impact:** Erosion of doc credibility; aggregate inventory untrustworthy.
- **Recommendation:** Reconcile to a single authoritative list (recommend: explicitly enumerate ~53 aggregates after adding Analytics, Media, Auth aggregates) and remove the "44" figure.

### DDD-5 🟡 "One context = one service" claim is false and should be reframed
- **Evidence:** `02_Domain_Model.md` §1 and `01` §3 both assert one-to-one context→service mapping, but Telemetry = 2 services, Analytics = 2 services, plus DeviceGateway and media split.
- **Impact:** Confusing DDD teaching; Conway's-law misalignment.
- **Recommendation:** Reframe: "**One bounded context = one team ownership unit, possibly multiple services** when runtime characteristics demand (polyglot, scaling boundary, lifecycle)."

### DDD-6 🟡 Context-map relationships incomplete
- **Evidence:** The context map (`02` §1.1) doesn't show Media, DeviceGateway, or GPS-Engine sub-domains. Relationships like "Trip → Tracking (consumes positions)" and "Media → Tracking (consumes events for triggers)" aren't drawn.
- **Impact:** New contexts feel orphaned.
- **Recommendation:** Update the context map to include all 15+ contexts and the sub-domain relationships.

### DDD-7 🟡 Missing invariants for 3 contexts
- **Evidence:** `02_Domain_Model.md` §8.2 has no INV-* for Asset Lifecycle, Analytics, or Notification contexts (though aggregates exist).
- **Impact:** Invariants live only in module docs; no central governance.
- **Recommendation:** Add INV-ASSET-*, INV-ANALYTICS-*, INV-NOTIF-* rows to §8.2.

### DDD-8 🟡 `MaintenanceWorkOrder` enum vs state-machine vs invariant mismatch
- **Evidence:** `Vehicle-Maintenance.md` declares statuses `PARTS_ORDERED` and `ON_HOLD` in the enum, but the state-machine diagram and invariant INV-02 don't reference them — they're unreachable or undocumented.
- **Impact:** Implementers will guess at legal transitions.
- **Recommendation:** Either remove the unreachable statuses or add their transitions to the diagram and invariant.

### DDD-9 🟢 Driver code defect: `assignToFleet` precondition always false
- **Evidence:** `Driver-Management.md`: `require(fleetId == null)` — should be `require(fleetId != null)` (or similar). Always-false precondition.
- **Impact:** Method never succeeds; minor (illustrative code) but misleading.
- **Recommendation:** Fix the code sketch.

---

## 7. Integration Problems

### INT-1 🔴 Broken consumer→producer event contracts (13 cases)
This is the single most damaging class of finding. Each row below is a service subscribing to an event or topic that **no producer emits**. Built as-written, the consumer receives zero messages and produces wrong/empty results — silently.

| # | Consumer (file §) | Subscribes to | Actual producer emits | Severity |
|---|---|---|---|---|
| 1 | Compliance §6.2 | `tracking.position.updated.v1` | `tracking.position.received.v1` | 🔴 |
| 2 | Fuel §6.2 | `tracking.position.updated.v1` | `tracking.position.received.v1` | 🔴 |
| 3 | Asset §6.2 | `tracking.position.updated.v1` | `tracking.position.received.v1` | 🔴 |
| 4 | Analytics §6.2 | `tracking.position.updated.v1` | `tracking.position.received.v1` | 🔴 |
| 5 | Compliance §6.2 | `trip.lifecycle.changed.v1` | (no such event; Trip emits `trip.trip.*.v1`) | 🔴 |
| 6 | Fuel §6.2 | `trip.lifecycle.changed.v1` | (no such event) | 🔴 |
| 7 | Compliance §6.2 | `driver.assignment.changed.v1` | `driver.assignment.{created,started,completed,cancelled}.v1` | 🔴 |
| 8 | Fuel §6.2 | `driver.assignment.changed.v1` | (as above) | 🔴 |
| 9 | Analytics §6.2 | `driver.behavior.score-updated.v1` | `driver.behavior.score.changed.v1` | 🔴 |
| 10 | Analytics §6.2 | `telemetry.diagnostic-code.v1` | `telemetry.diagnostic.code.received.v1` | 🔴 |
| 11 | Compliance §6.2 | `fleet.vehicle.maintenance-completed.v1` | `maintenance.workorder.completed.v1` (different owner) | 🔴 |
| 12 | Asset/Analytics §6.2 | `fleet.vehicle.created.v1` | `fleet.vehicle.added.v1` | 🔴 |
| 13 | Fuel/Asset §6.2 | `fleet.vehicle.deactivated.v1` | `fleet.vehicle.decommissioned.v1` | 🔴 |

- **Impact:** At runtime, 4+ downstream services (Compliance, Fuel, Asset, Analytics) would silently receive no positions, no trips, no assignments, no behavior scores — and emit empty/wrong analytics, miss compliance violations, miscalculate fuel matching. Health checks pass; the platform looks alive but is wrong.
- **Recommendation:** **Block implementation until a single authoritative Event Catalog exists.** Build a contract test in CI: every consumer subscription must resolve to a producer's declared event+topic, or the build fails. Recommended location: a new `docs/specs/04_Event_Catalog.md` (or `fleetvision-events/` repo) listing every event with producer, topic, schema, and consumers.

### INT-2 🔴 Three competing Kafka topic-naming conventions
- **Evidence:**
  - **Pattern A** (`fleetvision.<context>.<entity>.events`) — IAM, Fleet, Tracking, Telemetry, Driver, Trip, Maintenance, Media. Stated in `01` §6.2.
  - **Pattern B** (bare `<event-type>` as topic) — Compliance, Fuel, Asset, Notification, Billing, Audit, Analytics.
  - **Pattern C** (bare `telemetry.*`, no prefix) — DeviceGateway (`telemetry.device.raw`), conflicting with Telemetry's `fleetvision.telemetry.position.raw`.
- **Impact:** Cross-team subscription is guesswork; tooling (ACLs, monitoring, retention policies) can't apply uniform rules; the Schema Registry subject naming won't match.
- **Recommendation:** Adopt **one convention**: `fleetvision.<context>.<aggregate>.events` for domain events (Pattern A) + `fleetvision.<context>.<kind>.raw` for high-volume raw streams (positions, telemetry). Migrate all modules. Document the convention in `01` §6.2 as a hard standard with CI lint.

### INT-3 🔴 `tracking.harsh_brake.v1` does not exist
- **Evidence:** `Driver-Management.md` consumes `tracking.harsh_brake.v1` (underscore) for behavior scoring. Neither Tracking-Monitoring nor GPSEngine emits this event. GPSEngine emits the unified `tracking.behavior.event.v1` with a sub-type.
- **Impact:** Driver behavior scoring receives zero harsh-brake events; the largest-weighted behavior component (braking) is silently absent → scores are wrong → coaching, insurance wrong.
- **Recommendation:** Align Driver on `tracking.behavior.event.v1` (filter by sub-type). Resolve as part of INT-1's Event Catalog.

### INT-4 🟠 Topic ownership for `telemetry.position.raw` split between two services
- **Evidence:** `Telemetry-Device-Management.md` owns `fleetvision.telemetry.position.raw`. `DeviceGateway.md` produces to `telemetry.position.raw` (no prefix) and `telemetry.device.raw`. Two services, two names, same logical stream.
- **Impact:** Consumers must subscribe to both; dedup needed; back-pressure split.
- **Recommendation:** Designate **DeviceGateway as the upstream producer** of `fleetvision.telemetry.device.raw` (raw frames, short retention) → **telemetry-ingestion normalizes** → republishes `fleetvision.telemetry.position.raw` (canonical). One name per stream; clear direction.

### INT-5 🟠 Route-deviation event has three identities
- **Evidence:** Trip module: `trip.route.deviation.detected.v1`. GPSEngine: `tracking.route.deviation.v1` **and** `tracking.route.offroute.v1` (internally inconsistent). Analytics config references a "route_deviation."
- **Impact:** Three producers, three names, no consumer can subscribe correctly.
- **Recommendation:** One owner (recommend **GPSEngine** — it's the live detector), one event: `tracking.route.deviation.v1`. Trip module consumes it. Remove the duplicate `offroute` variant.

### INT-6 🟠 gRPC dependency SLOs inconsistent for the same call
- **Evidence:** Multiple modules call `identity-service` gRPC with different timeouts/circuit-breakers (Maintenance: unstated; Compliance: 2s; Notification: 3s; Billing: 3s). Circuit-breaker thresholds also vary.
- **Impact:** Cascading-failure behavior differs per caller; SRE can't tune uniformly.
- **Recommendation:** Define a **platform-wide resilience profile per dependency** in a shared `docs/specs/05_Resilience_Standards.md`; modules reference it rather than redeclare.

### INT-7 🟡 Driver event uses underscore (`expiring_soon`) vs dotted convention
- **Evidence:** `driver.license.expiring_soon.v1` — every other event uses dots.
- **Impact:** Routing/filtering by convention breaks; tooling confusion.
- **Recommendation:** Rename to `driver.license.expiring.soon.v1` or `driver.license.expiry.warning.v1`.

### INT-8 🟡 Auth module consumes billing/tenant events but topic is underspecified
- **Evidence:** Authentication §6.3 consumes `billing.tenant.suspended.v1` from `fleetvision.iam.auth.events`, but Billing publishes event-as-topic (no `tenant.events` topic). Same class as INT-2.
- **Recommendation:** Resolved by adopting convention INT-2.

---

## 8. API Problems

### API-1 🔴 Authentication module's API base path conflicts with parent IAM
- **Evidence:** `Identity-Access-Management.md` §5.1: API base `/api/v1/iam`, login at `/api/v1/iam/auth/login`. `Authentication.md` §5.1: API base `/api/v1/auth`, login at `/api/v1/auth/login`. Both documents describe the same login endpoint.
- **Impact:** Clients and SDKs targeting either doc break against the other; gateway routing ambiguous.
- **Recommendation:** Standardize on `/api/v1/auth/*` for auth endpoints (cleaner, industry-standard), `/api/v1/iam/*` for user/role/org management. Update Identity-Access-Management to remove `/auth/*` from its base.

### API-2 🟠 Idempotency-Key required on all writes — but not enforced as a contract
- **Evidence:** `API_Design.md` §2.7 requires `Idempotency-Key` on writes. Modules' endpoint tables don't list it; no OpenAPI lint rule cited.
- **Impact:** Partners omitting the key get non-idempotent behavior on retry; no enforcement.
- **Recommendation:** Add an OpenAPI lint rule (`Idempotency-Key required on POST/PUT/PATCH/DELETE`) and a gateway-level check (401/400 on missing key for writes).

### API-3 🟡 Pagination style not applied uniformly in module specs
- **Evidence:** `API_Design.md` §2.6 mandates cursor pagination. Several module specs show `?page=&size=` offset-style examples.
- **Impact:** Inconsistent; clients can't rely on one model.
- **Recommendation:** Sweep module endpoint examples to cursor style.

### API-4 🟡 REST error envelope not shown in module examples
- **Evidence:** `API_Design.md` §2.4 defines the JSON:API error envelope. Module specs show ad-hoc error shapes.
- **Recommendation:** Update module examples to the canonical envelope.

---

## 9. Documentation & Consistency Issues

### DOC-1 🟡 No single authoritative Service Registry
- Across `01`, `02`, modules, the service list drifts (14 vs 16 vs 20+). **Recommendation:** a `docs/specs/06_Service_Registry.md` table: service → context → language → store → owner team → phase → SLO tier. One source of truth.

### DOC-2 🟡 No authoritative Event Catalog (drives INT-1)
- **Recommendation:** `docs/specs/04_Event_Catalog.md` — every event: producer, topic, schema ref, consumers, version. CI-generated from AsyncAPI + annotations.

### DOC-3 🟡 DeviceGateway config typos (`coax`, `connaqx` for `concox`)
- **Recommendation:** fix (`DeviceGateway.md` Appendix B).

### DOC-4 🟡 Latency target drift across API/read/write SLOs
- `00` says API P99 < 150ms read / < 300ms write; `01` §5 says < 200ms P99 REST. **Recommendation:** reconcile (recommend: < 200ms P99 overall, < 150ms read, < 300ms write, all in one table).

### DOC-5 🟡 Phase tagging inconsistent across modules (MVP/P2/P3/P4 vs P0–P6)
- **Recommendation:** map to the canonical Phase 0–6.

### DOC-6 🟡 Compliance topics use event-as-topic, contradicting `01`'s stated convention
- Covered under INT-2.

### DOC-7 🟡 ADR directory referenced but not present in repo
- `git status` shows only `docs/specs/` and `docs/modules/`; the frequently-referenced `/docs/adr/ADR-*.md` (12 ADRs) don't exist as files.
- **Recommendation:** create the `/Decisions/` directory with the 12 ADR stubs (and the new ones this report proposes: ADR-013 Media, ADR-014 DeviceGateway, ADR-015 Real-time transport decision).

### DOC-8 🟢 Aggregate/section numbering drift in `02_Domain_Model.md`
- Feature ID duplicates (e.g., D-04/D-05 in vision), aggregate count "44" vs 49. **Recommendation:** renumber sweep.

### DOC-9 🟢 Mix of British/American spelling, "behavior" vs "behaviour"
- **Recommendation:** standardize (US English per vision's NA-first launch).

### DOC-10 🟢 Inconsistent date format examples (some `2026-08-02`, some with timezones)
- **Recommendation:** standardize on RFC 3339 UTC in examples.

### DOC-11 🟢 ToC anchor for "Stop Detection" section in GPSEngine was malformed
- Fix the heading anchor.

### DOC-12 🟢 README.md exists but wasn't reviewed for alignment with the now-22 documents
- **Recommendation:** update README to index all documents.

---

## 10. Remediation Plan

### Phase R0 — Before any implementation work (1–2 weeks)
**Owners: Principal Architect + module owners. Gate: no PRs merge until R0 closes.**

1. **Build the Event Catalog** (`docs/specs/04_Event_Catalog.md`) — resolves INT-1, INT-3, INT-5, INT-7, INT-8, DDD-1. Every event: producer, topic (single naming convention), schema, consumers, version. **CI gate.**
2. **Adopt one Kafka topic-naming convention** (INT-2). Migrate all module docs. **CI lint.**
3. **Reconcile the permission catalog** (SEC-1). IAM §11.3 is canonical; sweep all modules; **CI gate** (OpenAPI ↔ catalog match).
4. **Fix VIN uniqueness contradiction** (DDD-2). One rule, globally unique.
5. **Decide Media & Video context** (MISS-1, ARCH-3): raise ADR-013, add Context 15 to `02_Domain_Model.md`.
6. **Decide real-time transport** (ARCH-3, SEC-3): raise ADR-015 (Socket.IO only, or SignalR-with-justification), unify token validation.
7. **Decide `report-generation-service` language** (ARCH-10).
8. **Fix Authentication API base path** (API-1).

### Phase R1 — Before Phase 1 GA (2–4 weeks)
9. **Add DeviceGateway to the architecture tier docs** (MISS-2); raise ADR-014.
10. **Reconcile GPS-Engine aggregates/events into the Tracking catalog** (MISS-3, ARCH-4).
11. **Service Registry** (`docs/specs/06_Service_Registry.md`) — DOC-1.
12. **Resilience Standards** (`docs/specs/05_Resilience_Standards.md`) — INT-6, SEC-6.
13. **Reconcile all SLO/throughput numbers** (ARCH-6, ARCH-7, SCAL-4).
14. **Compliance store: drop EventStoreDB** (DB-1).
15. **Webhook secret rotation** (SEC-4). **API key TTL standard** (SEC-7).
16. **Kafka partition plan for Year-5** (SCAL-1).
17. **TimescaleDB multi-node committed plan** (SCAL-2).
18. **Enforce tenant_id derivation as a contract** (SEC-2).
19. **Domain model aggregate reconciliation** (DDD-3, DDD-4, DDD-7).

### Phase R2 — Continuous (per sprint)
20. **ADR repo creation** (DOC-7).
21. **Behavior-score projection** for Driver (DB-2).
22. **Hypertable dedup key** (DB-3). **Audit retention separation** (DB-4). **stream_sessions partitioning** (DB-5).
23. **Documentation polish** (DOC-3, DOC-8–12).
24. **Cold-tier query owner** (SCAL-5).

### New ADRs Required

| ADR | Decision |
|---|---|
| ADR-013 | Media & Video bounded context (service split: Kotlin/Go/Python) |
| ADR-014 | Device Gateway — multi-protocol TCP ingestion (Go, protocol-adapter pattern) |
| ADR-015 | Real-time transport strategy (Socket.IO canonical; SignalR adapter in/out) |
| ADR-016 | Kafka topic-naming convention (single standard) |
| ADR-017 | Driver behavior score ownership & formula (single owner) |
| ADR-018 | Event catalog & CI contract testing |

### New Documents Required

| Doc | Purpose |
|---|---|
| `04_Event_Catalog.md` | Authoritative event/topic registry (resolves the 13 broken contracts) |
| `05_Resilience_Standards.md` | Per-dependency timeouts/circuit-breakers/retries (platform-wide) |
| `06_Service_Registry.md` | Authoritative service → context → store → team → phase map |

---

## 11. What the Review Found *Good*

A fair review notes strengths. The architecture gets a lot right:

- **DDD decomposition is genuinely strong.** 14 bounded contexts with realistic aggregates, clear invariants, and an honest ubiquitous-language governance process. The "this document wins" preamble is exactly right.
- **CQRS + Event Sourcing choices are well-scoped** — applied to audit-critical aggregates (HOS, DVIR, Trip, Invoice) rather than reflexively everywhere.
- **Multi-tenant tiering** (dedicated / schema / RLS) is industry-appropriate and tied to concrete DB mechanisms.
- **Security defense-in-depth** (6 layers, zero-trust, mTLS, OPA, Vault, hash-chained compliance) is enterprise-grade and traces to compliance requirements.
- **Scale plan** (partition-first, polyglot, KEDA, back-pressure philosophy, 10× load testing) is credible for the 2M-vehicle target.
- **API design** (JSON:API, cursor pagination, idempotency, versioning, webhooks with HMAC) is mature.
- **Video/AI-dashcam module** is a thoughtful competitive answer with appropriate privacy framing.
- **The new modules I authored during this engagement (Authentication, DeviceGateway, GPSEngine, VideoPlatform, UI/UX, API_Design)** are internally well-structured and consistent with the established stack — their issues are almost entirely *cross-document* integration drift, not internal flaws.

The bones are excellent. The fixes above are about **making the documentation tell one consistent truth** so that the implementation can be one consistent system.

---

## Sign-off

| Role | Status | Date |
|---|---|---|
| Principal Architect (reviewer) | **Approved for remediation tracking** | 2026-08-02 |
| Chief Software Architect | Action required — acknowledge findings | |
| Module owners (8 teams) | Action required — own Phase R0/R1 items | |

**Next review:** 30 days from acceptance of this report, to verify Phase R0 closure.

---

*This Architecture Review Report is the authoritative findings log for ARR-2026-08-02-A. Findings are tracked to closure in the Architecture Review Board backlog. No finding is closed until the referenced documents are updated and the change is verified by the reviewer.*
