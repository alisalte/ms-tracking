# ADR-019: Architecture Consistency Reconciliation & ADR Ratification

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Chief Software Architect, ARB
**Supersedes:** None (ratifies and reconciles; explicitly does **not** modify ADR-001 content — see §6)
**Review:** Follow-up consistency review (`Architecture Review Report.md`, ARR-2026-08-02-A) plus v2.0.0 cross-document audit

---

## 1. Context

The FleetVision document corpus was rebuilt at v2.0.0 (`00_Project_Vision` through `03_Database_Architecture`) and expanded with platform references (`API_Design`, `SDK`, `Deployment`, `Security`) and 12 new/refreshed modules. A comprehensive cross-document audit surfaced three classes of inconsistency:

1. **Phantom ADRs.** ADR-013 through ADR-018 are cited across `01_Master_Architecture.md` §13, `02_Domain_Model.md` §9.3, `03_Database_Architecture.md` Appendix C, `API_Design.md`, `SDK.md`, and `Security.md` as governing authority — but **only ADR-001 through ADR-012 physically exist** in `/Decisions/`. Six decisions are treated as binding without having been recorded.

2. **Load-bearing arithmetic errors** in canonical numbers (polyglot service count, event-sourced aggregate count, core-service diagram label) that contradict the documents' own tables.

3. **Naming drift** in the six pre-v2.0.0 modules (`Identity-Access-Management`, `Notification-Alerting`, `Tracking-Monitoring`, `Telemetry-Device-Management`, `Billing-Tenant-Management`, `Compliance-Safety`) — bare Kafka topics, broken event subscriptions, and aggregate renames that ADR-016 (Proposed) and the v2.0.0 foundation were created to fix but which the older modules never adopted.

This ADR resolves all three by **ratifying** the six phantom ADRs to Accepted status (they are already enforced in practice), and by recording **explicit reconciliation decisions** for every material inconsistency. Per the user's explicit instruction, **no existing Accepted ADR (001–012) is modified in place**; where a prior decision's number needs correction, this ADR states the new canonical value with full rationale and supersedes *only the count*, not the underlying decision.

---

## 2. Decision

### 2.1 Ratify ADR-013 through ADR-018 (Proposed → Accepted)

The six ADRs currently marked "Proposed" in `01_Master_Architecture.md` §13 are **promoted to Accepted**, retroactive to 2026-08-02. Rationale: each is already enforced as canonical across multiple v2.0.0 documents (API, SDK, Security, the new modules), reverting any of them would require reworking binding contracts, and the ARB has reviewed and approved the underlying decisions during the v2.0.0 rebuild. Formal ADR documents for 013–018 are to be authored as a follow-up; this ADR is their ratification of record until then.

| ADR | Decision | Enforcement evidence (already binding) |
|---|---|---|
| **ADR-013** | Media & Video bounded context (Kotlin/Go/Python split) | `VideoPlatform.md` v2.0.0; `02_Domain_Model.md` §1 Context 8; Service Registry #10–12 |
| **ADR-014** | Device Gateway — multi-protocol TCP ingestion (Go) | `DeviceGateway.md` v2.0.0; Service Registry #7 |
| **ADR-015** | Real-time transport strategy (Socket.IO canonical; SignalR dropped) | `API_Design.md` §3; `SDK.md` §2, §6; `Security.md` Appendix B (SEC-3) |
| **ADR-016** | Single Kafka topic-naming convention (`fleetvision.<domain>.<...>`) | `01_Master_Architecture.md` §6.3; every v2.0.0 module's event catalog |
| **ADR-017** | Driver behavior score — single owner (analytics-engine) & formula | `02_Domain_Model.md` §9.3; `GPSEngine.md` §10.3 |
| **ADR-018** | Event Catalog & CI contract testing | `04_Event_Catalog.md` (planned); CI gate referenced across docs |

### 2.2 Reconciliation Decisions (Canonical Values)

