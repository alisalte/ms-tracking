# Driver Management Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Driver Management
**Service:** `driver-management-service`
**Data Store:** PostgreSQL 16 (driver profiles, licenses, assignments), MongoDB (behavior profiles, inspection forms)
**Messaging:** Kafka (domain events)

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Design](#3-aggregate-root-design)
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

The Driver Management context manages the complete lifecycle of fleet drivers, from onboarding and license verification to behavior scoring, fatigue monitoring, and regulatory compliance. It handles driver profiles, license management (expiry monitoring, endorsement tracking), driving behavior analysis (speeding, harsh braking, idling), and driver-vehicle assignment. The context integrates closely with Compliance & Safety for Hours of Service (HOS) tracking and with Trip & Route Management for dispatch.

### 1.2 Context Map

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  IDENTITY & ACCESS MGMT       │     │  TRIP & ROUTE MGMT             │
│  ACL: Driver user accounts,   │     │  Consumes: Driver events,     │
│  role bindings               │     │  assignment eligibility        │
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │                                    │
┌───────────────┴───────────────┐     ┌───────────────┴───────────────┐
│  TRACKING & MONITORING       │◄────│  DRIVER MANAGEMENT              │
│  Produces: Speed events,     │     │  (This Context)                 │
│  driving behavior events     │     │                                  │
└───────────────┬───────────────┘     └───────┬───────────┬───────────┘
                │                             │           │
┌───────────────┴───────────────┐     ┌───────┴───┐ ┌───┴───────────┐
│  COMPLIANCE & SAFETY          │     │ FLEET      │ │ NOTIFICATION   │
│  Consumes: License alerts,   │     │ MANAGEMENT │ │ SERVICE        │
│  HOS events                   │     │ (driver    │ │ (license exp,  │
│                              │     │  assign)   │ │  behavior)    │
└───────────────────────────────┘     └───────────┘ └───────────────┘
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **Driver** | A person authorized to operate fleet vehicles; holds a profile with license, certifications, and behavior history |
| **DriverProfile** | The core aggregate containing personal info, employment status, license data, and certifications |
| **License** | A government-issued driving credential with class, endorsements, restrictions, and expiration date |
| **BehaviorScore** | A composite numeric score (0-100) reflecting a driver's safety behavior based on speeding, braking, cornering, and idling events |
| **DriverAssignment** | The binding of a driver to a vehicle and optionally a trip for a specific period |
| **Certification** | A professional qualification (e.g., HazMat, CDL, Tanker endorsement) required for specific vehicle types |
| **FatigueStatus** | The current fatigue state of a driver: `FRESH`, `MODERATE`, `FATIGUED`, `EXHAUSTED` |
| **DrivingEvent** | A recorded behavioral event (harsh brake, rapid acceleration, sharp turn, speed violation) linked to a driver and vehicle |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DRIVER-MANAGEMENT-SERVICE (Spring Boot 3.3 + Kotlin)     │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ PostgreSQL   │ │ MongoDB      │ │ Redis        │ │ Kafka      │ │  │
│  │  │ Adapter      │ │ Adapter      │ │ Driver       │ │ Producer   │ │  │
│  │  │ (JPA)        │ │ (Behavior    │ │ Profile Cache│ │ Adapter    │ │  │
│  │  │              │ │  Profiles)   │ │              │ │            │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │  │
│  │  │ IAM          │ │ Fleet Mgmt   │ │ Compliance   │              │  │
│  │  │ gRPC Client  │ │ gRPC Client  │ │ gRPC Client  │              │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ REST Controllers │  │ gRPC Server      │  │ Event Listeners  │   │  │
│  │  │ (DriverCtrl,     │  │ (DriverMgmtGrpcSvc)│ │ (Kafka Consumer) │   │  │
│  │  │  LicenseCtrl,   │  │                   │  │                   │   │  │
│  │  │  AssignmentCtrl,│  │                   │  │                   │   │  │
│  │  │  BehaviorCtrl) │  │                   │  │                   │   │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘   │  │
│  │           │                     │                      │             │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴─────────┐   │  │
│  │  │ DTOs / Driver Mappers / Behavior Score Calculators            │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ CreateDriver      │ │ UpdateLicense    │ │ AssignDriver     │     │  │
│  │  │ UseCase           │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ UpdateBehavior   │ │ CheckDriver      │ │ DeactivateDriver │     │  │
│  │  │ ScoreUseCase      │ │ EligibilityUseCase│ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                          │  │
│  │  │ RecordDriving    │ │ GetDriverDashboard│                          │  │
│  │  │ EventUseCase      │ │ UseCase          │                          │  │
│  │  └──────────────────┘ └──────────────────┘                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ Driver       │ │ Driver       │ │ Behavior     │ │ Driving    │ │  │
│  │  │ Profile      │ │ Assignment  │ │ Score        │ │ Event      │ │  │
│  │  │ (Aggregate)  │ │ (Aggregate)  │ │ (Value Obj)  │ │ (Entity)   │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                   │  │
│  │  │ License      │ │ Certification│                                   │  │
│  │  │ (Value Obj)  │ │ (Entity)     │                                   │  │
│  │  └──────────────┘ └──────────────┘                                   │  │
│  │  Domain Services: BehaviorScoringService, DriverEligibilityService  │  │
│  │  Domain Events: DriverCreated, LicenseExpired, BehaviorScoreChanged│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design

### 3.1 DriverProfile Aggregate Root

**AggregateId:** `DriverId` (UUID)
**Consistency Scope:** Driver identity, personal data, employment status, license, certifications, and behavior score.

```kotlin
data class DriverId(val value: UUID)

enum class DriverStatus { ACTIVE, INACTIVE, SUSPENDED, TERMINATED }

data class DriverProfile(
    val id: DriverId,
    val tenantId: UUID,
    val userId: UUID?,                      // link to IAM User (if applicable)
    val employeeId: String?,                 // HR system employee ID
    val firstName: String,
    val lastName: String,
    val email: String,
    val phone: String,
    val dateOfBirth: LocalDate,
    val address: Address,
    val emergencyContact: EmergencyContact?,
    val status: DriverStatus,
    val hireDate: LocalDate?,
    val terminationDate: LocalDate?,
    // License
    val license: License?,
    // Certifications
    val certifications: List<Certification>,
    // Behavior
    val behaviorScore: BehaviorScore,
    // Driving events summary (materialized)
    val totalTripsCompleted: Long,
    val totalDistanceKm: Double,
    val totalDrivingHours: Double,
    // Metadata
    val fleetId: UUID?,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    // --- Behaviors ---

    fun activate(): DriverProfile {
        require(status in listOf(DriverStatus.INACTIVE, DriverStatus.SUSPENDED)) {
            "Cannot activate from $status"
        }
        require(license != null) { "Cannot activate driver without license info" }
        require(!license!!.isExpired()) { "Cannot activate driver with expired license" }
        return copy(status = DriverStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(DriverActivatedEvent(it)) }
    }

    fun suspend(reason: String): DriverProfile {
        require(status == DriverStatus.ACTIVE) { "Only active drivers can be suspended" }
        return copy(status = DriverStatus.SUSPENDED, updatedAt = Instant.now())
            .also { raiseDomainEvent(DriverSuspendedEvent(it, reason)) }
    }

    fun terminate(reason: String, terminationDate: LocalDate): DriverProfile {
        require(status != DriverStatus.TERMINATED) { "Already terminated" }
        return copy(
            status = DriverStatus.TERMINATED,
            terminationDate = terminationDate,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(DriverTerminatedEvent(it, reason)) }
    }

    fun updateLicense(newLicense: License): DriverProfile {
        require(status != DriverStatus.TERMINATED) { "Cannot update license for terminated driver" }
        val oldLicense = license
        val updated = copy(license = newLicense, updatedAt = Instant.now())
        // Check for expiry
        if (newLicense.isExpired() && status == DriverStatus.ACTIVE) {
            // Domain event will trigger suspension workflow at application layer
            raiseDomainEvent(LicenseExpiredEvent(updated, newLicense))
        }
        if (oldLicense == null && newLicense != null) {
            raiseDomainEvent(LicenseAddedEvent(updated, newLicense))
        }
        if (oldLicense != null && newLicense.number != oldLicense.number) {
            raiseDomainEvent(LicenseUpdatedEvent(updated, oldLicense.number, newLicense.number))
        }
        return updated
    }

    fun addCertification(certification: Certification): DriverProfile {
        require(status != DriverStatus.TERMINATED) { "Cannot add certifications for terminated driver" }
        require(certifications.none { it.type == certification.type }) {
            "Certification ${certification.type} already exists"
        }
        return copy(
            certifications = certifications + certification,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(CertificationAddedEvent(it, certification)) }
    }

    fun updateBehaviorScore(newScore: BehaviorScore): DriverProfile {
        require(newScore.score in 0.0..100.0) { "Score must be 0-100" }
        val oldScore = behaviorScore.score
        return copy(behaviorScore = newScore, updatedAt = Instant.now())
            .also { raiseDomainEvent(BehaviorScoreChangedEvent(it, oldScore, newScore.score)) }
    }

    fun recordTripCompleted(distanceKm: Double, drivingHours: Double): DriverProfile {
        require(status == DriverStatus.ACTIVE) { "Only active drivers can record trips" }
        require(distanceKm > 0) { "Distance must be positive" }
        require(drivingHours > 0) { "Driving hours must be positive" }
        return copy(
            totalTripsCompleted = totalTripsCompleted + 1,
            totalDistanceKm = totalDistanceKm + distanceKm,
            totalDrivingHours = totalDrivingHours + drivingHours,
            updatedAt = Instant.now()
        )
    }

    fun assignToFleet(fleetId: UUID): DriverProfile {
        require(fleetId == null) { "Driver is already assigned to a fleet" }
        return copy(fleetId = fleetId, updatedAt = Instant.now())
            .also { raiseDomainEvent(DriverFleetAssignedEvent(it, fleetId)) }
    }

    // --- Invariants ---
    // INV-01: email must be unique within tenant
    // INV-02: employeeId must be unique within tenant (if present)
    // INV-03: ACTIVE drivers must have a valid (non-expired) license
    // INV-04: behaviorScore must be 0-100
    // INV-05: ACTIVE drivers cannot be assigned to another fleet without reassignment
}
```

### 3.2 DriverAssignment Aggregate Root

```kotlin
data class AssignmentId(val value: UUID)

enum class AssignmentStatus { SCHEDULED, ACTIVE, COMPLETED, CANCELLED }

data class DriverAssignment(
    val id: AssignmentId,
    val tenantId: UUID,
    val driverId: UUID,
    val vehicleId: UUID,
    val tripId: UUID?,
    val fleetId: UUID,
    val status: AssignmentStatus,
    val assignedAt: Instant,
    val startedAt: Instant?,
    val completedAt: Instant?,
    val cancelledAt: Instant?,
    val cancelReason: String?,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun start(): DriverAssignment {
        require(status == AssignmentStatus.SCHEDULED) { "Only SCHEDULED assignments can be started" }
        return copy(status = AssignmentStatus.ACTIVE, startedAt = Instant.now(), updatedAt = Instant.now())
            .also { raiseDomainEvent(AssignmentStartedEvent(it)) }
    }

    fun complete(): DriverAssignment {
        require(status == AssignmentStatus.ACTIVE) { "Only ACTIVE assignments can be completed" }
        return copy(status = AssignmentStatus.COMPLETED, completedAt = Instant.now(), updatedAt = Instant.now())
            .also { raiseDomainEvent(AssignmentCompletedEvent(it)) }
    }

    fun cancel(reason: String): DriverAssignment {
        require(status in listOf(AssignmentStatus.SCHEDULED, AssignmentStatus.ACTIVE)) {
            "Cannot cancel $status assignment"
        }
        return copy(
            status = AssignmentStatus.CANCELLED,
            cancelledAt = Instant.now(),
            cancelReason = reason,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(AssignmentCancelledEvent(it, reason)) }
    }

    // INV-01: A driver can only have one ACTIVE assignment at a time (checked at application layer)
    // INV-02: A vehicle can only have one ACTIVE assignment at a time (checked at application layer)
}
```

### 3.3 Supporting Value Objects

```kotlin
data class License(
    val number: String,
    val state: String,             // issuing state/jurisdiction
    val country: String,
    val licenseClass: String,      // A, B, C, CDL-A, CDL-B, etc.
    val endorsements: List<String>, // HazMat, Tanker, Double/Triple, Passenger
    val restrictions: List<String>,
    val issuedDate: LocalDate,
    val expiryDate: LocalDate,
    val licenseImageId: UUID?       // reference to stored document
) {
    fun isExpired(): Boolean = LocalDate.now().isAfter(expiryDate)
    fun isExpiringSoon(daysThreshold: Int = 30): Boolean =
        LocalDate.now().plusDays(daysThreshold.toLong()).isAfter(expiryDate)

    // INV-01: expiryDate must be after issuedDate
    // INV-02: number must be non-blank
}

data class Certification(
    val id: UUID,
    val type: CertificationType,
    val certificateNumber: String,
    val issuedDate: LocalDate,
    val expiryDate: LocalDate?,
    val issuingAuthority: String
) {
    fun isExpired(): Boolean = expiryDate?.let { LocalDate.now().isAfter(it) } ?: false
}

enum class CertificationType {
    CDL_A, CDL_B, CDL_C, HAZMAT, TANKER, PASSENGER,
    SCHOOL_BUS, MOTORCYCLE, FORKLIFT, FIRST_AID, DEFENSIVE_DRIVING
}

data class BehaviorScore(
    val score: Double,                     // 0-100
    val speedScore: Double,               // 0-100
    val brakingScore: Double,             // 0-100
    val corneringScore: Double,           // 0-100
    val idlingScore: Double,              // 0-100
    val calculatedAt: Instant,
    val eventWindowStart: Instant,        // events in this window contribute to score
    val eventWindowEnd: Instant
)

data class DrivingEvent(
    val id: UUID,
    val driverId: UUID,
    val vehicleId: UUID,
    val tenantId: UUID,
    val type: DrivingEventType,
    val severity: EventSeverity,
    val timestamp: Instant,
    val position: Position,
    val speedAtEvent: Double?,
    val metadata: Map<String, String>
)

enum class DrivingEventType {
    HARSH_BRAKE, RAPID_ACCELERATION, SHARP_TURN, SPEED_VIOLATION,
    EXCESSIVE_IDLE, ROLLBACK, TAILGATING, LANE_DEPARTURE
}

enum class EventSeverity { LOW, MEDIUM, HIGH, CRITICAL }

data class Address(
    val street: String,
    val city: String,
    val state: String,
    val postalCode: String,
    val country: String
)

data class EmergencyContact(
    val name: String,
    val relationship: String,
    val phone: String
)
```

### 3.4 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `driver.profile.created.v1` | New driver registered | driverId, tenantId, firstName, lastName, email |
| `driver.profile.activated.v1` | Driver activated | driverId, tenantId |
| `driver.profile.suspended.v1` | Driver suspended | driverId, tenantId, reason |
| `driver.profile.terminated.v1` | Driver terminated | driverId, tenantId, reason |
| `driver.license.added.v1` | License info added | driverId, tenantId, licenseNumber, licenseClass |
| `driver.license.updated.v1` | License info updated | driverId, tenantId, oldNumber, newNumber |
| `driver.license.expired.v1` | License expired | driverId, tenantId, licenseNumber, expiryDate |
| `driver.license.expiring_soon.v1` | License expiring within threshold | driverId, tenantId, licenseNumber, expiryDate, daysRemaining |
| `driver.certification.added.v1` | Certification added | driverId, tenantId, type, certificateNumber |
| `driver.certification.expired.v1` | Certification expired | driverId, tenantId, type |
| `driver.behavior.score.changed.v1` | Behavior score updated | driverId, tenantId, oldScore, newScore, breakdown |
| `driver.assignment.created.v1` | Driver assigned to vehicle/trip | assignmentId, driverId, vehicleId, tenantId |
| `driver.assignment.started.v1` | Assignment started | assignmentId, driverId, vehicleId, tenantId |
| `driver.assignment.completed.v1` | Assignment completed | assignmentId, driverId, vehicleId, tenantId |
| `driver.assignment.cancelled.v1` | Assignment cancelled | assignmentId, driverId, vehicleId, tenantId, reason |
| `driver.driving.event.recorded.v1` | Driving event recorded | driverId, vehicleId, tenantId, eventType, severity |

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.driver.domain.port.out

import com.fleetvision.driver.domain.model.*
import java.time.Instant
import java.util.UUID

interface DriverProfileRepository {
    fun save(driver: DriverProfile): DriverProfile
    fun findById(driverId: UUID, tenantId: UUID): DriverProfile?
    fun findByEmail(email: String, tenantId: UUID): DriverProfile?
    fun findByUserId(userId: UUID, tenantId: UUID): DriverProfile?
    fun findByEmployeeId(employeeId: String, tenantId: UUID): DriverProfile?
    fun existsByEmail(email: String, tenantId: UUID): Boolean
    fun findActiveDrivers(tenantId: UUID, page: Int, size: Int): List<DriverProfile>
    fun findDriversExpiringLicense(daysThreshold: Int, tenantId: UUID): List<DriverProfile>
    fun findByFleetId(fleetId: UUID, tenantId: UUID, page: Int, size: Int): List<DriverProfile>
    fun findDriversByCertification(certType: CertificationType, tenantId: UUID): List<DriverProfile>
    fun findByStatus(status: DriverStatus, tenantId: UUID, page: Int, size: Int): List<DriverProfile>
    fun search(query: String, tenantId: UUID, page: Int, size: Int): List<DriverProfile>
    fun countByStatus(tenantId: UUID): Map<DriverStatus, Long>
    fun delete(driverId: UUID, tenantId: UUID)
}

interface DriverAssignmentRepository {
    fun save(assignment: DriverAssignment): DriverAssignment
    fun findById(assignmentId: UUID, tenantId: UUID): DriverAssignment?
    fun findActiveByDriverId(driverId: UUID, tenantId: UUID): DriverAssignment?
    fun findActiveByVehicleId(vehicleId: UUID, tenantId: UUID): DriverAssignment?
    fun findByDriverId(driverId: UUID, tenantId: UUID, page: Int, size: Int): List<DriverAssignment>
    fun findActiveAssignments(tenantId: UUID): List<DriverAssignment>
    fun delete(assignmentId: UUID, tenantId: UUID)
}

interface DrivingEventRepository {
    fun save(event: DrivingEvent): DrivingEvent
    fun saveBatch(events: List<DrivingEvent>)
    fun findByDriverId(driverId: UUID, from: Instant, to: Instant, page: Int, size: Int): List<DrivingEvent>
    fun findByVehicleId(vehicleId: UUID, from: Instant, to: Instant, limit: Int): List<DrivingEvent>
    fun findByDriverAndType(driverId: UUID, type: DrivingEventType, from: Instant, to: Instant): List<DrivingEvent>
}

interface BehaviorProfileRepository {
    /** MongoDB-based behavior score history */
    fun saveHistory(driverId: UUID, score: BehaviorScore)
    fun getScoreHistory(driverId: UUID, from: Instant, to: Instant): List<BehaviorScore>
    fun getLatestScore(driverId: UUID): BehaviorScore?
}

interface EventPublisher {
    fun publish(event: DomainEvent)
}

interface IAMClient {
    fun getUserIdForDriver(driverId: UUID, tenantId: UUID): UUID?
}

interface FleetManagementClient {
    fun validateVehicleAvailability(vehicleId: UUID, tenantId: UUID): Boolean
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/drivers`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/drivers` | List drivers (paginated, filterable) | `driver.profile.read` |
| `GET` | `/drivers/{driverId}` | Get driver profile detail | `driver.profile.read` |
| `POST` | `/drivers` | Create a new driver | `driver.profile.create` |
| `PUT` | `/drivers/{driverId}` | Update driver profile | `driver.profile.update` |
| `PATCH` | `/drivers/{driverId}/status` | Activate/suspend/terminate driver | `driver.profile.manage` |
| `GET` | `/drivers/{driverId}/license` | Get license details | `driver.license.read` |
| `PUT` | `/drivers/{driverId}/license` | Update license info | `driver.license.update` |
| `GET` | `/drivers/{driverId}/certifications` | List certifications | `driver.cert.read` |
| `POST` | `/drivers/{driverId}/certifications` | Add certification | `driver.cert.create` |
| `DELETE` | `/drivers/{driverId}/certifications/{certId}` | Remove certification | `driver.cert.manage` |
| `GET` | `/drivers/{driverId}/behavior-score` | Get current behavior score | `driver.behavior.read` |
| `GET` | `/drivers/{driverId}/behavior-score/history` | Get score history | `driver.behavior.read` |
| `GET` | `/drivers/{driverId}/driving-events` | Get driving events (time range) | `driver.event.read` |
| `GET` | `/drivers/{driverId}/dashboard` | Driver dashboard summary | `driver.dashboard.read` |
| `GET` | `/drivers/expiring-licenses` | List drivers with expiring licenses | `driver.license.read` |
| `POST` | `/drivers/{driverId}/assignments` | Assign driver to vehicle/trip | `driver.assignment.create` |
| `GET` | `/drivers/{driverId}/assignments` | List driver assignments | `driver.assignment.read` |
| `GET` | `/drivers/{driverId}/assignments/active` | Get active assignment | `driver.assignment.read` |
| `POST` | `/assignments/{assignmentId}/start` | Start assignment | `driver.assignment.execute` |
| `POST` | `/assignments/{assignmentId}/complete` | Complete assignment | `driver.assignment.execute` |
| `POST` | `/assignments/{assignmentId}/cancel` | Cancel assignment | `driver.assignment.execute` |
| `GET` | `/drivers/search` | Full-text driver search | `driver.profile.read` |

### 5.2 gRPC Service

```protobuf
service DriverManagementService {
  rpc GetDriver (GetDriverRequest) returns (DriverResponse);
  rpc LookupDriverByUser (LookupDriverByUserRequest) returns (DriverResponse);
  rpc CheckDriverEligibility (CheckDriverEligibilityRequest) returns (CheckDriverEligibilityResponse);
  rpc GetDriverBehaviorScore (GetDriverBehaviorScoreRequest) returns (BehaviorScoreResponse);
  rpc BatchGetDrivers (BatchGetDriversRequest) returns (BatchGetDriversResponse);
}

message GetDriverRequest {
  string driver_id = 1;
  string tenant_id = 2;
}

message DriverResponse {
  string id = 1;
  string tenant_id = 2;
  string first_name = 3;
  string last_name = 4;
  string email = 5;
  string status = 6;
  optional string license_number = 7;
  optional string license_class = 8;
  optional string license_expiry = 9;
  double behavior_score = 10;
  repeated string certifications = 11;
  int64 total_trips_completed = 12;
  double total_distance_km = 13;
}

message LookupDriverByUserRequest {
  string user_id = 1;
  string tenant_id = 2;
}

message CheckDriverEligibilityRequest {
  string driver_id = 1;
  string tenant_id = 2;
  repeated string required_certifications = 3;
  optional string vehicle_type = 4;
}

message CheckDriverEligibilityResponse {
  bool eligible = 1;
  repeated string missing_certifications = 2;
  bool license_valid = 3;
  bool license_expiring = 4;
  double behavior_score = 5;
  string reason = 6;
}

message GetDriverBehaviorScoreRequest {
  string driver_id = 1;
  string tenant_id = 2;
}

message BehaviorScoreResponse {
  string driver_id = 1;
  double overall_score = 2;
  double speed_score = 3;
  double braking_score = 4;
  double cornering_score = 5;
  double idling_score = 6;
  int64 calculated_at = 7;
}

message BatchGetDriversRequest {
  repeated string driver_ids = 1;
  string tenant_id = 2;
}

message BatchGetDriversResponse {
  repeated DriverResponse drivers = 1;
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.driver.profile.events` | `driverId` | 7 days | driver-management-service |
| `fleetvision.driver.license.events` | `driverId` | 7 days | driver-management-service |
| `fleetvision.driver.assignment.events` | `assignmentId` | 7 days | driver-management-service |
| `fleetvision.driver.behavior.events` | `driverId` | 7 days | driver-management-service |
| `fleetvision.driver.driving.events` | `driverId` | 3 days | driver-management-service |

### 6.2 Published Events (Producer)

```json
// driver.profile.created.v1
{
  "specversion": "1.0",
  "type": "driver.profile.created.v1",
  "source": "/driver-management-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "data": {
    "driver_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "first_name": "John",
    "last_name": "Smith",
    "email": "jsmith@acme.com",
    "employee_id": "EMP-0042"
  },
  "fleetvision": { ... }
}

// driver.license.expired.v1
{
  "specversion": "1.0",
  "type": "driver.license.expired.v1",
  "source": "/driver-management-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "data": {
    "driver_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "license_number": "D123-4567-8901",
    "expiry_date": "2026-07-15",
    "license_class": "CDL-A"
  },
  "fleetvision": { ... }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.tracking.alert.events` | `tracking.speed.exceeded.v1` | Record driving event, update behavior score |
| `fleetvision.tracking.alert.events` | `tracking.harsh_brake.v1` | Record driving event, update behavior score |
| `fleetvision.trip.events` | `trip.started.v1` | Create/validate driver assignment |
| `fleetvision.trip.events` | `trip.completed.v1` | Complete driver assignment, update trip stats |
| `fleetvision.compliance.hos.events` | `compliance.hos.violation.detected.v1` | Record fatigue event, update driver alert status |
| `fleetvision.iam.user.events` | `iam.user.deactivated.v1` | Suspend linked driver profile |
| `fleetvision.billing.tenant.events` | `billing.tenant.suspended.v1` | Freeze driver management operations |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| Identity & Access Mgmt | gRPC (outbound) | User account linkage, permission checks |
| Fleet Management | gRPC (outbound) | Vehicle availability for assignment |
| Trip & Route Mgmt | Kafka (bidirectional) | Trip dispatch, assignment lifecycle |
| Tracking & Monitoring | Kafka (inbound) | Driving behavior events (speed, brake, corner) |
| Compliance & Safety | Kafka (inbound) | HOS violations, fatigue events |
| Notification Service | Kafka (outbound) | License expiry alerts, behavior score alerts |
| Analytics Engine | Kafka (outbound) | All driver events for dashboards and ML |
| Audit Log Service | Kafka (outbound) | All driver profile change audit trails |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **HR Systems (Workday, ADP)** | REST API | Inbound (adapter) | Employee data sync |
| **Government DMV** | REST/SOAP | Outbound | License verification APIs |
| **Insurance Platforms** | REST API | Outbound | Driver risk profile sharing |

---

## 8. Configuration Properties

```yaml
# application-driver.yaml
fleetvision:
  driver:
    service-name: driver-management-service

    profile:
      max-drivers-per-tenant: 50000
      license-image-max-size-mb: 10

    license:
      expiry-warning-days: 30
      expiry-warning-reminder-days: [30, 14, 7, 3, 1]
      auto-suspend-on-expiry: true
      verification:
        enabled: true
        provider: DMV_GATEWAY
        timeout: 10s

    behavior:
      score-calculation-window-hours: 168         // 7 days rolling window
      score-update-interval-minutes: 60
      weights:
        speed: 0.25
        braking: 0.25
        cornering: 0.20
        idling: 0.15
        other: 0.15
      severity-multipliers:
        LOW: 1.0
        MEDIUM: 2.0
        HIGH: 3.0
        CRITICAL: 5.0
      auto-suspend-threshold: 25                 // suspend if score drops below this
      warning-threshold: 50

    assignment:
      max-active-assignments-per-driver: 1
      max-active-assignments-per-vehicle: 1

    certification:
      expiry-warning-days: 30
      required-for-cdl-a: ["CDL_A"]
      required-for-hazmat: ["CDL_A", "HAZMAT"]

  database:
    jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_driver
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    pool:
      maximum-pool-size: 20
      minimum-idle: 5
    migration:
      locations: classpath:db/migration/driver

  mongodb:
    uri: mongodb://${MONGO_HOST}:27017/fleetvision_driver
    database: fleetvision_driver
    collections:
      behavior-history: driver_behavior_history
      inspection-forms: driver_inspection_forms

  redis:
    host: ${REDIS_HOST}
    port: 6379
    password: ${REDIS_PASSWORD}
    database-index: 4
    ttl:
      driver-profile: 300
      behavior-score: 600

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: driver-mgmt-producer
      acks: all
      retries: 3
      compression-type: lz4
    consumer:
      group-id: driver-mgmt-consumer
      auto-offset-reset: earliest
      enable-auto-commit: false
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| IAM gRPC | 10 failures in 30s | 10s | 5 | Deny operation |
| Fleet Mgmt gRPC | 10 failures in 30s | 10s | 5 | Use cached vehicle availability |
| DMV License Verification | 3 failures in 60s | 120s | 2 | Allow registration, flag for manual verification |
| MongoDB (behavior) | 3 failures in 30s | 30s | 3 | Fall back to PostgreSQL for latest score |
| Redis (cache) | 3 failures in 10s | 10s | 5 | Skip cache |
| Compliance gRPC | 5 failures in 30s | 15s | 3 | Proceed without HOS check |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| IAM gRPC calls | 2 | Fixed 200ms | +/- 50ms |
| Fleet Mgmt gRPC calls | 2 | Fixed 200ms | +/- 50ms |
| DMV license verification | 3 | Exponential (1s, 2s, 4s) | +/- 20% |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |
| Database write | 3 | Exponential (50ms, 100ms, 200ms) | +/- 25% |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| gRPC requests | 3s | 5s | 8s |
| DMV license verification | 5s | 10s | 15s |
| MongoDB operations | 2s | 5s | 7s |
| Kafka produce | 5s | — | 30s |

### 9.4 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Driver creation | 50/min per tenant | 100 | Token bucket |
| Driving events ingestion | 1000/min per tenant | 2000 | Sliding window |
| Behavior score queries | 200/min per user | 400 | Sliding window |
| Driver search | 100/min per user | 200 | Sliding window |
| Assignment creation | 100/min per tenant | 200 | Token bucket |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | Driver profile, behavior scoring, eligibility checks | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | PostgreSQL, MongoDB, Kafka, Redis | Testcontainers (PG, Mongo, Kafka, Redis) | 80% |
| **Contract Tests** | REST/gRPC API contracts | Spring Cloud Contract | 100% |
| **Component Tests** | Full driver lifecycle | SpringBootTest | Critical paths |
| **End-to-End Tests** | Speed event -> behavior score update -> alert | Testcontainers Compose | Critical paths |

### 10.2 Domain Test Scenarios

**DriverProfile:**
- Create driver with valid data succeeds
- Create driver with duplicate email fails
- Activate driver with valid license succeeds
- Activate driver with expired license fails
- Suspend active driver succeeds
- Suspend inactive driver fails
- Terminate driver clears active assignments
- Update license with expired license on ACTIVE driver triggers event
- Add duplicate certification fails
- Record trip completed updates stats correctly

**DriverAssignment:**
- Create assignment for active driver to available vehicle succeeds
- Start SCHEDULED assignment succeeds
- Complete ACTIVE assignment succeeds
- Cancel COMPLETED assignment fails
- Cannot create assignment for suspended driver

**BehaviorScoringService:**
- Single LOW severity event barely changes score
- Multiple CRITICAL events drop score significantly
- Score calculation with empty event window returns default (100)

### 10.3 Integration Test Scenarios
- Driver creation persists to PostgreSQL and publishes Kafka event
- License expiry detection triggers notification via Kafka
- Speed event from Tracking consumed, driving event recorded, score updated
- MongoDB behavior history stored correctly

### 10.4 Contract Test Scenarios
- `CheckDriverEligibility` gRPC returns correct eligibility with missing certs
- `POST /drivers` returns 201 with DRAFT status
- `POST /drivers/{id}/assignments` validates active assignment constraint

### 10.5 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| Driver list query (10K drivers) | < 100ms p99 | k6 |
| Behavior score calculation (1000 events) | < 500ms | JUnit benchmark |
| Driving events ingestion | 5,000 events/sec | k6 / Gatling |
| Eligibility check (gRPC) | < 10ms p99 | grpc-benchmark |

---

## Appendix A: Package Structure

```
com.fleetvision.driver/
├── domain/
│   ├── model/
│   │   ├── DriverProfile.kt
│   │   ├── DriverAssignment.kt
│   │   ├── DrivingEvent.kt
│   │   └── valueobjects/
│   │       ├── DriverId.kt
│   │       ├── License.kt
│   │       ├── Certification.kt
│   │       ├── BehaviorScore.kt
│   │       ├── Address.kt
│   │       └── EmergencyContact.kt
│   ├── event/
│   │   ├── DriverCreatedEvent.kt
│   │   ├── LicenseExpiredEvent.kt
│   │   ├── BehaviorScoreChangedEvent.kt
│   │   ├── AssignmentStartedEvent.kt
│   │   └── ...
│   ├── service/
│   │   ├── BehaviorScoringService.kt
│   │   └── DriverEligibilityService.kt
│   └── port/
│       └── out/
│           ├── DriverProfileRepository.kt
│           ├── DriverAssignmentRepository.kt
│           ├── DrivingEventRepository.kt
│           ├── BehaviorProfileRepository.kt
│           ├── EventPublisher.kt
│           ├── IAMClient.kt
│           └── FleetManagementClient.kt
├── application/
│   ├── usecase/
│   │   ├── CreateDriverUseCase.kt
│   │   ├── UpdateLicenseUseCase.kt
│   │   ├── AssignDriverUseCase.kt
│   │   ├── UpdateBehaviorScoreUseCase.kt
│   │   ├── CheckDriverEligibilityUseCase.kt
│   │   ├── RecordDrivingEventUseCase.kt
│   │   └── GetDriverDashboardUseCase.kt
│   └── dto/
│       ├── DriverRequest.kt
│       ├── DriverResponse.kt
│       ├── AssignmentRequest.kt
│       ├── LicenseRequest.kt
│       └── BehaviorScoreDto.kt
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── DriverController.kt
│   │   │   ├── LicenseController.kt
│   │   │   ├── AssignmentController.kt
│   │   │   └── BehaviorController.kt
│   │   ├── grpc/
│   │   │   └── DriverManagementGrpcService.kt
│   │   └── event/
│   │       ├── TrackingEventConsumer.kt
│   │       └── ComplianceEventConsumer.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── jpa/
│       │   │   ├── DriverProfileJpaRepository.kt
│       │   │   └── DriverAssignmentJpaRepository.kt
│       │   └── mongo/
│       │       └── BehaviorProfileMongoRepository.kt
│       ├── iam/
│       │   └── IAMGrpcClient.kt
│       ├── fleet/
│       │   └── FleetManagementGrpcClient.kt
│       └── kafka/
│           └── DriverEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── PersistenceConfig.kt
│   │   ├── MongoConfig.kt
│   │   ├── KafkaConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── DriverAlreadyExistsException.kt
│       ├── LicenseExpiredException.kt
│       ├── DriverNotEligibleException.kt
│       └── DuplicateAssignmentException.kt
└── DriverManagementServiceApplication.kt
```
