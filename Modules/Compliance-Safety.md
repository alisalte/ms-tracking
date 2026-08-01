# Compliance & Safety Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Service:** `compliance-service`
**Bounded Context:** Compliance & Safety

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Designs](#3-aggregate-root-designs)
4. [Repository Interfaces](#4-repository-interfaces)
5. [API Endpoints](#5-api-endpoints)
6. [Kafka Event Contracts](#6-kafka-event-contracts)
7. [Dependencies & External Integrations](#7-dependencies--external-integrations)
8. [Configuration Properties](#8-configuration-properties)
9. [Resilience Patterns](#9-resilience-patterns)
10. [Test Strategy](#10-test-strategy)

---

## 1. Module Overview & Context Mapping

### 1.1 Purpose

The Compliance & Safety context enforces regulatory compliance for fleet operations, including FMCSA Electronic Logging Device (ELD) mandates, Hours of Service (HOS) tracking, Driver Vehicle Inspection Reports (DVIR), and incident management. It provides an immutable, audit-critical event trail for every regulatory event.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                  COMPLIANCE & SAFETY CONTEXT                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  HOSLog      │  │ DVIRInspection│  │  Incident    │          │
│  │  (Aggregate) │  │  (Aggregate) │  │  (Aggregate) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  Event Sourcing: ALL aggregates are event-sourced               │
└────────┬──────────┬──────────────────┬───────────────┬───────────┘
         │          │                  │               │
    ┌────┴───┐  ┌───┴─────┐     ┌──────┴──────┐  ┌────┴─────┐
    │Tracking│  │  Driver  │     │  Trip &    │  │ Notifi-  │
    │& GPS   │  │  Mgmt    │     │  Route     │  │ cation   │
    └────────┘  └──────────┘     └─────────────┘  └──────────┘
```

**Upstream (produces events consumed by):**
- `notification-service` — HOS violation alerts, incident escalation alerts
- `analytics-engine` — Compliance KPI aggregation
- `audit-log-service` — Regulatory audit trail entries

**Downstream (consumes events from):**
- `tracking-service` — Position events (for HOS drive time derivation)
- `driver-management-service` — Driver assignment, license status changes
- `trip-management-service` — Trip start/end (HOS log triggers)

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **HOSLog** | Event-sourced aggregate representing a driver's Hours of Service record for a duty period |
| **DutyStatus** | Enum: `OFF_DUTY`, `SLEEPER_BERTH`, `DRIVING`, `ON_DUTY_NOT_DRIVING` |
| **DVIRInspection** | Event-sourced aggregate for a Driver Vehicle Inspection Report (pre-trip or post-trip) |
| **Defect** | A vehicle deficiency identified during a DVIR inspection with severity and corrective action |
| **Incident** | Event-sourced aggregate representing a safety incident (accident, near-miss, violation) |
| **ELDExport** | A formatted export of HOS data in FMCSA-compliant format for regulatory submission |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                   compliance-service                             │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST Controllers│  │  gRPC Service Implementations│   │  │
│  │  │  (Spring MVC)    │  │  (ComplianceServiceGrpcImpl) │   │  │
│  │  └────────┬────────┘  └──────────────┬───────────────┘   │  │
│  │           │                          │                    │  │
│  │  ┌────────┴────────┐  ┌─────────────┴──────────────┐    │  │
│  │  │  DTO Mappers   │  │  Event Publishers (Kafka)  │    │  │
│  │  │  (MapStruct)   │  │  (DomainEventPublisher)   │    │  │
│  │  └─────────────────┘  └──────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Command Handlers                                  │    │  │
│  │  │  • RecordDutyStatusChangeCommandHandler            │    │  │
│  │  │  • SubmitDVIRInspectionCommandHandler               │    │  │
│  │  │  • RecordIncidentCommandHandler                      │    │  │
│  │  │  • DefectCorrectiveActionCommandHandler               │    │  │
│  │  │  • GenerateHOSExportCommandHandler                    │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Query Handlers (CQRS)                              │    │  │
│  │  │  • GetHOSLogQueryHandler                             │    │  │
│  │  │  • GetDVIRHistoryQueryHandler                         │    │  │
│  │  │  • GetIncidentDetailsQueryHandler                    │    │  │
│  │  │  • GetDriverHOSSummaryQueryHandler                    │    │  │
│  │  │  • GetFleetComplianceReportQueryHandler               │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Services                                    │    │  │
│  │  │  • HOSEligibilityCalculator                         │    │  │
│  │  │  • ViolationDetector                                 │    │  │
│  │  │  • ELDExportFormatter (FMCSA-compliant)              │    │  │
│  │  │  • InspectionScheduler                              │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Aggregate Roots (Event-Sourced)                   │    │  │
│  │  │  • HOSLog                                           │    │  │
│  │  │  • DVIRInspection                                   │    │  │
│  │  │  • Incident                                         │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • DutyStatus, DutySegment, LocationSnapshot        │    │  │
│  │  │  • DefectSeverity, DefectCategory                   │    │  │
│  │  │  • IncidentSeverity, IncidentType                   │    │  │
│  │  │  • ViolationType, ViolationPenalty                  │    │  │
│  │  │  • InspectionType (PRE_TRIP / POST_TRIP)            │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Events                                      │    │  │
│  │  │  (see Section 6)                                    │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Event Store (PostgreSQL + EventStoreDB)          │    │  │
│  │  │  • HOSLogEventStoreRepository                      │    │  │
│  │  │  • DVIRInspectionEventStoreRepository              │    │  │
│  │  │  • IncidentEventStoreRepository                     │    │  │
│  │  │  • SnapshotStoreRepository                          │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Read Model Projections (PostgreSQL / ClickHouse)  │    │  │
│  │  │  • HOSLogReadModelRepository                        │    │  │
│  │  │  • DVIRReadModelRepository                          │    │  │
│  │  │  • IncidentReadModelRepository                       │    │  │
│  │  │  • ComplianceDashboardProjection                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Kafka Consumers (EventDrivenProjectionManager)    │    │  │
│  │  │  • PositionEventConsumer (from tracking-service)   │    │  │
│  │  │  • DriverAssignmentConsumer (from driver-mgmt)       │    │  │
│  │  │  • TripLifecycleConsumer (from trip-mgmt)           │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  External Adapters (Anti-Corruption Layers)        │    │  │
│  │  │  • FMCSAReportingAdapter (EDI/XML submission)      │    │  │
│  │  │  • ELDMalfunctionAlertAdapter                       │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
com.fleetvision.compliance/
├── api/
│   ├── rest/
│   │   ├── HOSController.kt
│   │   ├── DVIRController.kt
│   │   ├── IncidentController.kt
│   │   └── ComplianceReportController.kt
│   └── grpc/
│       ├── ComplianceServiceGrpcImpl.kt
│       └── proto/
├── application/
│   ├── command/
│   │   ├── RecordDutyStatusChangeCommand.kt
│   │   ├── SubmitDVIRInspectionCommand.kt
│   │   ├── RecordIncidentCommand.kt
│   │   ├── DefectCorrectiveActionCommand.kt
│   │   └── GenerateHOSExportCommand.kt
│   ├── commandhandler/
│   │   ├── RecordDutyStatusChangeCommandHandler.kt
│   │   ├── SubmitDVIRInspectionCommandHandler.kt
│   │   ├── RecordIncidentCommandHandler.kt
│   │   ├── DefectCorrectiveActionCommandHandler.kt
│   │   └── GenerateHOSExportCommandHandler.kt
│   ├── query/
│   │   ├── GetHOSLogQuery.kt
│   │   ├── GetDVIRHistoryQuery.kt
│   │   ├── GetIncidentDetailsQuery.kt
│   │   ├── GetDriverHOSSummaryQuery.kt
│   │   └── GetFleetComplianceReportQuery.kt
│   ├── queryhandler/
│   │   ├── GetHOSLogQueryHandler.kt
│   │   ├── GetDVIRHistoryQueryHandler.kt
│   │   ├── GetIncidentDetailsQueryHandler.kt
│   │   ├── GetDriverHOSSummaryQueryHandler.kt
│   │   └── GetFleetComplianceReportQueryHandler.kt
│   ├── service/
│   │   ├── HOSEligibilityCalculator.kt
│   │   ├── ViolationDetector.kt
│   │   ├── ELDExportFormatter.kt
│   │   └── InspectionScheduler.kt
│   └── port/
│       ├── inbound/
│       │   ├── CommandPort.kt
│       │   └── QueryPort.kt
│       └── outbound/
│           ├── EventStorePort.kt
│           ├── HOSLogReadModelPort.kt
│           ├── DVIRReadModelPort.kt
│           ├── IncidentReadModelPort.kt
│           └── FMCSAReportingPort.kt
├── domain/
│   ├── model/
│   │   ├── aggregate/
│   │   │   ├── HOSLog.kt
│   │   │   ├── DVIRInspection.kt
│   │   │   └── Incident.kt
│   │   ├── valueobject/
│   │   │   ├── DutyStatus.kt
│   │   │   ├── DutySegment.kt
│   │   │   ├── LocationSnapshot.kt
│   │   │   ├── DefectSeverity.kt
│   │   │   ├── DefectCategory.kt
│   │   │   ├── InspectionType.kt
│   │   │   ├── IncidentSeverity.kt
│   │   │   ├── IncidentType.kt
│   │   │   ├── ViolationType.kt
│   │   │   └── ViolationPenalty.kt
│   │   └── event/
│   │       ├── HOSLogCreatedEvent.kt
│   │       ├── DutyStatusChangedEvent.kt
│   │       ├── HOSViolationDetectedEvent.kt
│   │       ├── DVIRInspectionCreatedEvent.kt
│   │       ├── DefectRecordedEvent.kt
│   │       ├── DefectCorrectedEvent.kt
│   │       ├── IncidentCreatedEvent.kt
│   │       ├── IncidentUpdatedEvent.kt
│   │       └── IncidentResolvedEvent.kt
│   └── service/
│       └── ComplianceRuleEngine.kt
├── infrastructure/
│   ├── config/
│   │   └── ComplianceServiceConfiguration.kt
│   ├── persistence/
│   │   ├── eventstore/
│   │   │   ├── HOSLogEventStoreRepositoryImpl.kt
│   │   │   ├── DVIRInspectionEventStoreRepositoryImpl.kt
│   │   │   ├── IncidentEventStoreRepositoryImpl.kt
│   │   │   └── SnapshotStoreRepositoryImpl.kt
│   │   ├── readmodel/
│   │   │   ├── HOSLogReadModelRepositoryImpl.kt
│   │   │   ├── DVIRReadModelRepositoryImpl.kt
│   │   │   ├── IncidentReadModelRepositoryImpl.kt
│   │   │   └── ComplianceDashboardProjection.kt
│   │   └── entity/
│   │       ├── HOSLogEntryEntity.kt
│   │       ├── DVIRRecordEntity.kt
│   │       └── IncidentRecordEntity.kt
│   ├── messaging/
│   │   ├── producer/
│   │   │   └── ComplianceEventPublisher.kt
│   │   └── consumer/
│   │       ├── PositionEventConsumer.kt
│   │       ├── DriverAssignmentConsumer.kt
│   │       └── TripLifecycleConsumer.kt
│   └── adapter/
│       ├── fmcsa/
│       │   └── FMCSAReportingAdapter.kt
│       └── eld/
│           └── ELDMalfunctionAlertAdapter.kt
└── ComplianceServiceApplication.kt
```

---

## 3. Aggregate Root Designs

### 3.1 HOSLog (Event-Sourced Aggregate Root)

**Purpose:** Immutable record of a driver's duty status changes for a single duty period (24-hour rolling window or multi-day cycle).

#### Fields

| Field | Type | Description |
|---|---|---|
| `hosLogId` | `HOSLogId` (UUID) | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `driverId` | `DriverId` (UUID) | Driver performing the duty |
| `vehicleId` | `VehicleId` (UUID) | Vehicle being operated |
| `cycleStart` | `Instant` | Beginning of the HOS cycle |
| `dutySegments` | `List<DutySegment>` | Ordered list of duty status changes |
| `currentStatus` | `DutyStatus` | Current duty status |
| `cycleDrivingMinutes` | `Long` | Total driving minutes in current 8-day cycle |
| `dayDrivingMinutes` | `Long` | Total driving minutes in current 24-hour period |
| `dayOnDutyMinutes` | `Long` | Total on-duty minutes in current 24-hour period |
| `violations` | `List<HOSViolation>` | Detected violations |
| `status` | `HOSLogStatus` | `ACTIVE`, `CERTIFIED`, `ANNOTATED` |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `createHOSLog()` | driverId, vehicleId, cycleStart, initialStatus | `HOSLogCreatedEvent` | Driver must be active, vehicle assigned |
| `recordDutyStatusChange()` | newStatus, location, timestamp, annotation, sequenceId | `DutyStatusChangedEvent` | Sequential order enforced; sequenceId must be > last |
| `certifyLog()` | driverSignature, certifierId, timestamp | `HOSLogCertifiedEvent` | All segments must be present; no unacknowledged violations |
| `annotateSegment()` | sequenceId, annotation, annotatorId | `HOSLogAnnotatedEvent` | Segment must exist; log must be in CERTIFIED status |

#### Invariants

1. **Sequential Integrity:** Duty segments must be strictly ordered by `sequenceId` with no gaps.
2. **HOS Cycle Limit:** `cycleDrivingMinutes` must not exceed 70 hours in any 8-day cycle (FMCSA property-carrying).
3. **Daily Driving Limit:** `dayDrivingMinutes` must not exceed 11 hours in a 24-hour period.
4. **Daily On-Duty Limit:** `dayOnDutyMinutes` must not exceed 14 hours (60-hour/70-hour rule applies).
5. **30-Minute Break:** After 8 cumulative driving hours, a 30-minute off-duty/sleeper-berth break must occur before further driving.
6. **Immutability:** Once `HOSLogStatus.CERTIFIED`, no new segments can be added; only annotations are permitted.

#### Value Object: DutySegment

```kotlin
@JvmInline
value class DutySegment private constructor(val data: DutySegmentData) {
    data class DutySegmentData(
        val sequenceId: Long,
        val status: DutyStatus,       // OFF_DUTY | SLEEPER_BERTH | DRIVING | ON_DUTY_NOT_DRIVING
        val startTimestamp: Instant,
        val endTimestamp: Instant?,
        val location: LocationSnapshot?,
        val annotation: String?,
        val odometerKm: Long?,
        val engineHours: Double?
    )
}
```

#### Domain Events

```kotlin
// Event naming: compliance.hos.<event>.v1
data class HOSLogCreatedEvent(
    val hosLogId: UUID,
    val tenantId: UUID,
    val driverId: UUID,
    val vehicleId: UUID,
    val cycleStart: Instant,
    val initialStatus: DutyStatus,
    val timestamp: Instant
)

data class DutyStatusChangedEvent(
    val hosLogId: UUID,
    val tenantId: UUID,
    val driverId: UUID,
    val vehicleId: UUID,
    val sequenceId: Long,
    val previousStatus: DutyStatus,
    val newStatus: DutyStatus,
    val location: LocationSnapshot?,
    val annotation: String?,
    val odometerKm: Long?,
    val engineHours: Double?,
    val timestamp: Instant
)

data class HOSViolationDetectedEvent(
    val hosLogId: UUID,
    val tenantId: UUID,
    val driverId: UUID,
    val vehicleId: UUID,
    val violationType: ViolationType,
    val violationMinutes: Long,
    val segmentSequenceId: Long,
    val penalty: ViolationPenalty,
    val timestamp: Instant
)

data class HOSLogCertifiedEvent(
    val hosLogId: UUID,
    val tenantId: UUID,
    val driverId: UUID,
    val driverSignature: String,
    val certifierId: UUID,
    val timestamp: Instant
)

data class HOSLogAnnotatedEvent(
    val hosLogId: UUID,
    val tenantId: UUID,
    val segmentSequenceId: Long,
    val annotation: String,
    val annotatorId: UUID,
    val timestamp: Instant
)
```

---

### 3.2 DVIRInspection (Event-Sourced Aggregate Root)

**Purpose:** Records pre-trip and post-trip vehicle inspections per FMCSA requirements.

#### Fields

| Field | Type | Description |
|---|---|---|
| `inspectionId` | `DVIRInspectionId` (UUID) | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `driverId` | `DriverId` (UUID) | Driver performing the inspection |
| `vehicleId` | `VehicleId` (UUID) | Vehicle being inspected |
| `tripId` | `TripId` (UUID?) | Associated trip, if applicable |
| `inspectionType` | `InspectionType` | `PRE_TRIP` or `POST_TRIP` |
| `vehicleCondition` | `VehicleCondition` | `SATISFACTORY`, `DEFECT_FOUND`, `UNSATISFACTORY` |
| `defects` | `List<Defect>` | Identified defects |
| `odometerReading` | `Long` | Odometer at inspection time |
| `location` | `LocationSnapshot` | Inspection location |
| `driverSignature` | `String` | Digital signature of driver |
| `mechanicSignature` | `String?` | Mechanic signature for corrective actions |
| `status` | `DVIRStatus` | `DRAFT`, `SUBMITTED`, `REVIEWED`, `CORRECTED` |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `startInspection()` | driverId, vehicleId, inspectionType, location, odometer | `DVIRInspectionCreatedEvent` | Driver must be assigned to vehicle |
| `addDefect()` | component, description, severity, category, photoUrls | `DefectRecordedEvent` | Inspection must be in DRAFT status |
| `submitInspection()` | driverSignature | `DVIRInspectionSubmittedEvent` | At least one inspection section completed; signature required |
| `recordCorrectiveAction()` | defectId, action, mechanicId, mechanicSignature, partsUsed | `DefectCorrectedEvent` | Defect must exist; mechanic must be authorized |
| `closeInspection()` | — | `DVIRInspectionClosedEvent` | All defects must be corrected or acknowledged |

#### Invariants

1. **Pre-Trip Requirement:** A `PRE_TRIP` inspection must be completed and `vehicleCondition != UNSATISFACTORY` before the vehicle can be driven.
2. **Post-Trip Requirement:** A `POST_TRIP` inspection must be completed within 1 hour of trip completion.
3. **Critical Defect Blocking:** Any defect with `DefectSeverity.CRITICAL` sets `vehicleCondition = UNSATISFACTORY`, preventing vehicle dispatch.
4. **Signature Requirement:** Both driver and mechanic signatures are cryptographically verified.
5. **Defect Immutability:** Once a defect is recorded, its description cannot be modified; only corrective action can be appended.

#### Value Object: Defect

```kotlin
data class Defect(
    val defectId: UUID,
    val component: VehicleComponent,       // e.g., BRAKES, TIRES, LIGHTS, MIRRORS
    val description: String,
    val severity: DefectSeverity,           // MINOR, MAJOR, CRITICAL
    val category: DefectCategory,           // SAFETY, OPERATIONAL, COSMETIC
    val photoUrls: List<String>,
    val correctiveAction: CorrectiveAction?,
    val recordedAt: Instant,
    val correctedAt: Instant?
)

enum class VehicleComponent {
    BRAKES, TIRES, LIGHTS, MIRRORS, HORN, WINDSHIELD, WIPERS,
    STEERING, SUSPENSION, EXHAUST, COUPLING, EMERGENCY_EQUIPMENT,
    ENGINE, TRANSMISSION, FUEL_SYSTEM, ELECTRICAL
}
```

#### Domain Events

```kotlin
// Event naming: compliance.dvir.<event>.v1
data class DVIRInspectionCreatedEvent(
    val inspectionId: UUID, val tenantId: UUID,
    val driverId: UUID, val vehicleId: UUID, val tripId: UUID?,
    val inspectionType: InspectionType, val odometerReading: Long,
    val location: LocationSnapshot, val timestamp: Instant
)

data class DefectRecordedEvent(
    val inspectionId: UUID, val tenantId: UUID, val defectId: UUID,
    val vehicleId: UUID, val component: VehicleComponent,
    val description: String, val severity: DefectSeverity,
    val category: DefectCategory, val photoUrls: List<String>,
    val timestamp: Instant
)

data class DVIRInspectionSubmittedEvent(
    val inspectionId: UUID, val tenantId: UUID, val vehicleId: UUID,
    val vehicleCondition: VehicleCondition, val driverSignature: String,
    val timestamp: Instant
)

data class DefectCorrectedEvent(
    val inspectionId: UUID, val tenantId: UUID, val defectId: UUID,
    val vehicleId: UUID, val action: String, val mechanicId: UUID,
    val mechanicSignature: String, val partsUsed: List<String>,
    val timestamp: Instant
)
```

---

### 3.3 Incident (Event-Sourced Aggregate Root)

**Purpose:** Records safety incidents including accidents, near-misses, and regulatory violations. Provides full audit trail for insurance and legal purposes.

#### Fields

| Field | Type | Description |
|---|---|---|
| `incidentId` | `IncidentId` (UUID) | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `driverId` | `DriverId` (UUID) | Driver involved |
| `vehicleId` | `VehicleId` (UUID) | Vehicle involved |
| `tripId` | `TripId` (UUID?) | Associated trip |
| `incidentType` | `IncidentType` | `ACCIDENT`, `NEAR_MISS`, `VIOLATION`, `THEFT`, `BREAKDOWN` |
| `severity` | `IncidentSeverity` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `location` | `LocationSnapshot` | Incident location |
| `timestamp` | `Instant` | When the incident occurred |
| `description` | `String` | Narrative description |
| `photoUrls` | `List<String>` | Incident photos |
| `witnesses` | `List<Witness>` | Witness information |
| `policeReportNumber` | `String?` | Police report reference |
| `insuranceClaimId` | `String?` | Insurance claim reference |
| `rootCauseAnalysis` | `String?` | RCA findings |
| `correctiveActions` | `List<CorrectiveAction>` | Preventive measures |
| `estimatedCost` | `BigDecimal?` | Estimated financial impact |
| `status` | `IncidentStatus` | `OPEN`, `UNDER_INVESTIGATION`, `RESOLVED`, `CLOSED` |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `recordIncident()` | type, severity, description, location, driverId, vehicleId, timestamp | `IncidentCreatedEvent` | Driver must exist; vehicle must be active |
| `attachEvidence()` | photoUrls, documents, witnessStatements | `IncidentEvidenceAttachedEvent` | Incident must be in OPEN or UNDER_INVESTIGATION status |
| `assignInvestigator()` | investigatorId, priority | `IncidentAssignedEvent` | Only users with SAFETY_INVESTIGATOR role |
| `updateInvestigation()` | findings, rootCauseAnalysis, policeReportNumber | `IncidentUpdatedEvent` | Incident must be in UNDER_INVESTIGATION status |
| `addCorrectiveAction()` | action, assignee, dueDate | `IncidentCorrectiveActionAddedEvent` | Incident must be in UNDER_INVESTIGATION or RESOLVED |
| `resolveIncident()` | resolution, insuranceClaimId, estimatedCost | `IncidentResolvedEvent` | All corrective actions must be completed |
| `closeIncident()` | — | `IncidentClosedEvent` | Incident must be RESOLVED; at least 48h must have elapsed |

#### Invariants

1. **Critical Incident SLA:** `IncidentSeverity.CRITICAL` incidents must be assigned to an investigator within 1 hour.
2. **Evidence Chain of Custody:** All attached evidence is immutable once added; deletions require admin approval.
3. **Cost Tracking:** `estimatedCost` can only increase; decreases require justification and approval.
4. **Closure Requirements:** All corrective actions must be completed; insurance claim (if applicable) must have a status.
5. **Status Flow:** `OPEN -> UNDER_INVESTIGATION -> RESOLVED -> CLOSED` (strict state machine).

#### Domain Events

```kotlin
// Event naming: compliance.incident.<event>.v1
data class IncidentCreatedEvent(
    val incidentId: UUID, val tenantId: UUID,
    val driverId: UUID, val vehicleId: UUID, val tripId: UUID?,
    val incidentType: IncidentType, val severity: IncidentSeverity,
    val location: LocationSnapshot, val description: String,
    val timestamp: Instant
)

data class IncidentEvidenceAttachedEvent(
    val incidentId: UUID, val tenantId: UUID,
    val photoUrls: List<String>, val documentUrls: List<String>,
    val witnessStatements: List<Witness>, val timestamp: Instant
)

data class IncidentAssignedEvent(
    val incidentId: UUID, val tenantId: UUID,
    val investigatorId: UUID, val priority: Priority, val timestamp: Instant
)

data class IncidentUpdatedEvent(
    val incidentId: UUID, val tenantId: UUID,
    val rootCauseAnalysis: String?, val policeReportNumber: String?,
    val updatedBy: UUID, val timestamp: Instant
)

data class IncidentResolvedEvent(
    val incidentId: UUID, val tenantId: UUID,
    val resolution: String, val insuranceClaimId: String?,
    val estimatedCost: BigDecimal?, val resolvedBy: UUID, val timestamp: Instant
)

data class IncidentClosedEvent(
    val incidentId: UUID, val tenantId: UUID,
    val closedBy: UUID, val timestamp: Instant
)
```

---

## 4. Repository Interfaces

### 4.1 Event Store Repositories (Write Side)

```kotlin
package com.fleetvision.compliance.application.port.outbound

import com.fleetvision.compliance.domain.model.aggregate.HOSLog
import com.fleetvision.compliance.domain.model.aggregate.DVIRInspection
import com.fleetvision.compliance.domain.model.aggregate.Incident
import com.fleetvision.compliance.domain.model.event.*
import java.util.UUID

/**
 * Event Store Port for HOSLog aggregate.
 * Append-only event storage; aggregates reconstructed via event replay.
 */
interface EventStorePort<T : Any> {
    fun save(aggregateId: UUID, events: List<DomainEvent>, expectedVersion: Long)
    fun load(aggregateId: UUID): List<DomainEvent>
    fun load(aggregateId: UUID, upToVersion: Long): List<DomainEvent>
}

/**
 * Snapshot Store Port for event-sourced aggregates.
 * Periodically snapshotted to avoid full event replay.
 */
interface SnapshotStorePort<T : Any> {
    fun saveSnapshot(aggregateId: UUID, aggregate: T, version: Long)
    fun loadSnapshot(aggregateId: UUID): Pair<T, Long>?
}

/**
 * Specific typed event store repositories.
 */
interface HOSLogEventStoreRepository : EventStorePort<HOSLog>
interface DVIRInspectionEventStoreRepository : EventStorePort<DVIRInspection>
interface IncidentEventStoreRepository : EventStorePort<Incident>

interface HOSLogSnapshotRepository : SnapshotStorePort<HOSLog>
interface DVIRInspectionSnapshotRepository : SnapshotStorePort<DVIRInspection>
interface IncidentSnapshotRepository : SnapshotStorePort<Incident>
```

### 4.2 Read Model Repositories (Query Side — CQRS)

```kotlin
package com.fleetvision.compliance.application.port.outbound

import com.fleetvision.compliance.application.query.*
import java.time.Instant
import java.util.UUID

/**
 * Read model for HOS log queries — optimized for dashboard and reporting.
 */
interface HOSLogReadModelPort {
    fun findByDriverAndDateRange(driverId: UUID, from: Instant, to: Instant): List<HOSLogSummaryDto>
    fun findActiveByDriver(driverId: UUID): HOSLogSummaryDto?
    fun findViolationsByTenant(tenantId: UUID, from: Instant, to: Instant): List<HOSViolationDto>
    fun findDriverHOSSummary(driverId: UUID): DriverHOSSummaryDto
    fun findFleetHOSSummary(tenantId: UUID): FleetHOSSummaryDto
}

/**
 * Read model for DVIR inspection queries.
 */
interface DVIRReadModelPort {
    fun findByVehicleAndDateRange(vehicleId: UUID, from: Instant, to: Instant): List<DVIRSummaryDto>
    fun findByDriver(driverId: UUID, page: Int, size: Int): PageResult<DVIRSummaryDto>
    fun findOpenDefects(vehicleId: UUID): List<DefectDto>
    fun findDefectStatsByFleet(tenantId: UUID, from: Instant, to: Instant): FleetDefectStatsDto
}

/**
 * Read model for incident queries.
 */
interface IncidentReadModelPort {
    fun findById(incidentId: UUID): IncidentDetailDto?
    fun findByTenant(tenantId: UUID, page: Int, size: Int, filters: IncidentFilterDto): PageResult<IncidentSummaryDto>
    fun findOpenIncidents(tenantId: UUID): List<IncidentSummaryDto>
    fun findIncidentStatsByFleet(tenantId: UUID, from: Instant, to: Instant): FleetIncidentStatsDto
}

// DTOs
data class HOSLogSummaryDto(
    val hosLogId: UUID, val driverId: UUID, val vehicleId: UUID,
    val cycleStart: Instant, val currentStatus: String,
    val cycleDrivingMinutes: Long, val dayDrivingMinutes: Long,
    val violationCount: Int, val status: String
)

data class HOSViolationDto(
    val hosLogId: UUID, val driverId: UUID, val violationType: String,
    val violationMinutes: Long, val penalty: String, val timestamp: Instant
)

data class DVIRSummaryDto(
    val inspectionId: UUID, val vehicleId: UUID, val driverId: UUID,
    val inspectionType: String, val vehicleCondition: String,
    val defectCount: Int, val status: String, val timestamp: Instant
)

data class DefectDto(
    val defectId: UUID, val component: String, val description: String,
    val severity: String, val status: String, val recordedAt: Instant, val correctedAt: Instant?
)

data class IncidentDetailDto(
    val incidentId: UUID, val incidentType: String, val severity: String,
    val description: String, val status: String, val rootCauseAnalysis: String?,
    val estimatedCost: BigDecimal?, val correctiveActions: List<CorrectiveActionDto>
)

data class IncidentSummaryDto(
    val incidentId: UUID, val incidentType: String, val severity: String,
    val driverId: UUID, val vehicleId: UUID, val status: String,
    val createdAt: Instant
)

data class PageResult<T>(val items: List<T>, val total: Long, val page: Int, val size: Int)

data class IncidentFilterDto(
    val severity: String? = null, val type: String? = null,
    val status: String? = null, val driverId: UUID? = null,
    val vehicleId: UUID? = null, val from: Instant? = null, val to: Instant? = null
)
```

---

## 5. API Endpoints

### 5.1 REST API (Spring MVC)

Base path: `/api/v1/compliance`

#### HOS / ELD Endpoints

| Method | Path | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/hos/logs` | Create a new HOS log | `CreateHOSLogRequest` | `201` `HOSLogResponse` |
| `POST` | `/hos/logs/{hosLogId}/duty-status` | Record duty status change | `DutyStatusChangeRequest` | `200` `DutySegmentResponse` |
| `GET` | `/hos/logs/{hosLogId}` | Get HOS log by ID | — | `200` `HOSLogDetailResponse` |
| `GET` | `/hos/drivers/{driverId}/logs` | Get driver's HOS logs by date range | `?from=&to=` | `200` `Page<HOSLogSummaryResponse>` |
| `GET` | `/hos/drivers/{driverId}/summary` | Get driver HOS summary (current cycle) | — | `200` `DriverHOSSummaryResponse` |
| `POST` | `/hos/logs/{hosLogId}/certify` | Certify and sign HOS log | `CertifyHOSLogRequest` | `200` `HOSLogResponse` |
| `POST` | `/hos/logs/{hosLogId}/segments/{sequenceId}/annotate` | Annotate a duty segment | `AnnotateSegmentRequest` | `200` `DutySegmentResponse` |
| `GET` | `/hos/export/{hosLogId}` | Export HOS log in ELD format | `?format=eld|json` | `200` ELD file / JSON |
| `GET` | `/hos/fleet/{fleetId}/summary` | Fleet-wide HOS compliance summary | `?from=&to=` | `200` `FleetHOSSummaryResponse` |

#### DVIR Inspection Endpoints

| Method | Path | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/dvir/inspections` | Start a new DVIR inspection | `CreateDVIRRequest` | `201` `DVIRInspectionResponse` |
| `POST` | `/dvir/inspections/{inspectionId}/defects` | Add defect to inspection | `AddDefectRequest` | `200` `DefectResponse` |
| `POST` | `/dvir/inspections/{inspectionId}/submit` | Submit inspection | `SubmitDVIRRequest` | `200` `DVIRInspectionResponse` |
| `GET` | `/dvir/inspections/{inspectionId}` | Get inspection by ID | — | `200` `DVIRDetailResponse` |
| `GET` | `/dvir/vehicles/{vehicleId}/inspections` | Get vehicle DVIR history | `?from=&to=&type=` | `200` `Page<DVIRSummaryResponse>` |
| `GET` | `/dvir/vehicles/{vehicleId}/defects/open` | Get open defects for vehicle | — | `200` `List<DefectResponse>` |
| `POST` | `/dvir/defects/{defectId}/correct` | Record corrective action | `CorrectDefectRequest` | `200` `DefectResponse` |
| `POST` | `/dvir/inspections/{inspectionId}/close` | Close inspection | — | `200` `DVIRInspectionResponse` |

#### Incident Endpoints

| Method | Path | Description | Request | Response |
|---|---|---|---|---|
| `POST` | `/incidents` | Record a new incident | `CreateIncidentRequest` | `201` `IncidentResponse` |
| `POST` | `/incidents/{incidentId}/evidence` | Attach evidence | `AttachEvidenceRequest` | `200` `IncidentResponse` |
| `POST` | `/incidents/{incidentId}/assign` | Assign investigator | `AssignInvestigatorRequest` | `200` `IncidentResponse` |
| `PUT` | `/incidents/{incidentId}` | Update investigation | `UpdateIncidentRequest` | `200` `IncidentResponse` |
| `GET` | `/incidents/{incidentId}` | Get incident by ID | — | `200` `IncidentDetailResponse` |
| `GET` | `/incidents` | List incidents with filters | `?severity=&type=&status=&driverId=&vehicleId=&page=&size=` | `200` `Page<IncidentSummaryResponse>` |
| `GET` | `/incidents/open` | Get all open incidents for tenant | — | `200` `List<IncidentSummaryResponse>` |
| `POST` | `/incidents/{incidentId}/resolve` | Resolve incident | `ResolveIncidentRequest` | `200` `IncidentResponse` |
| `POST` | `/incidents/{incidentId}/close` | Close incident | — | `200` `IncidentResponse` |

#### Compliance Reports

| Method | Path | Description | Request | Response |
|---|---|---|---|---|
| `GET` | `/reports/fleet-compliance` | Fleet compliance dashboard data | `?from=&to=&fleetId=` | `200` `FleetComplianceReportResponse` |

### 5.2 gRPC API

```protobuf
syntax = "proto3";
package fleetvision.compliance.v1;

service ComplianceService {
  // HOS Operations
  rpc RecordDutyStatusChange(RecordDutyStatusChangeRequest) returns (DutySegmentResponse);
  rpc GetHOSLog(GetHOSLogRequest) returns (HOSLogResponse);
  rpc GetDriverHOSCurrentStatus(GetDriverHOSRequest) returns (DriverHOSCurrentResponse);

  // DVIR Operations
  rpc GetVehicleOpenDefects(GetVehicleDefectsRequest) returns (DefectListResponse);
  rpc ValidatePreTripInspection(ValidatePreTripRequest) returns (ValidationResponse);

  // Incident Operations
  rpc GetIncidentSummary(GetIncidentSummaryRequest) returns (IncidentSummaryResponse);
  rpc StreamOpenIncidents(StreamOpenIncidentsRequest) returns (stream IncidentSummaryResponse);

  // Fleet Operations (internal, called by analytics/notifications)
  rpc GetFleetComplianceSnapshot(GetFleetComplianceRequest) returns (FleetComplianceSnapshotResponse);
}
```

### 5.3 Sample Request/Response DTOs

```kotlin
// REST DTOs
data class CreateHOSLogRequest(
    val driverId: UUID,
    val vehicleId: UUID,
    val initialStatus: String  // OFF_DUTY, SLEEPER_BERTH, DRIVING, ON_DUTY_NOT_DRIVING
)

data class DutyStatusChangeRequest(
    val newStatus: String,
    val location: LocationDto?,
    val annotation: String?,
    val odometerKm: Long?,
    val engineHours: Double?,
    val clientTimestamp: Instant
)

data class CreateIncidentRequest(
    val driverId: UUID,
    val vehicleId: UUID,
    val tripId: UUID?,
    val incidentType: String,
    val severity: String,
    val description: String,
    val location: LocationDto,
    val timestamp: Instant
)

data class LocationDto(
    val latitude: Double,
    val longitude: Double,
    val address: String?,
    val elevation: Double?
)
```

---

## 6. Kafka Event Contracts

### 6.1 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `compliance.hos.log-created.v1` | `HOSLogCreatedEvent` | `tenantId` | By tenant for locality |
| `compliance.hos.duty-status-changed.v1` | `DutyStatusChangedEvent` | `driverId` | By driver |
| `compliance.hos.violation-detected.v1` | `HOSViolationDetectedEvent` | `tenantId` | By tenant |
| `compliance.dvir.inspection-created.v1` | `DVIRInspectionCreatedEvent` | `vehicleId` | By vehicle |
| `compliance.dvir.defect-recorded.v1` | `DefectRecordedEvent` | `vehicleId` | By vehicle |
| `compliance.dvir.inspection-submitted.v1` | `DVIRInspectionSubmittedEvent` | `vehicleId` | By vehicle |
| `compliance.dvir.defect-corrected.v1` | `DefectCorrectedEvent` | `vehicleId` | By vehicle |
| `compliance.incident.created.v1` | `IncidentCreatedEvent` | `tenantId` | By tenant |
| `compliance.incident.updated.v1` | `IncidentUpdatedEvent` | `incidentId` | By incident |
| `compliance.incident.resolved.v1` | `IncidentResolvedEvent` | `tenantId` | By tenant |

All events follow the CloudEvents v1.0 envelope specified in the Master Architecture (Section 8.3).

### 6.2 Events Consumed (Subscriber)

| Source Topic | Consuming Handler | Purpose |
|---|---|---|
| `tracking.position.updated.v1` | `PositionEventConsumer` | Derive drive time segments for HOS logs; detect movement during off-duty periods |
| `driver.assignment.changed.v1` | `DriverAssignmentConsumer` | Update HOS log vehicle association on driver-vehicle reassignment |
| `trip.lifecycle.changed.v1` | `TripLifecycleConsumer` | Trigger post-trip DVIR requirement; update HOS log cycle boundaries |
| `driver.license.expired.v1` | `DriverLicenseStatusConsumer` | Flag driver as ineligible for duty; alert fleet managers |
| `fleet.vehicle.maintenance-completed.v1` | `MaintenanceCompletionConsumer` | Auto-close critical defects when maintenance is completed |

### 6.3 Kafka Consumer Group Configuration

```yaml
kafka:
  consumer:
    groups:
      compliance-position-processor:
        topics:
          - tracking.position.updated.v1
        concurrency: 3
        auto-offset-reset: latest
        max-poll-records: 500
      compliance-driver-assignment:
        topics:
          - driver.assignment.changed.v1
          - driver.license.expired.v1
        concurrency: 2
      compliance-trip-lifecycle:
        topics:
          - trip.lifecycle.changed.v1
          - fleet.vehicle.maintenance-completed.v1
        concurrency: 2
```

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| `driver-management-service` | gRPC | Validate driver status, license, assignments | Circuit breaker, 5s timeout |
| `trip-management-service` | Kafka (async) | Trip lifecycle events | Eventual consistency |
| `tracking-service` | Kafka (async) | GPS position events for HOS derivation | Eventual consistency |
| `fleet-management-service` | gRPC | Validate vehicle assignment, fleet membership | Circuit breaker, 3s timeout |
| `identity-service` | gRPC | Validate user roles (SAFETY_INVESTIGATOR) | Circuit breaker, 2s timeout |
| `notification-service` | Kafka (async) | Publish violation alerts, incident escalations | Fire-and-forget |
| `audit-log-service` | Kafka (async) | Publish compliance audit events | Fire-and-forget |

### 7.2 External Integrations

| Integration | Protocol | Purpose | Adapter |
|---|---|---|---|
| **FMCSA** | EDI/XML via HTTPS | ELD data export, regulatory filing | `FMCSAReportingAdapter` |
| **Insurance Platforms** | REST API | Submit incident claims, fetch claim status | `InsuranceClaimAdapter` |
| **Weather Services** | REST API | Enrich incident reports with weather conditions | `WeatherDataAdapter` |

### 7.3 Spring Boot Dependencies

```kotlin
// build.gradle.kts
dependencies {
    // Core
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")

    // gRPC
    implementation("net.devh:grpc-spring-boot-starter:3.1.0.RELEASE")
    implementation("io.grpc:grpc-protobuf:1.62.2")
    implementation("io.grpc:grpc-stub:1.62.2")

    // Kafka
    implementation("org.springframework.kafka:spring-kafka")
    implementation("io.confluent:kafka-avro-serializer:7.6.0")

    // Event Sourcing
    implementation("org.axonframework:axon-spring-boot-starter:4.9.0")
    implementation("org.axonframework.extensions.kafka:axon-kafka-spring-boot-starter:4.9.0")

    // Database
    runtimeOnly("org.postgresql:postgresql")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")

    // Resilience
    implementation("io.github.resilience4j:resilience4j-spring-boot3:2.2.0")
    implementation("io.github.resilience4j:resilience4j-kotlin:2.2.0")

    // Observability
    implementation("io.micrometer:micrometer-tracing-bridge-brave")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.axonframework:axon-test:4.9.0")
    testImplementation("io.mockk:mockk:1.13.10")
    testImplementation("org.testcontainers:kafka:1.19.7")
    testImplementation("org.testcontainers:postgresql:1.19.7")
}
```

---

## 8. Configuration Properties

```yaml
# application.yml
compliance:
  service:
    name: compliance-service

  hos:
    cycle-driving-limit-minutes: 4200     # 70 hours
    day-driving-limit-minutes: 660        # 11 hours
    day-on-duty-limit-minutes: 840        # 14 hours
    break-required-after-minutes: 480      # 8 hours
    break-duration-minutes: 30
    cycle-days: 8
    snapshot-every-n-events: 50

  dvir:
    pre-trip-required: true
    post-trip-deadline-minutes: 60
    critical-defect-blocks-dispatch: true
    defect-photo-max-size-mb: 10
    defect-photo-max-count: 5
    signature-timeout-seconds: 300

  incident:
    critical-assignment-sla-minutes: 60
    minimum-close-delay-hours: 48
    evidence-max-size-mb: 50
    evidence-max-files: 20

  fmcsa:
    export-format: eld
    endpoint-url: https://_fmcsa_gov_endpoint
    retry-max-attempts: 3
    retry-backoff-ms: 5000

  event-store:
    snapshot-threshold: 50
    max-events-per-append: 10

server:
  port: 8090

spring:
  application:
    name: compliance-service

  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:fleetvision_compliance}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5

  jpa:
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    producer:
      key-serializer: io.confluent.kafka.serializers.KafkaAvroSerializer
      value-serializer: io.confluent.kafka.serializers.KafkaAvroSerializer
      acks: all
      retries: 3
    consumer:
      group-id: compliance-service
      auto-offset-reset: latest
      key-deserializer: io.confluent.kafka.serializers.KafkaAvroDeserializer
      value-deserializer: io.confluent.kafka.serializers.KafkaAvroDeserializer
      properties:
        schema.registry.url: ${SCHEMA_REGISTRY_URL:http://localhost:8081}

grpc:
  server:
    port: 9095
  client:
    driver-management:
      address: static://driver-management-service:9091
      negotiation-type: tls
    fleet-management:
      address: static://fleet-management-service:9092
      negotiation-type: tls
    identity-service:
      address: static://identity-service:9090
      negotiation-type: tls

resilience4j:
  circuitbreaker:
    instances:
      driverManagement:
        registerHealthIndicator: true
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
        permittedNumberOfCallsInHalfOpenState: 3
      fleetManagement:
        registerHealthIndicator: true
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
  retry:
    instances:
      driverManagement:
        maxAttempts: 3
        waitDuration: 500ms
        retryOnException: true
      fmcsaReporting:
        maxAttempts: 3
        waitDuration: 5s
        retryOnException: true
  timelimiter:
    instances:
      driverManagement:
        timeoutDuration: 5s
        cancelRunningFuture: true
      fleetManagement:
        timeoutDuration: 3s
        cancelRunningFuture: true
      identityService:
        timeoutDuration: 2s
        cancelRunningFuture: true
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configuration

| Target Service | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| `driver-management-service` (gRPC) | 10 calls | 50% | 30s | 3 |
| `fleet-management-service` (gRPC) | 10 calls | 50% | 30s | 3 |
| `identity-service` (gRPC) | 10 calls | 50% | 30s | 3 |
| FMCSA Reporting (REST) | 5 calls | 60% | 60s | 2 |

### 9.2 Retry Configuration

| Operation | Max Attempts | Backoff | Retryable Errors |
|---|---|---|---|
| gRPC calls (internal) | 3 | 500ms exponential | `UNAVAILABLE`, `DEADLINE_EXCEEDED` |
| FMCSA export | 3 | 5s fixed | HTTP 502, 503, 504, timeout |
| Event publishing | 3 | 1s exponential | `RetriableException` from Kafka |

### 9.3 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| gRPC: Validate driver | 5s | Reject with `DRIVER_SERVICE_UNAVAILABLE` |
| gRPC: Validate vehicle | 3s | Reject with `VEHICLE_SERVICE_UNAVAILABLE` |
| gRPC: Validate user role | 2s | Reject with `AUTH_SERVICE_UNAVAILABLE` |
| FMCSA reporting | 30s | Queue for retry via dead letter queue |
| Event store append | 2s | Optimistic concurrency conflict error |

### 9.4 Bulkhead Configuration

| Pool | Core Size | Max Size | Queue Capacity | Timeout |
|---|---|---|---|---|
| gRPC internal calls | 10 | 20 | 50 | 5s |
| FMCSA external calls | 2 | 4 | 10 | 30s |
| Database connection pool | 5 | 20 | — | 5s |

### 9.5 Graceful Degradation

- **Position events lag:** If tracking-service position events fall behind, HOS drive-time derivation degrades to self-reported status only (with a data quality warning flag).
- **Driver service unavailable:** Duty status changes are accepted with `DRIVER_UNVERIFIED` status; automatically reconciled when driver service recovers.
- **FMCSA unavailable:** ELD exports are queued locally and retried; a compliance alert is sent to fleet managers.

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | JUnit 5 + MockK + Kotest | 90% | Aggregate behavior, domain services, invariants, event production |
| **Integration Tests** | Spring Boot Test + Testcontainers (Kafka + PostgreSQL) | 80% | Command handlers, query handlers, event store, read model projections |
| **Contract Tests** | Pact | 100% of consumers | gRPC contracts with driver-mgmt, fleet-mgmt; REST contracts with API gateway |
| **End-to-End Tests** | Testcontainers + Karate DSL | Critical paths | Full flow: create HOS log -> record duty changes -> detect violation -> alert |
| **Performance Tests** | Gatling + JMeter | SLO validation | HOS log throughput, DVIR concurrent inspections, event replay latency |
| **Chaos Tests** | Chaos Mesh | Critical dependencies | Circuit breaker triggers, Kafka partition failure, database failover |

### 10.2 Domain Test Examples

```kotlin
@ExtendWith(MockKExtension::class)
class HOSLogAggregateTest {

    @Test
    fun `should create HOS log with initial duty status`() {
        val driverId = UUID.randomUUID()
        val vehicleId = UUID.randomUUID()
        val log = HOSLog.create(
            driverId = driverId,
            vehicleId = vehicleId,
            tenantId = UUID.randomUUID(),
            cycleStart = Instant.now(),
            initialStatus = DutyStatus.OFF_DUTY
        )
        assertEquals(DutyStatus.OFF_DUTY, log.currentStatus)
        assertEquals(0L, log.cycleDrivingMinutes)
        assertTrue(log.uncommittedEvents.any { it is HOSLogCreatedEvent })
    }

    @Test
    fun `should detect 11-hour daily driving violation`() {
        val log = givenInitializedHOSLog()
        // Simulate 11 hours of driving
        repeat(66) { i ->  // 66 segments of 10 minutes each = 660 minutes = 11 hours
            log.recordDutyStatusChange(
                newStatus = DutyStatus.DRIVING,
                location = null,
                timestamp = log.cycleStart.plusMillis(i * 600_000L),
                annotation = null,
                odometerKm = i * 5,
                engineHours = null,
                sequenceId = (i + 1).toLong()
            )
        }
        assertTrue(log.violations.any { it.type == ViolationType.DAILY_DRIVING_EXCEEDED })
    }

    @Test
    fun `should reject duty status change out of sequence`() {
        val log = givenInitializedHOSLog()
        assertThrows<InvariantViolationException> {
            log.recordDutyStatusChange(
                newStatus = DutyStatus.DRIVING,
                location = null,
                timestamp = Instant.now(),
                annotation = null,
                odometerKm = 100,
                engineHours = null,
                sequenceId = 99L  // Gap from sequenceId 1
            )
        }
    }

    @Test
    fun `should prevent modification of certified HOS log`() {
        val log = givenCertifiedHOSLog()
        assertThrows<InvariantViolationException> {
            log.recordDutyStatusChange(/* ... */)
        }
    }
}
```

### 10.3 Integration Test Example

```kotlin
@SpringBootTest
@Testcontainers
class DVIRInspectionIntegrationTest {

    @Container
    private val kafka = KafkaContainer(DockerImageName.parse("confluentinc/cp-kafka:7.6.0"))

    @Container
    private val postgres = PostgreSQLContainer("postgres:16-alpine")

    @Test
    fun `should persist DVIR inspection events and project to read model`() {
        val command = SubmitDVIRInspectionCommand(
            inspectionId = UUID.randomUUID(),
            driverId = UUID.randomUUID(),
            vehicleId = UUID.randomUUID(),
            inspectionType = InspectionType.PRE_TRIP,
            defects = listOf(/* ... */),
            driverSignature = "base64-encoded-signature"
        )
        commandHandler.handle(command)

        // Verify read model projection
        val readModel = dvirReadModelPort.findByVehicleAndDateRange(
            command.vehicleId, Instant.now().minusHours(1), Instant.now()
        )
        assertEquals(1, readModel.size)
        assertEquals("SUBMITTED", readModel[0].status)
    }
}
```

### 10.4 Database Schema (Migration)

```sql
-- V1.0.0__compliance_event_store.sql

CREATE TABLE compliance_event_stream (
    aggregate_id      UUID NOT NULL,
    aggregate_type    VARCHAR(50) NOT NULL,
    sequence_number   BIGINT NOT NULL,
    event_type        VARCHAR(200) NOT NULL,
    event_data        JSONB NOT NULL,
    metadata          JSONB NOT NULL,
    timestamp         TIMESTAMP WITH TIME ZONE NOT NULL,
    tenant_id         UUID NOT NULL,
    PRIMARY KEY (aggregate_id, sequence_number)
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_event_stream_aggregate_type ON compliance_event_stream (aggregate_type, timestamp);
CREATE INDEX idx_event_stream_tenant ON compliance_event_stream (tenant_id, timestamp);

CREATE TABLE compliance_snapshots (
    aggregate_id      UUID NOT NULL,
    aggregate_type    VARCHAR(50) NOT NULL,
    snapshot_version  BIGINT NOT NULL,
    snapshot_data     JSONB NOT NULL,
    timestamp         TIMESTAMP WITH TIME ZONE NOT NULL,
    tenant_id         UUID NOT NULL,
    PRIMARY KEY (aggregate_id, snapshot_version)
);

-- CQRS Read Models

CREATE TABLE hos_log_read_model (
    hos_log_id        UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    driver_id         UUID NOT NULL,
    vehicle_id        UUID NOT NULL,
    cycle_start       TIMESTAMP WITH TIME ZONE NOT NULL,
    current_status    VARCHAR(50) NOT NULL,
    cycle_driving_mins BIGINT NOT NULL DEFAULT 0,
    day_driving_mins  BIGINT NOT NULL DEFAULT 0,
    day_on_duty_mins  BIGINT NOT NULL DEFAULT 0,
    violation_count   INT NOT NULL DEFAULT 0,
    status            VARCHAR(30) NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE dvir_read_model (
    inspection_id     UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    driver_id         UUID NOT NULL,
    vehicle_id        UUID NOT NULL,
    trip_id           UUID,
    inspection_type   VARCHAR(20) NOT NULL,
    vehicle_condition VARCHAR(30) NOT NULL,
    defect_count      INT NOT NULL DEFAULT 0,
    status            VARCHAR(30) NOT NULL,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE incident_read_model (
    incident_id       UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    driver_id         UUID NOT NULL,
    vehicle_id        UUID NOT NULL,
    trip_id           UUID,
    incident_type     VARCHAR(30) NOT NULL,
    severity          VARCHAR(20) NOT NULL,
    description       TEXT NOT NULL,
    status            VARCHAR(30) NOT NULL,
    root_cause_analysis TEXT,
    estimated_cost    DECIMAL(12,2),
    investigator_id   UUID,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Row-Level Security
ALTER TABLE compliance_event_stream ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE hos_log_read_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvir_read_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_read_model ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_event_stream ON compliance_event_stream
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY tenant_isolation_hos ON hos_log_read_model
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY tenant_isolation_dvir ON dvir_read_model
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY tenant_isolation_incident ON incident_read_model
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