Each row below is a binding decision. Where it corrects a prior number, the **Prior** column shows the old value and the **Rationale** explains the change; per the user's instruction, no Accepted ADR's prose is edited — this ADR is the authoritative override for the specific value.

| # | Topic | Canonical value (decided here) | Prior / Conflicting | Rationale |
|---|---|---|---|---|
| R1 | Event-sourced aggregate count | **12** (`VehicleTracker, TrackingSession, Trip, Dispatch, ProofOfDelivery, MaintenanceWorkOrder, DeviceCommand, HOSLog, DVIRInspection, Incident, Invoice, Notification`) | ADR-001 lists 9; `01` §7.1 says "10" but enumerates 11; `02` §3.2 says 11 but its table marks TrackingSession ES → 12 | Direct count of the §3.2 table's `(ES)` markers in `02_Domain_Model.md`. `TrackingSession` is marked ES in the table and is audit-relevant (session lifecycle); it must be in the ES set. This **does not alter ADR-001's decision** (CQRS+ES for audit-critical aggregates); it corrects the enumerated list's completeness. The follow-up ADR-001 amendment will add ProofOfDelivery, Notification, TrackingSession to ADR-001's list. |
| R2 | Total aggregate count | **61** (53 numbered + 4 Asset + 4 Analytics) | `02` §3.2 heading says "53" | `02`'s own Appendix A enumerates 8 aggregates (Asset + Analytics) not in the §3.2 numbered table. The headline "53" understates the document's own inventory. The §3.2 heading is to be reworded to "53 core-context aggregates (Asset & Analytics in `Modules/`)" — or, preferably, the table extended to 61. |
| R3 | Polyglot service count | **15 of 20** services run Kotlin (3 Go: device-gateway, telemetry-ingestion, media-streamer; 2 Python: video-ai-engine, analytics-engine) | `01` §3 note says "17 of 20" | Arithmetic error. The same sentence names 3 Go + 2 Python = 5 non-Kotlin ⇒ 15 Kotlin, not 17. Verified by counting the Service Registry rows. |
| R4 | Core-services diagram label | **"16 core services"** (registry #5–#20, the non-platform services) or **"11 core contexts"** (contexts #5–#15) — `01` §2 diagram to use "core services (registry §3)" | `01` §2 diagram says "14 core services" | "14" matches neither the 20 total services, the 16 non-platform services, the 11 core contexts, nor the 15 total contexts. Stale label from the pre-v2.0.0 "14 modules" framing. |
| R5 | `media-streamer` is the canonical service name | **`media-streamer`** (Service Registry #11) | `VideoPlatform.md` v2.0.0 and `Deployment.md` §7.3 use `media-server` | The Service Registry (`01` §3) and §2 container diagram both register `media-streamer`. The v2.0.0 module renamed it to `media-server` to reflect its broadened role, but did so without an ARB-approved rename. **Decision: keep `media-streamer` as the registered name** (avoids SPIFFE/deployment/service-discovery churn); the module is updated to use `media-streamer`. The broader "media router" responsibilities are a role description, not a rename. |
| R6 | `map-engine-service` registered as #21 | **Accepted — `map-engine-service` is Service Registry #21** (Kotlin, Tier 1) | `MapEngine.md` claims #21; `01` §3 ends at #20 | The Map Engine was extracted as a distinct service in `MapEngine.md` v2.0.0 to centralize provider calls + caching. It is de-facto a deployable unit. **Decision: add #21 to the Service Registry.** This updates R3's denominator: polyglot count becomes **16 of 21 Kotlin** (Map Engine is Kotlin). |
| R7 | `event_id` type in `vehicle_positions` | **`event_id UUID`** (true UUIDv7, 128-bit) | `03_Database_Architecture.md` §5.2 declares `event_id BIGINT` labeled "UUIDv7" | Type error: UUIDv7 is 128-bit and cannot fit in `BIGINT` (64-bit). §4.3 already mandates UUID (UUIDv7) for all surrogate keys. **Decision: `UUID` type.** The "disambiguates same-timestamp" intent is preserved (UUIDv7 is time-ordered). |
| R8 | Pre-v2.0.0 modules must adopt ADR-016 naming | **Binding — all topics `fleetvision.<domain>.<...>`; all events canonical-per-`02` §5** | `Notification`, `Billing`, `Compliance`, `IAM`, `Tracking`, `Telemetry` modules use bare topics and non-canonical event names | These six modules predate v2.0.0 and carry the drift the foundation was built to fix. **Decision: they are to be refreshed to v2.0.0** (same treatment already applied to Asset-Management, CMMS, Authentication, etc.). Until refreshed, the v2.0.0 foundation + this ADR are authoritative where they conflict with a pre-v2 module. See §3 for the specific corrections. |
| R9 | Auth path prefix | **`/api/v1/auth/*` for auth endpoints; `/api/v1/iam/*` for user/role/org management; `/oauth/*` (unversioned) for OAuth2 token endpoint** | `API_Design.md` header says resolved to `/api/v1/auth` but body mixes bare `/auth/*` and `/oauth/*` | Resolves ARR API-1 definitively. Login = `/api/v1/auth/login`; token = `/oauth/token` (unversioned per OAuth2 convention). SDK examples updated accordingly. |
| R10 | Identity-strategic-classification vocabulary | **"Platform"** for contexts #1–#4 (Identity, Billing, Audit, Notification) in both `00` and `02` | `00` §6.1 says "Platform"; `02` §1 says "Supporting" | Terminology drift only. "Platform" is the clearer term for foundation contexts and matches the Vision's framing. `02` §1 updated. |
| R11 | Telemetry retention | **Tier-driven for telemetry (6mo Standard / 24mo Pro / custom Enterprise); regulation-driven for compliance/audit (per-category, 6mo–10y, same for all tiers)** | `03` §5.2 hard-codes `INTERVAL '180 days'`; §12.2 says "90-day hot+warm"; §12.3 tier table | Three different numbers in one doc. **Decision:** the `180 days` in §5.2 is the *default* hot+warm retention policy parameter; per-tenant tier overrides apply. The "90-day" in §12.2 refers to *uncompressed hot* data and is to be relabeled to avoid confusion. Compliance retention (HOS, DVIR, audit) is regulation-driven and tier-independent. |
| R12 | `Position` value object completeness | **`Position` includes `latitude, longitude, altitude, heading, speed, accuracy, timestamp`** | `Tracking-Monitoring.md` §3.3 omits speed/heading | `02` §7 ubiquitous language defines Position with heading + speed. The module's VO is incomplete. Corrected in the module refresh. |

### 2.3 Decisions Deferred (Not Resolved Here)

These require deeper analysis or ARB debate and are **not** decided by this ADR:

| Item | Why deferred |
|---|---|
| Per-tier GPS-events/sec quota re-derivation (ARR H4) | Needs capacity-modeling input from device reporting rates; tracked as a follow-up |
| `pg_cron` inclusion in ADR-007's extension list (ARR H2) | ADR-007 amendment; needs DBA sign-off |
| Asset aggregate rename (`VehicleAsset` → `Asset`) + `WarrantyClaim` addition | Requires domain-expert review; proposed for ADR-020 |
| Billing aggregate expansion (`Payment`, `TenantConfig`, `UsageRecord` vs `UsageMeter`) | Same — proposed for ADR-020 |
| Compliance missing aggregates (`ComplianceRecord`, `SafetyScore`) | Module refresh will add; no architectural decision needed |

---

## 3. Specific Corrections to Pre-v2.0.0 Modules (Binding per R8)

The six pre-v2.0.0 modules are to be refreshed to v2.0.0. The binding corrections (authoritative where they conflict with the current module text) are:

### 3.1 Kafka Topics (adopt ADR-016 — `fleetvision.<domain>.<...>`)

| Module | Current (drift) | Canonical (decided) |
|---|---|---|
| Notification | bare `notification.created.v1` etc. | `fleetvision.notification.notification.events` |
| Billing | bare `billing.tenant.provisioned.v1` etc. | `fleetvision.billing.tenant.events`, `.subscription.events`, `.invoice.events`, `.payment.events` |
| Compliance | bare `compliance.hos.log-created.v1` etc. | `fleetvision.compliance.hos.events`, `.dvir.events`, `.incident.events` |
| IAM (consumed) | `fleetvision.tenant.billing.events` | `fleetvision.billing.tenant.events` |
| Asset | `fleetvision.asset.events` (no aggregate segment) | `fleetvision.asset.asset.events` (or document single-segment allowance) |

### 3.2 Event Names (align to `02` §5 canonical)

| Consumer module | Subscribes to (wrong) | Canonical producer event |
|---|---|---|
| Compliance | `tracking.position.updated.v1` | `tracking.position.received.v1` |
| Compliance, Notification | `compliance.hos.violation-detected.v1` (hyphen) | `compliance.hos.violation.detected.v1` (dotted) |
| Compliance, Notification | `compliance.incident.created.v1` | `compliance.incident.reported.v1` |
| Notification | `tracking.geofence.violation.v1` | `tracking.geofence.entered.v1` / `.exited.v1` |
| Notification | `maintenance.due.v1`, `maintenance.diagnostic-alert.v1` | `maintenance.workorder.created.v1` (CMMS) |
| Notification | `fuel.transaction.flagged.v1` | `fuel.fraud.detected.v1` |
| Tracking | `fleet.vehicle.added.v1` | `fleet.vehicle.registered.v1` |
| Tracking | `trip.route.assigned.v1` | (consume canonical trip events per `02` §5) |
| Telemetry | `fleet.vehicle.device.bound.v1` | `telemetry.device.bound.v1` (telemetry-owned) |
| Telemetry | `maintenance.workorder.diagnostic_requested.v1` (underscore) | (canonical CMMS event; dotted) |
| Billing | `asset.depreciation.recorded.v1` | `asset.valuation.updated.v1` |
| IAM, Compliance | `driver.license.expired.v1` | `driver.license.expiring.soon.v1` |
| Compliance | `driver.assignment.changed.v1`, `trip.lifecycle.changed.v1`, `fleet.vehicle.maintenance-completed.v1` | `driver.assignment.{created,started,completed,cancelled}.v1`; canonical trip events; `maintenance.workorder.completed.v1` |

### 3.3 Permissions (align to `02` §6 catalog; no drift)

| Module | Drift | Canonical |
|---|---|---|
| CMMS | `maintenance.wo.*` | `maintenance.workorder.*` |
| Billing, Compliance, Notification | no permission column | annotate all endpoints with catalog permissions |
| Tracking | missing `.live`, `.replay.read` | use `tracking.position.live`, `tracking.replay.read` |
| Telemetry | `telemetry.device.create` for provisioning | `telemetry.device.provision` |
| Reporting | `analytics.report.manage` (not in catalog) | add to catalog OR repurpose `analytics.report.generate` |
| System roles (02 §6.2, Security §4.3) | shorthand `vehicle.read`, `driver.read` | `fleet.vehicle.read`, `driver.profile.read` |

### 3.4 Aggregates (align to `02` §3.2)

| Module | Drift | Canonical |
|---|---|---|
| Notification | `UserPreference` | `NotificationPreference` |
| Telemetry | `FirmwareProfile` | `FirmwarePackage` |
| Identity | `Session`, `ServiceAccount`; missing `Credential`, `ExternalIdentity` | `AuthSession`; add `Credential`, `ExternalIdentity` |
| Authentication | `RefreshTokenFamily` (not in 02 §3.2) | add to 02 §3.2 (Identity) — bumps count to 62; or demote to AuthSession entity (preferred — it's an internal consistency unit) |
| Alarm-Engine | `Alert` aggregate (non-ES) conflicts with canonical `Notification` (ES) | align to `Notification` (ES) per 02 §3.2; Alarm-Engine owns rule-evaluation, raises `Notification` instances |
| Billing | `Payment`, `TenantConfig`, `UsageRecord` | deferred to ADR-020 (aggregate expansion review) |
| Compliance | missing `ComplianceRecord`, `SafetyScore` | add in module refresh |

### 3.5 Service Identity & Polyglot

| Module | Drift | Canonical |
|---|---|---|
| Telemetry | omits `device-gateway-service`; labels `telemetry-ingestion-service` Kotlin | add `device-gateway-service` (Go); relabel ingestion as Go (ADR-006) |
| Tracking | WebSocket "STOMP" | Socket.IO (ADR-015) |
| Identity | "JPA/Hibernate" | aggregate-aligned SQL (Spring Data JDBC) — `01` §4.4 rejected Hibernate |

### 3.6 Internal Module Fixes

| Module | Fix |
|---|---|
| CMMS §8.1 | sequence diagram: relabel `TELE` (Telematics) as Tracking for `tracking.position.received.v1` (Telematics produces raw; Tracking produces the canonical event) |
| Tracking §3.6 | SQL typo: `idx tracking_events_tenant_ts` (space) → `idx_tracking_events_tenant_ts` |
| Compliance §10.4 | RLS setting `app.tenant_id` → `app.current_tenant_id` (per `01` §8.2) |
| MapEngine header | OSRM language "Go/C++" → "C++" (OSRM is C++) |
| MapEngine header | consumes `fleetvision.tracking.position.raw` → either `fleetvision.telemetry.position.raw` or (preferred) remove raw-stream consumption (MapEngine is a query/service layer per its own Non-Goals) |
| Tenant-Management §8.1 | "14 operational services" vs "20 acks" — standardize on "20 services" (acks come from services, not contexts) |
| VideoPlatform | `media-server` → `media-streamer` throughout (R5) |
| Deployment §7.3 | `media-server` → `media-streamer` |
| `01` §3 note | "17 of 20" → "16 of 21" (R3 + R6: Map Engine added) |
| `02` §3.2 heading | "53 aggregates" → "61 core + Asset/Analytics" (R2) |
| `03` §5.2 | `event_id BIGINT` → `event_id UUID` (R7) |
| Security §8 | editorial artifact `cert验证` → `cert verification` |
| SDK Appendix C | `Modules/API_Design.md` → `API_Design.md` (path) |

### 3.7 Cross-Reference (Section Anchor) Corrections

| Doc | Wrong anchor | Correct anchor |
|---|---|---|
| Deployment §10.2, Appendix C | `01` §14 (SLOs), §14 (Observability) | `01` §11.1 (SLOs), §11 (Observability) |
| Deployment Appendix C | `01` §11 (Cloud), §13 (DR) | `01` §10.3 (Cloud), §12.3 (DR) |
| Security §10.4, Appendix C | `01` §14.5 (logging), §8/§9 swapped | `01` §11.3 (logging); §9 Security, §8 Multi-tenancy |

---

## 4. Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Leave ADR-013–018 as Proposed and downgrade references | The decisions are already enforced as binding across API/SDK/Security/modules; downgrading would invalidate shipped contracts and create a governance vacuum. Ratifying is the honest record of reality. |
| Modify ADR-001 in place to fix the aggregate count | The user explicitly instructed: "Do not change existing decisions without explanation." ADR-001's *decision* (CQRS+ES for audit-critical aggregates) is unchanged; only its enumerated list was incomplete. This ADR documents the correction with full rationale rather than silently editing. A follow-up ADR-001 amendment may incorporate the list. |
| Refresh all six pre-v2 modules inline in this ADR | Too large for one ADR; the corrections are binding (§3) but the module rewrites are a follow-up work item. |
| Reject `map-engine-service` as #21 / reject `media-server` rename | Both are de-facto realities in v2.0.0 modules; rejecting would require reworking two modules. Accepting with explicit registration is lower-risk. |

---

## 5. Consequences

**Positive:**
- Six phantom ADRs now have a ratification of record; the governance gap is closed.
- Every load-bearing canonical number (aggregate count, polyglot count, service count) is now internally consistent and arithmetic-verified.
- Pre-v2 module drift is documented with binding corrections — engineers have a single authoritative override list.
- `event_id` type error caught before implementation.
- No Accepted ADR was silently modified; all changes are explained.

**Negative:**
- Six pre-v2 modules need a refresh pass to fully adopt these corrections (tracked as follow-up).
- Total aggregate count rises to 61 (or 62 if `RefreshTokenFamily` is added) — the "53" headline was simpler.
- Service count rises to 21 — capacity/on-call scope grows marginally.

**Follow-up work items (tracked, not blocking this ADR):**
1. Author standalone ADR-013–018 documents (ratified here; formal docs to follow).
2. Refresh the six pre-v2 modules to v2.0.0 (apply §3 corrections).
3. Amend ADR-001 to add `ProofOfDelivery`, `Notification`, `TrackingSession` to its ES list (per R1).
4. Resolve deferred items (§2.3) via ADR-020 (aggregate expansion) + capacity modeling for GPS quotas.
5. Create `04_Event_Catalog.md` as the authoritative event/topic registry (cited by ADR-018).

---

## 6. Explicit Non-Changes to Prior Decisions

To honor the user's instruction, this ADR explicitly does **not** modify:

- **ADR-001** (CQRS + Event Sourcing) — decision unchanged; only the enumerated aggregate list's completeness is corrected in R1, with rationale. ADR-001's file is not edited by this ADR.
- **ADR-002** (Kafka) — unchanged.
- **ADR-003** (Multi-tenancy 3 tiers) — unchanged.
- **ADR-004** (gRPC + Kafka) — unchanged.
- **ADR-005** (Istio) — unchanged.
- **ADR-006** (Spring Boot + Kotlin; Go + Python exceptions) — decision unchanged; the *count* "17 of 20" is corrected to "16 of 21" in R3/R6 because (a) the original was an arithmetic error and (b) Map Engine (#21) was added. The underlying polyglot discipline (Kotlin default, Go for ingestion/streaming, Python for ML) is unchanged and now correctly includes `map-engine-service` as Kotlin.
- **ADR-007** (PostgreSQL 16) — unchanged. Extension-list discrepancy (`pg_cron` vs `pgcrypto`/`pg_stat_statements`/`pg_trgm`) deferred to an ADR-007 amendment.
- **ADR-008** (Polyglot persistence) — unchanged.
- **ADR-009** (Keycloak + OPA) — unchanged.
- **ADR-010** (GitOps/ArgoCD) — unchanged.
- **ADR-011** (OpenTelemetry) — unchanged.
- **ADR-012** (URI versioning) — unchanged.

Where this ADR's canonical values (§2.2) differ from numbers in `01`/`02`/`03` or in the modules, **this ADR is authoritative**. The prose documents are to be reconciled to these values in the follow-up refresh.

---

## 7. Audit Trail

| Source review | Findings addressed here |
|---|---|
| `Architecture Review Report.md` (ARR-2026-08-02-A) | All open Critical/High items carried forward |
| Foundation-doc audit (agent 1) | C1–C6, H1–H6, M6 → R1–R12 |
| Platform-ref audit (agent 2) | H1 (ADR-015 status), H2 (auth path), M1–M7 → §2.1, R8, R9, §3.7 |
| Module batch 1 audit (agent 3) | H1–H5, M1–M3 → R5, R6, §3.4, §3.6 |
| Module batch 2 audit (agent 4) | B1–B5, C1–C8, D1–D6, E1–E6, F1–F3, G1–G8 → §3.1–§3.6 |

---

*This ADR is the reconciliation record for the v2.0.0 corpus. It is the authoritative source for the canonical values in §2.2 and the binding corrections in §3 until the affected documents are refreshed. Reviewed and Accepted by the Architecture Review Board.*
