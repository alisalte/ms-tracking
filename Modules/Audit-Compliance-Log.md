# Audit & Compliance Log Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Service:** `audit-log-service`
**Bounded Context:** Audit & Compliance Log

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Designs](#3-aggregate-root-designs)
4. [Repository Interfaces](#4-repository-interfaces)
5. [API Endpoints](#5-api-endpoints)
6. [Kafka Event Contracts](#6-kafka-event-contracts)
7. [Append-Only Architecture](#7-append-only-architecture)
8. [Data Retention & Compliance](#8-data-retention--compliance)
9. [Dependencies & External Integrations](#9-dependencies--external-integrations)
10. [Configuration Properties](#10-configuration-properties)
11. [Resilience Patterns](#11-resilience-patterns)
12. [Test Strategy](#12-test-strategy)

---

## 1. Module Overview & Context Mapping

### 1.1 Purpose

The Audit & Compliance Log context provides a tamper-proof, append-only record of all significant actions, data changes, and compliance events across the FleetVision platform. It supports SOC 2 Type II, ISO 27001, GDPR, and FMCSA compliance requirements by maintaining an immutable audit trail with cryptographic integrity verification. The service is optimized for high-volume writes with query capabilities for compliance reporting and forensic investigation.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│               AUDIT & COMPLIANCE LOG CONTEXT                     │
│                                                                  │
│  APPEND-ONLY: No updates or deletes permitted                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ AuditEntry   │  │ Compliance   │  │ DataRetention │          │
│  │ (Aggregate)  │  │ Record       │  │ Policy       │          │
│  └──────────────┘  │ (Aggregate)  │  │ (Aggregate)   │          │
│                    └──────────────┘  └──────────────┘          │
│                                                                  │
│  Domain Services:                                                │
│  - AuditEventProcessor       - IntegrityVerifier              │
│  - ComplianceReportGenerator - DataRetentionPolicyEnforcer     │
│  - SearchIndexer             - ExportService                   │
│                                                                  │
│  Storage Strategy:                                              │
│  - Hot: PostgreSQL (90 days) + Elasticsearch (90 days)         │
│  - Warm: ClickHouse (1-3 years)                                │
│  - Cold: S3/MinIO (3-7 years, compressed)                     │
│                                                                  │
└────────┬──────────────────────────────────────────────────────────┘
         │
    ┌────┴──────────────────────────────────────────────────────┐
    │  ALL Services (producers of audit events)                 │
    │  Every state-changing action emits an audit event          │
    └───────────────────────────────────────────────────────────┘
```

**Downstream (consumes events from ALL contexts):**
- `identity-service` — Authentication events, authorization decisions, user management
- `fleet-management-service` — Vehicle CRUD, fleet policy changes, assignments
- `tracking-service` — Geofence configuration changes, alert rule modifications
- `telemetry-ingestion-service` — Device management, firmware updates
- `vehicle-maintenance-service` — Work order lifecycle, parts inventory changes
- `driver-management-service` — Driver profile changes, license status, certifications
- `fuel-management-service` — Card lifecycle, transaction approvals, limit changes
- `trip-management-service` — Route changes, dispatch decisions, POD
- `compliance-service` — HOS log changes, DVIR submissions, incident management
- `analytics-engine` — ML model deployments, report access, dashboard changes
- `asset-lifecycle-service` — Asset lifecycle changes, depreciation adjustments
- `notification-service` — Alert rule changes, preference modifications
- `billing-service` — Tenant provisioning, subscription changes, invoice actions

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **AuditEntry** | An immutable record of a single action or event in the system |
| **ComplianceRecord** | A specialized audit entry linked to a regulatory requirement |
| **DataRetentionPolicy** | A rule defining how long audit data must be preserved |
| **AuditTrail** | A chronological sequence of audit entries for a specific entity |
| **IntegrityHash** | A cryptographic chain hash ensuring audit entry immutability |
| **GDPRRightToErasure** | A compliance requirement for right-to-be-forgotten (pseudonymization, not deletion) |
| **ColdStorage** | Long-term archival storage for compliance data beyond active retention |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     audit-log-service                            │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST Controllers│  │  gRPC Service Implementations│   │  │
│  │  │  (Spring MVC)    │  │  (AuditServiceGrpcImpl)     │   │  │
│  │  └────────┬────────┘  └──────────────┬───────────────┘   │  │
│  │           │                          │                    │  │
│  │  ┌────────┴────────┐  ┌─────────────┴──────────────┐    │  │
│  │  │  DTO Mappers   │  │  Event Consumers (Kafka)    │    │  │
│  │  │  (MapStruct)   │  │  • AuditEventConsumer      │    │  │
│  │  └─────────────────┘  │  • ComplianceEventConsumer │    │  │
│  │                       └──────────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │  Export Adapters                                  │    │  │
│  │  │  • PDFExportAdapter (compliance reports)          │    │  │
│  │  │  • CSVExportAdapter (bulk audit export)           │    │  │
│  │  │  • JSONExportAdapter (API consumption)            │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Command Handlers                                  │    │  │
│  │  │  • RecordAuditEntryCommandHandler                  │    │  │
│  │  │  • CreateDataRetentionPolicyCommandHandler         │    │  │
│  │  │  • UpdateDataRetentionPolicyCommandHandler         │    │  │
│  │  │  • ExecuteDataRetentionCommandHandler               │    │  │
│  │  │  • PseudonymizeDataCommandHandler (GDPR)           │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Query Handlers (CQRS)                              │    │  │
│  │  │  • GetAuditTrailQueryHandler                        │    │  │
│  │  │  • SearchAuditLogsQueryHandler                      │    │  │
│  │  │  • GetComplianceReportQueryHandler                  │    │  │
│  │  │  • GetDataRetentionStatusQueryHandler              │    │  │
│  │  │  • VerifyIntegrityQueryHandler                      │    │  │
│  │  │  • GetAuditStatisticsQueryHandler                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Services                                    │    │  │
│  │  │  • AuditEventProcessor                             │    │  │
│  │  │  • IntegrityVerifier                               │    │  │
│  │  │  • ComplianceReportGenerator                       │    │  │
│  │  │  • DataRetentionPolicyEnforcer                     │    │  │
│  │  │  • SearchIndexer                                   │    │  │
│  │  │  • PseudonymizationService                         │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Aggregate Roots (Append-Only)                      │    │  │
│  │  │  • AuditEntry                                        │    │  │
│  │  │  • ComplianceRecord                                  │    │  │
│  │  │  • DataRetentionPolicy                              │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • AuditAction, AuditCategory                      │    │  │
│  │  │  • AuditActor (who performed the action)           │    │  │
│  │  │  • AuditTarget (what was acted upon)                │    │  │
│  │  │  • IntegrityHash, ChainHash                         │    │  │
│  │  │  • DataRetentionRule, RetentionTier                 │    │  │
│  │  │  • ComplianceStandard, ComplianceStatus             │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Storage (Multi-Tier, Append-Only)                 │    │  │
│  │  │  • PostgreSQL (Hot: 90 days, append-only tables)   │    │  │
│  │  │  • Elasticsearch (Hot: 90 days, full-text search)   │    │  │
│  │  │  • ClickHouse (Warm: 1-3 years, analytical queries)│    │  │
│  │  │  • S3/MinIO (Cold: 3-7 years, compressed Parquet) │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Kafka Consumers (from ALL bounded contexts)        │    │  │
│  │  │  • AuditEventConsumer (generic audit topic)          │    │  │
│  │  │  • ComplianceEventConsumer (compliance-specific)    │    │  │
│  │  │  • DataLifecycleConsumer (retention enforcement)     │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Batch Processing (Scheduled)                       │    │  │
│  │  │  • DataRetentionJob (daily)                         │    │  │
│  │  │  • IntegrityVerificationJob (daily)                 │    │  │
│  │  │  • ArchiveToColdStorageJob (weekly)                 │    │  │
│  │  │  • ComplianceReportJob (monthly)                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
com.fleetvision.audit/
├── api/
│   ├── rest/
│   │   ├── AuditLogController.kt
│   │   ├── ComplianceReportController.kt
│   │   ├── DataRetentionController.kt
│   │   └── AuditExportController.kt
│   └── grpc/
│       ├── AuditServiceGrpcImpl.kt
│       └── proto/
├── application/
│   ├── command/ + commandhandler/
│   ├── query/ + queryhandler/
│   ├── service/
│   │   ├── AuditEventProcessor.kt
│   │   ├── IntegrityVerifier.kt
│   │   ├── ComplianceReportGenerator.kt
│   │   ├── DataRetentionPolicyEnforcer.kt
│   │   ├── SearchIndexer.kt
│   │   └── PseudonymizationService.kt
│   └── port/
├── domain/
│   ├── model/
│   │   ├── aggregate/ (AuditEntry, ComplianceRecord, DataRetentionPolicy)
│   │   ├── valueobject/
│   │   └── event/
│   └── service/
├── infrastructure/
│   ├── config/
│   ├── persistence/
│   │   ├── postgresql/
│   │   │   ├── AuditEntryPostgresRepository.kt
│   │   │   └── DataRetentionPolicyRepository.kt
│   │   ├── elasticsearch/
│   │   │   └── AuditSearchRepository.kt
│   │   ├── clickhouse/
│   │   │   └── AuditAnalyticsRepository.kt
│   │   └── s3/
│   │       └── ColdStorageRepository.kt
│   ├── messaging/
│   │   ├── AuditEventConsumer.kt
│   │   └── ComplianceEventConsumer.kt
│   ├── batch/
│   │   ├── DataRetentionJob.kt
│   │   ├── IntegrityVerificationJob.kt
│   │   ├── ArchiveToColdStorageJob.kt
│   │   └── ComplianceReportJob.kt
│   └── export/
│       ├── PDFExportAdapter.kt
│       ├── CSVExportAdapter.kt
│       └── JSONExportAdapter.kt
└── AuditLogServiceApplication.kt
```

---

## 3. Aggregate Root Designs

### 3.1 AuditEntry (Append-Only Aggregate Root)

**Purpose:** An immutable record of a single auditable action in the system. Once written, an audit entry cannot be modified or deleted. Integrity is ensured through cryptographic chain hashing.

#### Fields

| Field | Type | Description |
|---|---|---|
| `entryId` | `UUID` | Unique entry identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant (for data isolation) |
| `timestamp` | `Instant` | When the action occurred (from source event) |
| `action` | `AuditAction` | Action performed (CREATE, UPDATE, DELETE, READ, EXECUTE, SYSTEM) |
| `category` | `AuditCategory` | Business category (AUTH, FLEET, VEHICLE, DRIVER, etc.) |
| `actor` | `AuditActor` | Who performed the action |
| `target` | `AuditTarget` | What was acted upon |
| `sourceService` | `String` | Originating microservice |
| `sourceEventType` | `String` | The domain event that triggered this audit entry |
| `sourceEventId` | `UUID` | The domain event ID for traceability |
| `correlationId` | `UUID` | Distributed trace correlation ID |
| `changes` | `Map<String, ChangeDetail>?` | Before/after state for UPDATE actions |
| `metadata` | `Map<String, Any>` | Additional context (IP address, user agent, etc.) |
| `integrityHash` | `String` | SHA-256 hash of entry + previous entry hash (chain) |
| `previousEntryHash` | `String?` | Hash of the previous entry in the chain (null for first entry) |
| `retentionCategory` | `RetentionCategory` | `HOT`, `WARM`, `COLD` |

#### Value Objects

```kotlin
data class AuditActor(
    val userId: UUID?,              // Null for system actions
    val serviceAccountId: String?,  // For service-to-service actions
    val type: ActorType,            // USER, SERVICE, SYSTEM, ANONYMOUS
    val ipAddress: String?,
    val userAgent: String?,
    val sessionId: String?
)

data class AuditTarget(
    val entityType: String,         // e.g., "Vehicle", "Driver", "Tenant"
    val entityId: UUID,
    val entityVersion: Int?,
    val resourceName: String?       // e.g., "/api/v1/vehicles/abc-123"
)

data class ChangeDetail(
    val fieldName: String,
    val oldValue: Any?,
    val newValue: Any?
)

enum class AuditAction {
    CREATE, UPDATE, DELETE, READ, EXECUTE, LOGIN, LOGOUT,
    AUTHORIZE, DENY, EXPORT, IMPORT, CONFIG_CHANGE, SYSTEM
}

enum class AuditCategory {
    AUTHENTICATION, AUTHORIZATION, FLEET, VEHICLE, DRIVER,
    TRIP, FUEL, MAINTENANCE, COMPLIANCE, NOTIFICATION,
    BILLING, TENANT, ANALYTICS, ASSET, SYSTEM, DATA_RETENTION
}
```

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `record()` | action, category, actor, target, changes, metadata, sourceService, sourceEventId | `AuditEntryRecordedEvent` | All required fields must be present |
| `verifyIntegrity()` | entryId | — | Computes hash chain; raises alert if broken |

#### Invariants

1. **Immutability:** An AuditEntry can never be modified after creation. Any attempt to UPDATE or DELETE triggers an alert and is rejected at the database level (append-only tables).
2. **Chain Integrity:** Each entry's `integrityHash` = SHA-256(entry data + previous entry's hash). Any tampering breaks the chain and is detectable.
3. **Completeness:** Every state-changing action across the platform MUST produce an audit entry. Missing entries indicate a system failure.
4. **Tenant Isolation:** Audit entries are always scoped to a tenant. Cross-tenant queries require admin authorization.
5. **Timestamp Authority:** Timestamp is sourced from the originating event, not the audit service (preserves temporal accuracy).

#### Domain Events

```kotlin
// Event naming: audit.entry.recorded.v1
data class AuditEntryRecordedEvent(
    val entryId: UUID, val tenantId: UUID,
    val timestamp: Instant, val action: AuditAction,
    val category: AuditCategory, val sourceService: String,
    val sourceEventId: UUID, val correlationId: UUID,
    val timestamp: Instant
)

// Integrity events (published if chain broken)
data class AuditIntegrityViolationEvent(
    val tenantId: UUID, val entryId: UUID,
    val expectedHash: String, val actualHash: String,
    val timestamp: Instant
)
```

---

### 3.2 ComplianceRecord (Append-Only Aggregate Root)

**Purpose:** A specialized audit entry linked to a specific regulatory compliance requirement, providing structured data for compliance reporting.

#### Fields

| Field | Type | Description |
|---|---|---|
| `recordId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `standard` | `ComplianceStandard` | `SOC2`, `ISO27001`, `GDPR`, `FMCSA_ELD`, `HIPAA`, `PCI_DSS` |
| `requirementId` | `String` | Specific control/requirement reference |
| `requirementDescription` | `String` | Human-readable description |
| `status` | `ComplianceStatus` | `COMPLIANT`, `NON_COMPLIANT`, `PARTIALLY_COMPLIANT`, `NOT_APPLICABLE`, `UNDER_REVIEW` |
| `evidence` | `List<EvidenceItem>` | Supporting evidence references |
| `assessedBy` | `UUID` | Assessor user ID |
| `assessedAt` | `Instant` | Assessment timestamp |
| `validUntil` | `Instant?` | Validity period end |
| `remediationPlan` | `String?` | Plan to address non-compliance |
| `relatedAuditEntryIds` | `List<UUID>` | Linked audit entries |
| `integrityHash` | `String` | Chain hash |
| `previousRecordHash` | `String?` | Previous record hash |

#### Compliance Standards Mapping

```kotlin
enum class ComplianceStandard {
    SOC2_TYPE_II,        // AICPA SOC 2 Type II
    ISO_27001,           // Information security management
    GDPR,                // EU General Data Protection Regulation
    CCPA,                // California Consumer Privacy Act
    FMCSA_ELD,           // Electronic Logging Device mandate
    HIPAA,               // Health Insurance Portability
    PCI_DSS,             // Payment Card Industry Data Security
    CUSTOM               // Tenant-defined custom standard
}
```

---

### 3.3 DataRetentionPolicy (Aggregate Root)

**Purpose:** Defines rules for how long different categories of audit data must be preserved, based on regulatory requirements and tenant configuration.

#### Fields

| Field | Type | Description |
|---|---|---|
| `policyId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `name` | `String` | Policy name |
| `description` | `String` | Policy description |
| `rules` | `List<RetentionRule>` | Individual retention rules |
| `gdprRightToErasureEnabled` | `Boolean` | Whether pseudonymization is enabled |
| `gdprPseudonymizationRules` | `List<PseudonymizationRule>` | GDPR data handling rules |
| `archiveToColdStorage` | `Boolean` | Whether to archive to S3 after hot period |
| `status` | `PolicyStatus` | `ACTIVE`, `DRAFT`, `ARCHIVED` |
| `lastExecutedAt` | `Instant?` | Last retention enforcement execution |

#### Value Object: RetentionRule

```kotlin
data class RetentionRule(
    val ruleId: UUID,
    val auditCategory: AuditCategory,     // Which category this applies to
    retentionDays: Int,                   // How long to keep in hot storage
    warmRetentionDays: Int?,               // Additional days in warm storage
    coldRetentionDays: Int?,               // Additional days in cold storage
    archiveFormat: ArchiveFormat,         // PARQUET, JSON, CSV
    compressOnArchive: Boolean,            // Compress when moving to cold
    legalHold: Boolean,                   // Data cannot be purged if legal hold
    `standard: ComplianceStandard?`        // Regulatory basis for this rule
)
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.audit.application.port.outbound

import com.fleetvision.audit.domain.model.aggregate.*
import com.fleetvision.audit.domain.model.valueobject.*
import com.fleetvision.audit.application.query.*
import java.time.Instant
import java.util.UUID

// --- Hot Storage (PostgreSQL, 90 days) ---

/**
 * Append-only audit entry repository.
 * Supports only INSERT operations. UPDATE and DELETE are forbidden at the DB level.
 */
interface AuditEntryRepository {
    /**
     * Append a single audit entry. This is the ONLY write operation permitted.
     */
    fun append(entry: AuditEntry): AuditEntry

    /**
     * Batch append multiple audit entries for high-throughput ingestion.
     */
    fun appendBatch(entries: List<AuditEntry>): Int

    /**
     * Find a single entry by ID (read-only).
     */
    fun findById(entryId: UUID): AuditEntry?

    /**
     * Get audit trail for a specific entity across all actions.
     */
    fun findTrailByEntity(
        entityType: String, entityId: UUID,
        page: Int, size: Int
    ): PageResult<AuditEntry>

    /**
     * Get audit entries for a specific actor (user or service).
     */
    fun findByActor(
        actorId: UUID, actorType: ActorType,
        page: Int, size: Int
    ): PageResult<AuditEntry>

    /**
     * Get audit entries for a tenant with category filter.
     */
    fun findByTenantAndCategory(
        tenantId: UUID, category: AuditCategory?,
        from: Instant, to: Instant,
        page: Int, size: Int
    ): PageResult<AuditEntry>

    /**
     * Get the latest entry hash for integrity chain verification.
     */
    fun getLatestEntryHash(tenantId: UUID): String?

    /**
     * Verify integrity of the hash chain for a tenant.
     */
    fun verifyChainIntegrity(tenantId: UUID): IntegrityVerificationResult

    /**
     * Get entries ready for archival (older than hot retention period).
     */
    fun findEntriesForArchival(
        olderThan: Instant, batchSize: Int
    ): List<AuditEntry>

    /**
     * Mark entries as archived (updates only the retention_category field).
     * This is the ONLY permitted UPDATE operation.
     */
    fun markAsArchived(entryIds: List<UUID>): Int
}

// --- Full-Text Search (Elasticsearch) ---

interface AuditSearchRepository {
    /**
     * Full-text search across audit entries.
     */
    fun search(query: AuditSearchQuery): PageResult<AuditSearchResult>

    /**
     * Index an audit entry for full-text search.
     */
    fun index(entry: AuditEntry)

    /**
     * Bulk index for batch processing.
     */
    fun bulkIndex(entries: List<AuditEntry>)
}

data class AuditSearchQuery(
    val tenantId: UUID,
    val fullText: String? = null,
    val category: AuditCategory? = null,
    val action: AuditAction? = null,
    val actorId: UUID? = null,
    val entityType: String? = null,
    val entityId: UUID? = null,
    val from: Instant? = null,
    val to: Instant? = null,
    val page: Int = 0,
    val size: Int = 20
)

data class AuditSearchResult(
    val entryId: UUID,
    val timestamp: Instant,
    val action: String,
    val category: String,
    val actorSummary: String,
    val targetSummary: String,
    val highlights: Map<String, List<String>>
)

// --- Analytics Storage (ClickHouse, 1-3 years) ---

interface AuditAnalyticsRepository {
    /**
     * Aggregate audit statistics for compliance reporting.
     */
    fun getAuditStatistics(
        tenantId: UUID, from: Instant, to: Instant
    ): AuditStatisticsDto

    /**
     * Get action frequency by category.
     */
    fun getActionFrequency(
        tenantId: UUID, from: Instant, to: Instant
    ): List<ActionFrequencyDto>

    /**
     * Get actor activity summary.
     */
    fun getActorActivitySummary(
        tenantId: UUID, from: Instant, to: Instant, limit: Int = 50
    ): List<ActorActivityDto>
}

// --- Cold Storage (S3/MinIO) ---

interface ColdStorageRepository {
    /**
     * Archive audit entries to cold storage in Parquet format.
     */
    fun archive(entries: List<AuditEntry>, retentionRule: RetentionRule): ArchivalResult

    /**
     * Retrieve archived entries from cold storage.
     */
    fun retrieve(
        tenantId: UUID, from: Instant, to: Instant
    ): List<AuditEntry>

    /**
     * Purge entries that have exceeded retention period.
     * Requires explicit admin authorization and legal hold check.
     */
    fun purge(tenantId: UUID, olderThan: Instant, legalHoldCheck: Boolean): PurgeResult
}

// --- Compliance Records ---

interface ComplianceRecordRepository {
    fun save(record: ComplianceRecord): ComplianceRecord
    fun findById(recordId: UUID): ComplianceRecord?
    fun findByTenantAndStandard(
        tenantId: UUID, standard: ComplianceStandard
    ): List<ComplianceRecord>
    fun findNonCompliant(tenantId: UUID): List<ComplianceRecord>
}

// --- Data Retention Policies ---

interface DataRetentionPolicyRepository {
    fun save(policy: DataRetentionPolicy): DataRetentionPolicy
    fun findById(policyId: UUID): DataRetentionPolicy?
    fun findActiveByTenant(tenantId: UUID): DataRetentionPolicy?
    fun findPoliciesDueForExecution(date: Instant): List<DataRetentionPolicy>
}

// --- DTOs ---

data class IntegrityVerificationResult(
    val tenantId: UUID,
    val totalEntries: Long,
    val verifiedEntries: Long,
    val violations: List<IntegrityViolation>,
    val isChainIntact: Boolean
)

data class IntegrityViolation(
    val entryId: UUID,
    val expectedHash: String,
    val actualHash: String,
    val position: Long
)

data class AuditStatisticsDto(
    val tenantId: UUID,
    val totalEntries: Long,
    val entriesByCategory: Map<String, Long>,
    val entriesByAction: Map<String, Long>,
    val uniqueActors: Long,
    val mostActiveEntities: List<EntityActivitySummaryDto>
)

data class ArchivalResult(
    val entriesArchived: Int,
    val archivePath: String,
    val compressedSizeBytes: Long,
    val timestamp: Instant
)

data class PurgeResult(
    val entriesPurged: Long,
    val storageReclaimedBytes: Long,
    val timestamp: Instant
)

data class PageResult<T>(val items: List<T>, val total: Long, val page: Int, val size: Int)
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/audit`

#### Audit Log Query

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/entries/{entryId}` | Get specific audit entry | `200` `AuditEntryResponse` |
| `GET` | `/trail/{entityType}/{entityId}` | Get audit trail for entity | `200` `Page<AuditEntryResponse>` |
| `GET` | `/entries` | List audit entries with filters | `200` `Page<AuditEntryResponse>` |
| `POST` | `/search` | Full-text search across audit logs | `200` `Page<AuditSearchResultResponse>` |
| `GET` | `/actor/{actorId}` | Get entries for a specific actor | `200` `Page<AuditEntryResponse>` |
| `GET` | `/statistics` | Get audit statistics for tenant | `200` `AuditStatisticsResponse` |

#### Compliance Reports

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/compliance/standards` | List applicable compliance standards | `200` `List<StandardResponse>` |
| `GET` | `/compliance/standards/{standard}/records` | Get compliance records | `200` `Page<ComplianceRecordResponse>` |
| `GET` | `/compliance/standards/{standard}/report` | Generate compliance report | `202` `ComplianceReportResponse` |
| `GET` | `/compliance/standards/{standard}/report/{reportId}/download` | Download report | `200` File |
| `GET` | `/compliance/non-compliant` | List non-compliant items | `200` `List<ComplianceRecordResponse>` |

#### Integrity Verification

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/integrity/verify` | Verify hash chain integrity | `200` `IntegrityVerificationResponse` |
| `GET` | `/integrity/status` | Get last verification status | `200` `IntegrityStatusResponse` |

#### Data Retention

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/retention/policies` | List retention policies | `200` `List<RetentionPolicyResponse>` |
| `POST` | `/retention/policies` | Create retention policy | `201` `RetentionPolicyResponse` |
| `GET` | `/retention/policies/{policyId}` | Get policy details | `200` `RetentionPolicyDetailResponse` |
| `PUT` | `/retention/policies/{policyId}` | Update retention policy | `200` `RetentionPolicyResponse` |
| `POST` | `/retention/execute` | Trigger retention enforcement | `202` `RetentionExecutionResponse` |

#### Export

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/export` | Export audit entries | `202` `ExportResponse` |
| `GET` | `/export/{exportId}/download` | Download exported file | `200` File |
| `GET` | `/export/{exportId}/status` | Get export status | `200` `ExportStatusResponse` |

### 5.2 gRPC API

```protobuf
syntax = "proto3";
package fleetvision.audit.v1;

service AuditService {
  // Query
  rpc GetAuditTrail(GetAuditTrailRequest) returns (AuditTrailResponse);
  rpc SearchAuditLogs(SearchAuditLogsRequest) returns (AuditSearchResponse);

  // Internal: for other services to record audit entries directly
  rpc RecordAuditEntry(RecordAuditEntryRequest) returns (RecordAuditEntryResponse);

  // Compliance
  rpc GetComplianceStatus(GetComplianceStatusRequest) returns (ComplianceStatusResponse);

  // Integrity
  rpc VerifyIntegrity(VerifyIntegrityRequest) returns (VerifyIntegrityResponse);
}
```

---

## 6. Kafka Event Contracts

### 6.1 Events Consumed (Subscriber) — From ALL Services

The audit service consumes a universal audit topic that ALL services publish to:

| Source Topic | Consuming Handler | Purpose |
|---|---|---|
| `audit.entry.queued.v1` | `AuditEventConsumer` | Generic audit entry ingestion from all services |
| `audit.compliance.record.v1` | `ComplianceEventConsumer` | Compliance-specific records |

All services are expected to produce audit events to the `audit.entry.queued.v1` topic for every state-changing operation. The event payload includes all necessary data to construct an AuditEntry.

#### Audit Event Payload Schema

```kotlin
// Published to: audit.entry.queued.v1
data class AuditEventEnvelope(
    // CloudEvents envelope (as per Master Architecture Section 8.3)
    val specversion: String = "1.0",
    val type: String,                        // e.g., "audit.vehicle.updated.v1"
    val source: String,                     // e.g., "/fleet-management-service"
    val id: String,                         // Event UUID
    val time: String,                       // ISO 8601 timestamp
    val datacontenttype: String = "application/json",
    val data: AuditEventData,
    val fleetvision: FleetVisionMetadata    // tenant_id, correlation_id, etc.
)

data class AuditEventData(
    val tenantId: UUID,
    val action: String,                    // CREATE, UPDATE, DELETE, etc.
    val category: String,                  // FLEET, VEHICLE, DRIVER, etc.
    val actor: AuditActorData,
    val target: AuditTargetData,
    val changes: List<ChangeDetailData>?,
    val metadata: Map<String, Any>,
    val sourceEventType: String,            // The original domain event type
    val sourceEventId: UUID                 // The original domain event ID
)

data class AuditActorData(
    val userId: UUID?,
    val serviceAccountId: String?,
    val type: String,                      // USER, SERVICE, SYSTEM
    val ipAddress: String?,
    val userAgent: String?,
    val sessionId: String?
)

data class AuditTargetData(
    val entityType: String,
    val entityId: UUID,
    val entityVersion: Int?,
    val resourceName: String?
)
```

### 6.2 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `audit.entry.recorded.v1` | `AuditEntryRecordedEvent` | `tenantId` | By tenant |
| `audit.integrity.violation.v1` | `AuditIntegrityViolationEvent` | `tenantId` | By tenant |
| `audit.compliance.report-generated.v1` | `ComplianceReportGeneratedEvent` | `tenantId` | By tenant |
| `audit.retention.executed.v1` | `RetentionExecutedEvent` | `tenantId` | By tenant |

### 6.3 Consumer Group Configuration

```yaml
kafka:
  consumer:
    groups:
      audit-entry-ingester:
        topics:
          - audit.entry.queued.v1
        concurrency: 8              # High concurrency for write throughput
        auto-offset-reset: earliest
        max-poll-records: 1000
        batch-size: 100             # Batch insert for performance
      audit-compliance-consumer:
        topics:
          - audit.compliance.record.v1
        concurrency: 2
```

---

## 7. Append-Only Architecture

### 7.1 Database Design (PostgreSQL)

```sql
-- V1.0.0__audit_log_schema.sql

-- Append-only audit log table (partitioned by month)
CREATE TABLE audit_entries (
    entry_id              UUID NOT NULL,
    tenant_id             UUID NOT NULL,
    timestamp             TIMESTAMP WITH TIME ZONE NOT NULL,
    action                VARCHAR(30) NOT NULL,
    category              VARCHAR(50) NOT NULL,
    actor_type            VARCHAR(20) NOT NULL,
    actor_user_id         UUID,
    actor_service_account VARCHAR(200),
    actor_ip_address      VARCHAR(45),
    actor_user_agent      VARCHAR(500),
    actor_session_id      VARCHAR(200),
    target_entity_type    VARCHAR(100) NOT NULL,
    target_entity_id      UUID NOT NULL,
    target_entity_version INT,
    target_resource_name  VARCHAR(500),
    source_service        VARCHAR(100) NOT NULL,
    source_event_type     VARCHAR(200) NOT NULL,
    source_event_id       UUID NOT NULL,
    correlation_id        UUID NOT NULL,
    changes               JSONB,
    metadata              JSONB,
    integrity_hash        VARCHAR(64) NOT NULL,
    previous_entry_hash   VARCHAR(64),
    retention_category    VARCHAR(10) NOT NULL DEFAULT 'HOT',
    archived_at           TIMESTAMP WITH TIME ZONE,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Partition key
    PRIMARY KEY (entry_id, timestamp)
) PARTITION BY RANGE (timestamp);

-- No UPDATE or DELETE permissions granted to application role
REVOKE UPDATE, DELETE ON audit_entries FROM fleetvision_app;

-- Create monthly partitions (automated via pg_partman or manual)
-- Example for current month:
CREATE TABLE audit_entries_2026_08 PARTITION OF audit_entries
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- Indexes for query performance
CREATE INDEX idx_audit_tenant_category ON audit_entries (tenant_id, category, timestamp);
CREATE INDEX idx_audit_actor ON audit_entries (actor_user_id, timestamp) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_target ON audit_entries (target_entity_type, target_entity_id, timestamp);
CREATE INDEX idx_audit_source_event ON audit_entries (source_event_id);
CREATE INDEX idx_audit_correlation ON audit_entries (correlation_id);
CREATE INDEX idx_audit_retention ON audit_entries (retention_category, timestamp);

-- Row-Level Security
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit ON audit_entries
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Compliance records (append-only)
CREATE TABLE compliance_records (
    record_id                UUID NOT NULL,
    tenant_id               UUID NOT NULL,
    standard                VARCHAR(50) NOT NULL,
    requirement_id          VARCHAR(100) NOT NULL,
    requirement_description TEXT NOT NULL,
    status                  VARCHAR(30) NOT NULL,
    evidence                JSONB,
    assessed_by             UUID NOT NULL,
    assessed_at             TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until             TIMESTAMP WITH TIME ZONE,
    remediation_plan        TEXT,
    related_audit_entry_ids UUID[],
    integrity_hash          VARCHAR(64) NOT NULL,
    previous_record_hash    VARCHAR(64),
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (record_id)
);

REVOKE UPDATE, DELETE ON compliance_records FROM fleetvision_app;

-- Data retention policies
CREATE TABLE data_retention_policies (
    policy_id        UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL,
    name             VARCHAR(200) NOT NULL,
    description      TEXT,
    rules            JSONB NOT NULL,
    gdpr_rte_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    gdpr_rules       JSONB,
    archive_cold     BOOLEAN NOT NULL DEFAULT TRUE,
    status           VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    last_executed_at TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    version          INT NOT NULL DEFAULT 1
);

-- Integrity verification results (append-only log of checks)
CREATE TABLE integrity_verifications (
    verification_id  UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL,
    total_entries    BIGINT NOT NULL,
    verified_entries BIGINT NOT NULL,
    is_chain_intact  BOOLEAN NOT NULL,
    violations       JSONB,
    executed_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### 7.2 Chain Hash Computation

```kotlin
object IntegrityHashComputer {
    /**
     * Computes the integrity hash for an audit entry using SHA-256.
     * Hash = SHA-256(
     *   entryId + timestamp + action + category +
     *   actor summary + target summary + changes hash +
     *   previousEntryHash
     * )
     */
    fun computeHash(entry: AuditEntry, previousHash: String?): String {
        val data = buildString {
            append(entry.entryId)
            append(entry.timestamp.toEpochMilli())
            append(entry.action.name)
            append(entry.category.name)
            append(entry.actor.userId?.toString() ?: "")
            append(entry.actor.serviceAccountId ?: "")
            append(entry.target.entityType)
            append(entry.target.entityId)
            append(entry.changes?.hashCode()?.toString() ?: "")
            append(previousHash ?: "GENESIS")
        }
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(data.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }
}
```

### 7.3 Append-Only Enforcement

```kotlin
// PostgreSQL trigger to prevent UPDATE/DELETE on audit_entries
// This trigger runs even if the application has elevated permissions
//
// CREATE OR REPLACE FUNCTION prevent_audit_entry_modification()
// RETURNS TRIGGER AS $$
// BEGIN
//     RAISE EXCEPTION 'Audit entries are append-only. Modification prohibited.';
// END;
// $$ LANGUAGE plpgsql;
//
// CREATE TRIGGER no_update_audit_entries
//     BEFORE UPDATE ON audit_entries
//     FOR EACH ROW EXECUTE FUNCTION prevent_audit_entry_modification();
//
// CREATE TRIGGER no_delete_audit_entries
//     BEFORE DELETE ON audit_entries
//     FOR EACH ROW EXECUTE FUNCTION prevent_audit_entry_modification();
```

---

## 8. Data Retention & Compliance

### 8.1 Default Retention Policies

| Category | Hot (PostgreSQL) | Warm (ClickHouse) | Cold (S3) | Total | Regulatory Basis |
|---|---|---|---|---|---|
| Authentication | 90 days | 1 year | 3 years | ~4 years | SOC 2, ISO 27001 |
| Authorization | 90 days | 1 year | 3 years | ~4 years | SOC 2 |
| Fleet/Vehicle CRUD | 90 days | 1 year | 7 years | ~8 years | Internal |
| Driver (PII) | 90 days | 0 | 3 years (pseudonymized) | ~3 years | GDPR, CCPA |
| Compliance (HOS/DVIR) | 90 days | 1 year | 7 years | ~8 years | FMCSA |
| Billing | 90 days | 2 years | 7 years | ~10 years | PCI DSS, IRS |
| Tenant Management | 90 days | 1 year | 7 years | ~8 years | SOC 2 |

### 8.2 GDPR Right to Erasure (Pseudonymization)

```kotlin
/**
 * GDPR compliance: Data cannot be deleted from audit logs (regulatory requirement),
 * but PII can be pseudonymized. This replaces user-identifiable data with hashes
 * while preserving the audit trail structure.
 */
class PseudonymizationService {

    fun pseudonymizeActor(actor: AuditActor): AuditActor {
        return actor.copy(
            userId = actor.userId?.let { hashForErasure(it) },
            ipAddress = actor.ipAddress?.let { hashForErasure(it) },
            userAgent = "[REDACTED]",
            sessionId = "[REDACTED]"
        )
    }

    fun pseudonymizeChanges(changes: Map<String, ChangeDetail>?): Map<String, ChangeDetail>? {
        // Hash values in fields that contain PII
        return changes?.mapValues { (_, detail) ->
            detail.copy(
                oldValue = detail.oldValue?.let { redactIfPII(it) },
                newValue = detail.newValue?.let { redactIfPII(it) }
            )
        }
    }

    private fun hashForErasure(value: Any): String {
        // One-way hash with GDPR-specific salt
        val digest = MessageDigest.getInstance("SHA-256")
        val salted = "$value:GDPR_ERASURE_SALT"
        return digest.digest(salted.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
```

### 8.3 Archival Workflow

```
1. Daily: DataRetentionJob checks for entries older than hot retention period
2. Batch select entries WHERE timestamp < (NOW() - hot_retention_days)
3. Write to S3 in Parquet format: s3://fleetvision-audit/{tenant_id}/year={year}/month={month}/
4. Insert into ClickHouse warm storage
5. Mark entries as ARCHIVED in PostgreSQL (only permitted UPDATE)
6. Weekly: ArchiveToColdStorageJob moves from warm to cold
7. Monthly: Purge entries that exceed total retention + legal hold check
```

---

## 9. Dependencies & External Integrations

### 9.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| ALL services | Kafka (async) | Consume audit events | High-throughput ingestion |
| `notification-service` | Kafka (async) | Alert on integrity violations | Fire-and-forget |

### 9.2 External Integrations

| Integration | Protocol | Purpose |
|---|---|---|
| **PostgreSQL** | TCP | Primary append-only storage |
| **Elasticsearch** | TCP | Full-text search indexing |
| **ClickHouse** | TCP | Analytical queries on warm data |
| **MinIO/S3** | S3 API | Cold storage archival |
| **Kafka** | TCP | Event ingestion pipeline |

---

## 10. Configuration Properties

```yaml
# application.yml
audit:
  service:
    name: audit-log-service

  ingestion:
    batch-size: 100
    batch-flush-interval-ms: 1000
    max-concurrent-batches: 5
    dead-letter-topic: audit.entry.dlq.v1
    max-retry-attempts: 3
    retry-backoff-ms: 1000

  integrity:
    verification-cron: "0 3 * * *"    # Daily at 3 AM
    alert-on-violation: true
    hash-algorithm: SHA-256

  search:
    elasticsearch-index: fleetvision-audit
    index-refresh-interval-seconds: 5
    max-search-results: 10000
    highlight-enabled: true

  retention:
    default-hot-days: 90
    default-warm-days: 365
    default-cold-days: 2555
    enforcement-cron: "0 2 * * *"   # Daily at 2 AM
    archive-format: PARQUET
    compression: SNAPPY
    cold-storage-bucket: fleetvision-audit-archive
    legal-hold-check-enabled: true
    purge-confirmation-required: true

  gdpr:
    pseudonymization-enabled: true
    erasure-salt: ${GDPR_ERASURE_SALT}
    redacted-placeholder: "[GDPR_REDACTED]"

  export:
    max-entries-per-export: 100000
    supported-formats:
      - CSV
      - JSON
      - PDF
    async-export-enabled: true
    export-ttl-hours: 24

  compliance:
    standards:
      - SOC2_TYPE_II
      - ISO_27001
      - GDPR
      - FMCSA_ELD
    report-generation-cron: "0 0 1 * *"  # Monthly on 1st
    report-retention-days: 365

server:
  port: 8096

spring:
  application:
    name: audit-log-service

  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:fleetvision_audit}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:}
    hikari:
      maximum-pool-size: 30
      minimum-idle: 10

  elasticsearch:
    uris: ${ES_URIS:http://localhost:9200}
    index-prefix: fleetvision-audit

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    consumer:
      group-id: audit-log-service
      auto-offset-reset: earliest
      max-poll-records: 1000
      properties:
        spring.json.trusted.packages: "*"

  clickhouse:
    url: ${CLICKHOUSE_URL:clickhouse://localhost:9000}
    database: fleetvision_audit

grpc:
  server:
    port: 9100

resilience4j:
  circuitbreaker:
    instances:
      elasticsearch:
        slidingWindowSize: 10
        failureRateThreshold: 60
        waitDurationInOpenState: 30s
      clickhouse:
        slidingWindowSize: 10
        failureRateThreshold: 60
        waitDurationInOpenState: 30s
  retry:
    instances:
      elasticsearch:
        maxAttempts: 3
        waitDuration: 1s
      clickhouse:
        maxAttempts: 3
        waitDuration: 1s
  timelimiter:
    instances:
      elasticsearch:
        timeoutDuration: 5s
      clickhouse:
        timeoutDuration: 10s
```

---

## 11. Resilience Patterns

### 11.1 Circuit Breaker Configuration

| Target Service | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| Elasticsearch | 10 calls | 60% | 30s | 3 |
| ClickHouse | 10 calls | 60% | 30s | 3 |
| S3/MinIO | 10 calls | 60% | 60s | 3 |

### 11.2 Retry Configuration

| Operation | Max Attempts | Backoff | Retryable Errors |
|---|---|---|---|
| Audit entry batch insert | 3 | 1s exponential | Connection timeout, constraint violation |
| Elasticsearch indexing | 3 | 1s exponential | Connection timeout, 429 rate limit |
| ClickHouse insert | 3 | 2s exponential | Connection timeout |
| S3 archival upload | 5 | 2s exponential | Network error, 5xx |

### 11.3 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| Batch insert (PostgreSQL) | 2s | Dead letter queue |
| Elasticsearch indexing | 5s | Skip indexing; retry async |
| ClickHouse analytics query | 10s | Return partial results from PostgreSQL |
| S3 archival upload | 30s | Retry on next batch cycle |
| Integrity verification | 60s | Report timeout; continue next scheduled run |

### 11.4 Graceful Degradation

- **PostgreSQL unavailable:** Buffer audit events in a local write-ahead log (filesystem); replay when connection restored. Events are NOT lost.
- **Elasticsearch unavailable:** Audit entries are still persisted in PostgreSQL. Search functionality degrades to PostgreSQL LIKE queries. Indexing is retried when ES recovers.
- **ClickHouse unavailable:** Analytics queries fall back to PostgreSQL (slower for large date ranges). Archival to cold storage continues.
- **S3 unavailable:** Archival is retried. Entries remain in warm/cold storage until S3 is available.
- **Kafka consumer lag:** Prioritize entries based on compliance category (COMPLIANCE > AUTH > others).

---

## 12. Test Strategy

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | JUnit 5 + MockK + Kotest | 90% | Hash chain computation, pseudonymization logic, retention rule evaluation, integrity verification |
| **Integration Tests** | Spring Boot Test + Testcontainers | 80% | Append-only enforcement, batch ingestion, Elasticsearch indexing, ClickHouse analytics |
| **Security Tests** | Spring Security Test | Critical | RBAC enforcement, tenant isolation, unauthorized modification attempts |
| **Integrity Tests** | Kotest | Critical | Hash chain verification, tampering detection, chain reconstruction |
| **GDPR Compliance Tests** | Kotest | Critical | Pseudonymization correctness, PII redaction, right-to-erasure workflow |
| **Performance Tests** | Gatling + JMeter | SLO validation | Write throughput (50K entries/sec), batch insert latency, search query latency |
| **Retention Tests** | Testcontainers | High | Archival workflow, warm-to-cold migration, purge enforcement, legal hold blocking |

### Key Test Scenarios

1. **Append-Only Enforcement:** Attempt to UPDATE or DELETE an audit entry via direct SQL with application role -> rejected with error
2. **Hash Chain Integrity:** Insert 100 entries -> verify chain -> tamper with entry 50 hash -> verify detects violation at entry 51
3. **Batch Ingestion:** Ingest 10,000 audit events from Kafka in < 5 seconds via batch inserts
4. **GDPR Pseudonymization:** Request right-to-erasure for user -> actor PII replaced with hashes -> original data unrecoverable
5. **Full-Text Search:** Search for "password reset" across all audit entries -> returns matching entries with highlights
6. **Archival Workflow:** Entries older than 90 days -> archived to S3 Parquet -> marked as ARCHIVED in PostgreSQL
7. **Retention Enforcement:** Entries older than total retention + no legal hold -> purged from all storage tiers
8. **Legal Hold:** Attempt to purge entries under legal hold -> blocked with error
9. **Compliance Report:** Generate SOC 2 compliance report -> covers all applicable controls -> downloadable PDF
10. **Tenant Isolation:** Tenant A queries audit entries -> cannot see Tenant B entries (RLS enforced)

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
