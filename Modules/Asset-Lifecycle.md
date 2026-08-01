# Asset Lifecycle Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Service:** `asset-lifecycle-service`
**Bounded Context:** Asset Lifecycle

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

The Asset Lifecycle context manages the complete lifecycle of fleet vehicles from acquisition through operation to disposal. It tracks depreciation, total cost of ownership (TCO), warranty management, and asset retirement planning. The context provides financial visibility into fleet assets and supports strategic procurement decisions.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                   ASSET LIFECYCLE CONTEXT                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ FleetAsset   │  │ Depreciation │  │ AssetDisposal │          │
│  │ (Aggregate)  │  │Schedule      │  │ (Aggregate)   │          │
│  └──────────────┘  │ (Aggregate)  │  └──────────────┘          │
│                    └──────────────┘                               │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Warranty     │  │ TCORecord    │  Domain Services:            │
│  │ Claim        │  │ (Read Model) │  - DepreciationCalculator   │
│  │ (Aggregate)  │  └──────────────┘  - TCOAnalyzer               │
│  └──────────────┘                    - DisposalValueEstimator    │
│                                        - ProcurementRecommender   │
└────────┬──────────┬──────────────────┬───────────────┬───────────┘
         │          │                  │               │
    ┌────┴───┐  ┌───┴─────┐     ┌──────┴──────┐  ┌────┴─────┐
    │ Fleet  │  │Vehicle  │     │  Billing    │  │ Analy-   │
    │ Mgmt   │  │Maint    │     │  & Tenant   │  │ tics     │
    │        │  │         │     │             │  │          │
    └────────┘  └─────────┘     └─────────────┘  └──────────┘
```

**Upstream (produces events consumed by):**
- `billing-service` — Asset depreciation data for financial reporting
- `analytics-engine` — TCO metrics for fleet analytics dashboards
- `notification-service` — Warranty expiration alerts, disposal reminders
- `audit-log-service` — Asset lifecycle audit events

**Downstream (consumes events from):**
- `fleet-management-service` — Vehicle created/deactivated events
- `vehicle-maintenance-service` — Maintenance records for TCO calculation
- `fuel-management-service` — Fuel costs for TCO calculation
- `tracking-service` — Mileage accumulation for depreciation

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **FleetAsset** | A vehicle or equipment asset tracked throughout its lifecycle from acquisition to disposal |
| **DepreciationSchedule** | The planned depreciation of an asset over its useful life using a defined method |
| **TCO** | Total Cost of Ownership — the complete cost of an asset including acquisition, operation, maintenance, fuel, insurance, and disposal |
| **WarrantyClaim** | A claim filed against a manufacturer or extended warranty for a covered repair |
| **AssetDisposal** | The process of retiring an asset: sale, trade-in, scrap, or donation |
| **BookValue** | The current accounting value of an asset after accumulated depreciation |
| **SalvageValue** | The estimated residual value of an asset at the end of its useful life |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                   asset-lifecycle-service                        │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST Controllers│  │  gRPC Service Implementations│   │  │
│  │  │  (Spring MVC)    │  │  (AssetLifecycleGrpcImpl)    │   │  │
│  │  └────────┬────────┘  └──────────────┬───────────────┘   │  │
│  │           │                          │                    │  │
│  │  ┌────────┴────────┐  ┌─────────────┴──────────────┐    │  │
│  │  │  DTO Mappers   │  │  Event Publishers (Kafka)  │    │  │
│  │  │  (MapStruct)   │  │  (DomainEventPublisher)   │    │  │
│  │  └─────────────────┘  └──────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │  External Adapters (Anti-Corruption Layers)       │    │  │
│  │  │  • ERPIntegrationAdapter (SAP, Oracle)           │    │  │
│  │  │  • InsurancePlatformAdapter                       │    │  │
│  │  │  • KellyBlueBookAdapter (valuation)                │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Command Handlers                                  │    │  │
│  │  │  • RegisterAssetCommandHandler                     │    │  │
│  │  │  • UpdateAssetDetailsCommandHandler                 │    │  │
│  │  │  • CreateDepreciationScheduleCommandHandler         │    │  │
│  │  │  • FileWarrantyClaimCommandHandler                  │    │  │
│  │  │  • ProcessWarrantyClaimCommandHandler               │    │  │
│  │  │  • InitiateDisposalCommandHandler                   │    │  │
│  │  │  • CompleteDisposalCommandHandler                  │    │  │
│  │  │  • RecalculateTCOCommandHandler                    │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Query Handlers (CQRS)                              │    │  │
│  │  │  • GetAssetDetailQueryHandler                        │    │  │
│  │  │  • GetAssetPortfolioQueryHandler                     │    │  │
│  │  │  • GetTCOReportQueryHandler                         │    │  │
│  │  │  • GetDepreciationScheduleQueryHandler               │    │  │
│  │  │  • GetWarrantyStatusQueryHandler                    │    │  │
│  │  │  • GetDisposalValuationQueryHandler                 │    │  │
│  │  │  • GetProcurementRecommendationQueryHandler         │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Services                                    │    │  │
│  │  │  • DepreciationCalculator                          │    │  │
│  │  │  • TCOAnalyzer                                     │    │  │
│  │  │  • DisposalValueEstimator                          │    │  │
│  │  │  • ProcurementRecommender                          │    │  │
│  │  │  • WarrantyCoverageValidator                      │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Aggregate Roots                                    │    │  │
│  │  │  • FleetAsset                                       │    │  │
│  │  │  • DepreciationSchedule                             │    │  │
│  │  │  • WarrantyClaim                                   │    │  │
│  │  │  • AssetDisposal                                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • Money, AssetType, AssetStatus                    │    │  │
│  │  │  • DepreciationMethod, LifecyclePhase               │    │  │
│  │  │  • DisposalType, DisposalStatus                    │    │  │
│  │  │  • WarrantyType, ClaimStatus                       │    │  │
│  │  │  • VehicleSpecification                            │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Persistence (PostgreSQL + MongoDB)              │    │  │
│  │  │  • FleetAssetJpaRepository                        │    │  │
│  │  │  • DepreciationScheduleJpaRepository             │    │  │
│  │  │  • WarrantyClaimJpaRepository                     │    │  │
│  │  │  • AssetDisposalJpaRepository                    │    │  │
│  │  │  • TCOReadModelRepository                         │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Kafka Consumers                                   │    │  │
│  │  │  • VehicleLifecycleConsumer                        │    │  │
│  │  │  • MaintenanceCostConsumer                         │    │  │
│  │  │  • FuelCostConsumer                                │    │  │
│  │  │  • MileageAccumulationConsumer                     │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
com.fleetvision.asset/
├── api/
│   ├── rest/
│   │   ├── FleetAssetController.kt
│   │   ├── DepreciationController.kt
│   │   ├── WarrantyController.kt
│   │   ├── DisposalController.kt
│   │   └── TCOController.kt
│   └── grpc/
│       ├── AssetLifecycleGrpcImpl.kt
│       └── proto/
├── application/
│   ├── command/ + commandhandler/
│   ├── query/ + queryhandler/
│   ├── service/
│   └── port/
├── domain/
│   ├── model/
│   │   ├── aggregate/ (FleetAsset, DepreciationSchedule, WarrantyClaim, AssetDisposal)
│   │   ├── valueobject/
│   │   └── event/
│   └── service/
├── infrastructure/
│   ├── config/
│   ├── persistence/
│   ├── messaging/
│   └── adapter/
└── AssetLifecycleServiceApplication.kt
```

---

## 3. Aggregate Root Designs

### 3.1 FleetAsset (Aggregate Root)

**Purpose:** The central entity representing a vehicle or equipment asset tracked throughout its entire lifecycle.

#### Fields

| Field | Type | Description |
|---|---|---|
| `assetId` | `AssetId` (UUID) | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `vehicleId` | `VehicleId?` (UUID) | Link to fleet-management vehicle (may differ during procurement phase) |
| `assetType` | `AssetType` | `TRUCK`, `TRAILER`, `VAN`, `CAR`, `SPECIALTY_EQUIPMENT` |
| `make` | `String` | Manufacturer |
| `model` | `String` | Model name |
| `year` | `Int` | Model year |
| `vin` | `String` | Vehicle Identification Number (unique) |
| `specification` | `VehicleSpecification` | Engine, transmission, axles, GVWR, etc. |
| `acquisitionDate` | `Instant` | Date asset was acquired |
| `acquisitionCost` | `Money` (BigDecimal) | Purchase price including fees |
| `acquisitionType` | `AcquisitionType` | `PURCHASE`, `LEASE`, `FINANCE`, `DONATION` |
| `lessorId` | `String?` | Leasing company reference (if leased) |
| `leaseEndDate` | `Instant?` | Lease maturity date |
| `usefulLifeYears` | `Int` | Expected useful life in years |
| `usefulLifeMiles` | `Long` | Expected useful life in miles |
| `salvageValue` | `Money` (BigDecimal) | Expected residual value at end of life |
| `currentMileage` | `Long` | Current odometer reading |
| `bookValue` | `Money` (BigDecimal) | Current accounting value (acquisition - accumulated depreciation) |
| `accumulatedDepreciation` | `Money` (BigDecimal) | Total depreciation to date |
| `lifecyclePhase` | `LifecyclePhase` | `PROCUREMENT`, `ACTIVE`, `END_OF_LIFE`, `DISPOSED` |
| `status` | `AssetStatus` | `PENDING_ACTIVATION`, `IN_SERVICE`, `IN_MAINTENANCE`, `OUT_OF_SERVICE`, `RETIRED`, `DISPOSED` |
| `location` | `String` | Current storage/yard location |
| `insurancePolicyId` | `String?` | Insurance policy reference |
| `estimatedDisposalDate` | `Instant?` | Projected disposal date |
| `replacementAssetId` | `UUID?` | Linked replacement asset |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `registerAsset()` | vin, assetType, make, model, year, acquisitionCost, acquisitionType | `AssetRegisteredEvent` | VIN must be unique per tenant; valid asset type |
| `activateAsset()` | vehicleId, insurancePolicyId | `AssetActivatedEvent` | Asset must be PENDING_ACTIVATION |
| `updateMileage()` | mileage, timestamp | `AssetMileageUpdatedEvent` | Mileage must be >= current mileage |
| `updateBookValue()` | bookValue, accumulatedDepreciation | `AssetBookValueUpdatedEvent` | bookValue = acquisitionCost - accumulatedDepreciation |
| `transitionToEndOfLife()` | reason | `AssetEndOfLifeEvent` | Asset must be ACTIVE or OUT_OF_SERVICE |
| `retireAsset()` | reason | `AssetRetiredEvent` | Asset must be END_OF_LIFE |
| `updateSpecification()` | specification changes | `AssetSpecificationUpdatedEvent` | Only during PENDING_ACTIVATION |

#### Invariants

1. **VIN Uniqueness:** VIN must be unique within a tenant. Cross-tenant VIN collisions are logged but not blocked.
2. **Book Value Non-Negative:** `bookValue` must always be >= 0. If depreciation would make book value negative, it is capped at 0.
3. **Lifecycle Phase Progression:** `PROCUREMENT -> ACTIVE -> END_OF_LIFE -> DISPOSED` (strict forward-only state machine).
4. **Mileage Monotonicity:** Mileage readings must never decrease for the same asset.
5. **Acquisition Immutability:** Once activated, `acquisitionCost`, `acquisitionDate`, and `acquisitionType` are immutable.

#### Domain Events

```kotlin
// Event naming: asset.lifecycle.<event>.v1
data class AssetRegisteredEvent(
    val assetId: UUID, val tenantId: UUID,
    val vehicleId: UUID?, val vin: String, val assetType: AssetType,
    val make: String, val model: String, val year: Int,
    val acquisitionCost: BigDecimal, val acquisitionType: AcquisitionType,
    val usefulLifeYears: Int, val usefulLifeMiles: Long,
    val salvageValue: BigDecimal, val timestamp: Instant
)

data class AssetActivatedEvent(
    val assetId: UUID, val tenantId: UUID,
    val vehicleId: UUID, val insurancePolicyId: String?,
    val timestamp: Instant
)

data class AssetMileageUpdatedEvent(
    val assetId: UUID, val tenantId: UUID,
    val previousMileage: Long, val currentMileage: Long,
    val timestamp: Instant
)

data class AssetBookValueUpdatedEvent(
    val assetId: UUID, val tenantId: UUID,
    val bookValue: BigDecimal, val accumulatedDepreciation: BigDecimal,
    val period: String, val timestamp: Instant
)

data class AssetEndOfLifeEvent(
    val assetId: UUID, val tenantId: UUID,
    val reason: String, val estimatedDisposalDate: Instant?,
    val timestamp: Instant
)

data class AssetRetiredEvent(
    val assetId: UUID, val tenantId: UUID,
    val reason: String, val timestamp: Instant
)
```

---

### 3.2 DepreciationSchedule (Aggregate Root)

**Purpose:** Manages the planned and actual depreciation of an asset using configurable methods.

#### Fields

| Field | Type | Description |
|---|---|---|
| `scheduleId` | `UUID` | Unique identifier |
| `assetId` | `AssetId` (UUID) | Associated asset |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `method` | `DepreciationMethod` | `STRAIGHT_LINE`, `DECLINING_BALANCE`, `UNITS_OF_PRODUCTION`, `SUM_OF_YEARS_DIGITS` |
| `acquisitionCost` | `Money` | Original cost |
| `salvageValue` | `Money` | Expected salvage value |
| `usefulLifeYears` | `Int` | Depreciable life in years |
| `usefulLifeMiles` | `Long` | Depreciable life in miles (for units-of-production) |
| `annualDepreciationAmount` | `Money` | Calculated annual depreciation |
| `currentPeriodStart` | `Instant` | Start of current depreciation period |
| `accumulatedDepreciation` | `Money` | Total depreciation to date |
| `entries` | `List<DepreciationEntry>` | Historical depreciation entries |
| `status` | `ScheduleStatus` | `ACTIVE`, `COMPLETED`, `ADJUSTED` |

#### Depreciation Methods

```kotlin
enum class DepreciationMethod {
    STRAIGHT_LINE,              // (Cost - Salvage) / Useful Life
    DECLINING_BALANCE,          // Double declining balance: 2 * (1/Life) * Book Value
    UNITS_OF_PRODUCTION,        // (Cost - Salvage) * (Miles This Period / Total Miles)
    SUM_OF_YEARS_DIGITS         // Remaining Life / SYD * (Cost - Salvage)
}
```

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `createSchedule()` | assetId, method, cost, salvage, usefulLife | `DepreciationScheduleCreatedEvent` | Asset must exist; method must be valid |
| `recordDepreciation()` | period, amount, mileageThisPeriod | `DepreciationRecordedEvent` | Amount must not exceed remaining depreciable value |
| `adjustSchedule()` | newMethod, newUsefulLife, reason | `DepreciationScheduleAdjustedEvent` | Only with FINANCE_ADMIN role approval |
| `completeSchedule()` | — | `DepreciationScheduleCompletedEvent` | Accumulated depreciation = depreciable base |

#### Domain Events

```kotlin
// Event naming: asset.depreciation.<event>.v1
data class DepreciationScheduleCreatedEvent(
    val scheduleId: UUID, val tenantId: UUID, val assetId: UUID,
    val method: DepreciationMethod, val acquisitionCost: BigDecimal,
    val salvageValue: BigDecimal, val usefulLifeYears: Int,
    val usefulLifeMiles: Long, val annualDepreciationAmount: BigDecimal,
    val timestamp: Instant
)

data class DepreciationRecordedEvent(
    val scheduleId: UUID, val tenantId: UUID, val assetId: UUID,
    val period: String, val amount: BigDecimal, val mileageThisPeriod: Long,
    val accumulatedDepreciation: BigDecimal, val currentBookValue: BigDecimal,
    val timestamp: Instant
)
```

---

### 3.3 WarrantyClaim (Aggregate Root)

**Purpose:** Tracks warranty claims filed against manufacturers or extended warranty providers for covered repairs.

#### Fields

| Field | Type | Description |
|---|---|---|
| `claimId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `assetId` | `AssetId` (UUID) | Asset under warranty |
| `vehicleId` | `VehicleId` (UUID) | Associated vehicle |
| `warrantyProvider` | `String` | Manufacturer or warranty company |
| `warrantyType` | `WarrantyType` | `FACTORY`, `EXTENDED`, `POWERTRAIN`, `EMISSIONS` |
| `warrantyNumber` | `String` | Warranty contract/policy number |
| `component` | `String` | Failed component |
| `failureDescription` | `String` | Detailed failure narrative |
| `failureDate` | `Instant` | When the failure occurred |
| `repairCost` | `Money` | Total repair cost |
| `claimAmount` | `Money` | Amount claimed from warranty provider |
| `approvedAmount` | `Money?` | Amount approved by provider |
| `status` | `ClaimStatus` | `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `DENIED`, `PAID`, `CLOSED` |
| `documents` | `List<String>` | Supporting document URLs |
| `submittedBy` | `UUID` | User who submitted |
| `resolvedAt` | `Instant?` | Resolution timestamp |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `fileClaim()` | assetId, warrantyNumber, component, description, repairCost | `WarrantyClaimFiledEvent` | Asset must have active warranty coverage |
| `submitToProvider()` | documents | `WarrantyClaimSubmittedEvent` | Claim must be in SUBMITTED status |
| `recordProviderResponse()` | approvedAmount, notes | `WarrantyClaimUpdatedEvent` | Claim must be UNDER_REVIEW |
| `recordPayment()` | paymentAmount, paymentDate | `WarrantyClaimPaidEvent` | Claim must be APPROVED |
| `denyClaim()` | denialReason | `WarrantyClaimDeniedEvent` | Claim must be UNDER_REVIEW |
| `closeClaim()` | — | `WarrantyClaimClosedEvent` | Must be PAID or DENIED |

#### Invariants

1. **Coverage Validation:** A claim can only be filed if the asset has active warranty coverage for the specified component and date.
2. **Claim Amount Limit:** `claimAmount` cannot exceed `repairCost`.
3. **Non-Negative Payment:** `approvedAmount` must be >= 0.
4. **Single Resolution:** A claim can only be APPROVED or DENIED, not both.

#### Domain Events

```kotlin
// Event naming: asset.warranty.<event>.v1
data class WarrantyClaimFiledEvent(
    val claimId: UUID, val tenantId: UUID, val assetId: UUID,
    val vehicleId: UUID, val warrantyProvider: String,
    val warrantyType: WarrantyType, val component: String,
    val failureDescription: String, val repairCost: BigDecimal,
    val claimAmount: BigDecimal, val timestamp: Instant
)

data class WarrantyClaimPaidEvent(
    val claimId: UUID, val tenantId: UUID, val assetId: UUID,
    val paymentAmount: BigDecimal, val paymentDate: Instant,
    val timestamp: Instant
)

data class WarrantyClaimDeniedEvent(
    val claimId: UUID, val tenantId: UUID, val assetId: UUID,
    val denialReason: String, val timestamp: Instant
)
```

---

### 3.4 AssetDisposal (Aggregate Root)

**Purpose:** Manages the disposal process for retired assets: sale, trade-in, scrap, or donation.

#### Fields

| Field | Type | Description |
|---|---|---|
| `disposalId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `assetId` | `AssetId` (UUID) | Asset being disposed |
| `disposalType` | `DisposalType` | `SALE`, `TRADE_IN`, `SCRAP`, `DONATION`, `AUCTION` |
| `disposalReason` | `String` | Reason for disposal |
| `estimatedMarketValue` | `Money` | Estimated fair market value |
| `actualSalePrice` | `Money?` | Actual sale/trade-in proceeds |
| `buyerInfo` | `String?` | Buyer information (for sales) |
| `disposalDate` | `Instant?` | Date of disposal completion |
| `titleTransferNumber` | `String?` | Title transfer reference |
| `status` | `DisposalStatus` | `INITIATED`, `VALUATION_PENDING`, `READY_FOR_DISPOSAL`, `COMPLETED`, `CANCELLED` |
| `documentation` | `List<String>` | Disposal documentation URLs |

#### Domain Events

```kotlin
// Event naming: asset.disposal.<event>.v1
data class DisposalInitiatedEvent(
    val disposalId: UUID, val tenantId: UUID, val assetId: UUID,
    val disposalType: DisposalType, val disposalReason: String,
    val estimatedMarketValue: BigDecimal, val timestamp: Instant
)

data class DisposalCompletedEvent(
    val disposalId: UUID, val tenantId: UUID, val assetId: UUID,
    val disposalType: DisposalType, val actualSalePrice: BigDecimal,
    val disposalDate: Instant, val gainOrLoss: BigDecimal,
    val timestamp: Instant
)
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.asset.application.port.outbound

import com.fleetvision.asset.domain.model.aggregate.*
import com.fleetvision.asset.application.query.*
import java.time.Instant
import java.util.UUID

interface FleetAssetRepository {
    fun save(asset: FleetAsset): FleetAsset
    fun findById(assetId: UUID): FleetAsset?
    fun findByVin(vin: String, tenantId: UUID): FleetAsset?
    fun findByVehicleId(vehicleId: UUID): FleetAsset?
    fun findByTenant(tenantId: UUID, page: Int, size: Int, filters: AssetFilterDto): PageResult<FleetAsset>
    fun findByLifecyclePhase(tenantId: UUID, phase: LifecyclePhase): List<FleetAsset>
}

interface DepreciationScheduleRepository {
    fun save(schedule: DepreciationSchedule): DepreciationSchedule
    fun findById(scheduleId: UUID): DepreciationSchedule?
    fun findByAssetId(assetId: UUID): DepreciationSchedule?
    fun findDueForRecording(date: Instant): List<DepreciationSchedule>
}

interface WarrantyClaimRepository {
    fun save(claim: WarrantyClaim): WarrantyClaim
    fun findById(claimId: UUID): WarrantyClaim?
    fun findByAssetId(assetId: UUID): List<WarrantyClaim>
    fun findByTenant(tenantId: UUID, status: String?, page: Int, size: Int): PageResult<WarrantyClaim>
    fun findActiveClaimsForAsset(assetId: UUID): List<WarrantyClaim>
}

interface AssetDisposalRepository {
    fun save(disposal: AssetDisposal): AssetDisposal
    fun findById(disposalId: UUID): AssetDisposal?
    fun findByAssetId(assetId: UUID): AssetDisposal?
    fun findPendingDisposals(tenantId: UUID): List<AssetDisposal>
}

// --- CQRS Read Model ---
interface TCOReadModelPort {
    fun getAssetTCO(assetId: UUID): AssetTCODto
    fun getFleetTCO(tenantId: UUID, from: Instant, to: Instant): FleetTCODto
    fun getTCOBreakdown(assetId: UUID): TCOBreakdownDto
    fun getTCOComparison(tenantId: UUID, assetType: AssetType?): TCOComparisonDto
}

interface DepreciationReadModelPort {
    fun getPortfolioBookValue(tenantId: UUID): PortfolioBookValueDto
    fun getAssetDepreciationHistory(assetId: UUID): List<DepreciationEntryDto>
    fun getFleetDepreciationSummary(tenantId: UUID, period: String): FleetDepreciationSummaryDto
}

// DTOs
data class AssetFilterDto(
    val assetType: AssetType? = null,
    val lifecyclePhase: LifecyclePhase? = null,
    val status: AssetStatus? = null,
    val make: String? = null,
    val yearFrom: Int? = null,
    val yearTo: Int? = null
)

data class AssetTCODto(
    val assetId: UUID, val acquisitionCost: BigDecimal,
    val depreciationCost: BigDecimal, val maintenanceCost: BigDecimal,
    val fuelCost: BigDecimal, val insuranceCost: BigDecimal,
    val operatingCost: BigDecimal, val disposalCost: BigDecimal,
    val totalTCO: BigDecimal, val costPerMile: BigDecimal,
    val costPerDay: BigDecimal
)

data class FleetTCODto(
    val tenantId: UUID, val totalAssets: Int,
    val totalAcquisitionCost: BigDecimal, val totalTCO: BigDecimal,
    val averageCostPerMile: BigDecimal, val averageCostPerDay: BigDecimal,
    val topCostAssets: List<AssetTCODto>
)

data class TCOBreakdownDto(
    val assetId: UUID,
    val monthlyCosts: List<MonthlyCostEntry>
)

data class PortfolioBookValueDto(
    val tenantId: UUID, val totalBookValue: BigDecimal,
    val totalAcquisitionCost: BigDecimal, val totalAccumulatedDepreciation: BigDecimal,
    val assetCountByType: Map<String, Int>
)
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/assets`

#### Asset Management

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/` | Register a new asset | `201` `AssetResponse` |
| `GET` | `/{assetId}` | Get asset details | `200` `AssetDetailResponse` |
| `GET` | `/` | List assets with filters | `200` `Page<AssetSummaryResponse>` |
| `GET` | `/search` | Search by VIN, make, model | `200` `List<AssetSummaryResponse>` |
| `PUT` | `/{assetId}` | Update asset details | `200` `AssetResponse` |
| `POST` | `/{assetId}/activate` | Activate asset | `200` `AssetResponse` |
| `POST` | `/{assetId}/end-of-life` | Transition to end-of-life | `200` `AssetResponse` |
| `POST` | `/{assetId}/retire` | Retire asset | `200` `AssetResponse` |
| `GET` | `/{assetId}/specification` | Get vehicle specification | `200` `SpecificationResponse` |

#### Depreciation

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/{assetId}/depreciation/schedules` | Create depreciation schedule | `201` `DepreciationScheduleResponse` |
| `GET` | `/{assetId}/depreciation/schedules` | Get depreciation schedule | `200` `DepreciationScheduleDetailResponse` |
| `GET` | `/depreciation/portfolio` | Portfolio book value summary | `200` `PortfolioBookValueResponse` |
| `GET` | `/depreciation/fleet-summary` | Fleet depreciation summary | `200` `FleetDepreciationSummaryResponse` |

#### Warranty

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/{assetId}/warranty/claims` | File warranty claim | `201` `WarrantyClaimResponse` |
| `GET` | `/warranty/claims/{claimId}` | Get claim details | `200` `WarrantyClaimDetailResponse` |
| `GET` | `/warranty/claims` | List claims with filters | `200` `Page<WarrantyClaimSummaryResponse>` |
| `POST` | `/warranty/claims/{claimId}/submit` | Submit to provider | `200` `WarrantyClaimResponse` |
| `POST` | `/warranty/claims/{claimId}/response` | Record provider response | `200` `WarrantyClaimResponse` |
| `GET` | `/{assetId}/warranty/status` | Get asset warranty coverage | `200` `WarrantyStatusResponse` |

#### Disposal

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/{assetId}/disposal` | Initiate disposal | `201` `DisposalResponse` |
| `GET` | `/disposal/{disposalId}` | Get disposal details | `200` `DisposalDetailResponse` |
| `POST` | `/disposal/{disposalId}/complete` | Complete disposal | `200` `DisposalResponse` |
| `POST` | `/disposal/{disposalId}/cancel` | Cancel disposal | `200` `DisposalResponse` |
| `GET` | `/{assetId}/disposal/valuation` | Get disposal valuation estimate | `200` `ValuationResponse` |

#### TCO & Analytics

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/{assetId}/tco` | Get asset TCO | `200` `AssetTCOResponse` |
| `GET` | `/{assetId}/tco/breakdown` | Get TCO breakdown by category | `200` `TCOBreakdownResponse` |
| `GET` | `/tco/fleet` | Get fleet TCO summary | `200` `FleetTCOResponse` |
| `GET` | `/tco/comparison` | Compare TCO across assets | `200` `TCOComparisonResponse` |
| `GET` | `/procurement/recommendations` | Get procurement recommendations | `200` `List<ProcurementRecommendationResponse>` |

### 5.2 gRPC API

```protobuf
syntax = "proto3";
package fleetvision.asset.v1;

service AssetLifecycleService {
  rpc GetAsset(GetAssetRequest) returns (AssetResponse);
  rpc GetAssetBookValue(GetAssetBookValueRequest) returns (BookValueResponse);
  rpc GetAssetTCO(GetAssetTCORequest) returns (TCOResponse);
  rpc GetWarrantyCoverage(GetWarrantyCoverageRequest) returns (WarrantyCoverageResponse);
  rpc GetDisposalValuation(GetDisposalValuationRequest) returns (ValuationResponse);
  rpc ValidateAssetForDisposal(ValidateAssetForDisposalRequest) returns (ValidationResponse);
}
```

---

## 6. Kafka Event Contracts

### 6.1 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `asset.lifecycle.registered.v1` | `AssetRegisteredEvent` | `assetId` | By asset |
| `asset.lifecycle.activated.v1` | `AssetActivatedEvent` | `assetId` | By asset |
| `asset.lifecycle.mileage-updated.v1` | `AssetMileageUpdatedEvent` | `assetId` | By asset |
| `asset.lifecycle.book-value-updated.v1` | `AssetBookValueUpdatedEvent` | `tenantId` | By tenant |
| `asset.lifecycle.end-of-life.v1` | `AssetEndOfLifeEvent` | `assetId` | By asset |
| `asset.lifecycle.retired.v1` | `AssetRetiredEvent` | `assetId` | By asset |
| `asset.depreciation.recorded.v1` | `DepreciationRecordedEvent` | `tenantId` | By tenant |
| `asset.warranty.claim-filed.v1` | `WarrantyClaimFiledEvent` | `assetId` | By asset |
| `asset.warranty.claim-paid.v1` | `WarrantyClaimPaidEvent` | `assetId` | By asset |
| `asset.disposal.initiated.v1` | `DisposalInitiatedEvent` | `assetId` | By asset |
| `asset.disposal.completed.v1` | `DisposalCompletedEvent` | `tenantId` | By tenant |

### 6.2 Events Consumed (Subscriber)

| Source Topic | Consuming Handler | Purpose |
|---|---|---|
| `fleet.vehicle.created.v1` | `VehicleLifecycleConsumer` | Auto-create FleetAsset when vehicle is registered in fleet mgmt |
| `fleet.vehicle.deactivated.v1` | `VehicleLifecycleConsumer` | Trigger end-of-life evaluation |
| `maintenance.workorder.completed.v1` | `MaintenanceCostConsumer` | Update TCO maintenance cost; check warranty coverage |
| `fuel.transaction.completed.v1` | `FuelCostConsumer` | Update TCO fuel cost |
| `tracking.position.updated.v1` | `MileageAccumulationConsumer` | Accumulate mileage for depreciation (units-of-production) |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| `fleet-management-service` | Kafka (async) | Vehicle lifecycle events | Eventual consistency |
| `vehicle-maintenance-service` | Kafka (async) | Maintenance cost data | Eventual consistency |
| `fuel-management-service` | Kafka (async) | Fuel cost data | Eventual consistency |
| `tracking-service` | Kafka (async) | Mileage accumulation | Eventual consistency |
| `billing-service` | Kafka (async) | Depreciation data for financial reporting | Fire-and-forget |
| `notification-service` | Kafka (async) | Warranty expiration alerts | Fire-and-forget |
| `analytics-engine` | Kafka (async) | TCO metrics for dashboards | Fire-and-forget |

### 7.2 External Integrations

| Integration | Protocol | Purpose | Adapter |
|---|---|---|---|
| **SAP S/4HANA** | REST/gRPC | Fixed asset accounting, depreciation sync | `ERPIntegrationAdapter` |
| **Oracle ERP** | REST | Fixed asset accounting | `ERPIntegrationAdapter` |
| **Insurance Platforms** | REST API | Insurance policy validation | `InsurancePlatformAdapter` |
| **Kelley Blue Book** | REST API | Market valuation for disposal estimates | `KellyBlueBookAdapter` |
| **Auction Platforms** | REST API | Submit assets for auction disposal | `AuctionPlatformAdapter` |

---

## 8. Configuration Properties

```yaml
# application.yml
asset:
  service:
    name: asset-lifecycle-service

  depreciation:
    default-method: STRAIGHT_LINE
    default-useful-life-years: 7
    default-salvage-value-percent: 10
    calculation-cron: "0 0 1 * *"   # Monthly on the 1st
    units-of-production-mileage-source: tracking  # tracking or manual

  warranty:
    auto-file-claim: false
    claim-expiry-days: 365
    document-max-size-mb: 25
    document-max-count: 10
    reminder-days-before-expiry: 30

  disposal:
    valuation-source: kbb  # kbb or manual
    require-management-approval: true
    minimum-sale-price-percent: 50  # % of estimated value
    auto-title-transfer: true

  tco:
    recalculation-cron: "0 0 2 * *"  # Daily at 2 AM
    cost-categories:
      - depreciation
      - maintenance
      - fuel
      - insurance
      - registration
      - tolls
      - disposal

  procurement:
    recommendation-algorithm: tco-optimized  # tco-optimized, cost-minimal, balanced
    replacement-trigger-percent: 80  # % of useful life

server:
  port: 8093

spring:
  application:
    name: asset-lifecycle-service

  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:fleetvision_asset}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:}

  jpa:
    hibernate:
      ddl-auto: validate

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    consumer:
      group-id: asset-lifecycle-service
      auto-offset-reset: latest

grpc:
  server:
    port: 9097

resilience4j:
  circuitbreaker:
    instances:
      fleetManagement:
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
      kbbAdapter:
        slidingWindowSize: 5
        failureRateThreshold: 60
        waitDurationInOpenState: 60s
  retry:
    instances:
      kbbAdapter:
        maxAttempts: 3
        waitDuration: 5s
  timelimiter:
    instances:
      kbbAdapter:
        timeoutDuration: 10s
      erpAdapter:
        timeoutDuration: 15s
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configuration

| Target Service | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| KBB Valuation API | 5 calls | 60% | 60s | 2 |
| ERP Integration | 5 calls | 50% | 60s | 2 |
| Insurance Platform | 10 calls | 50% | 30s | 3 |

### 9.2 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| KBB valuation | 10s | Return manual valuation; flag for review |
| ERP sync | 15s | Queue for async retry |
| Insurance validation | 5s | Accept without validation; flag |

### 9.3 Graceful Degradation

- **KBB unavailable:** Return last cached valuation estimate; display "estimated" qualifier.
- **ERP unavailable:** Asset accounting data is maintained locally; ERP sync queued for later.
- **External event lag:** TCO calculations use last known data; staleness indicator shown in UI.

---

## 10. Test Strategy

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | JUnit 5 + MockK + Kotest | 90% | Depreciation calculations, TCO formulas, invariants, warranty coverage rules, lifecycle state machine |
| **Integration Tests** | Spring Boot Test + Testcontainers | 80% | Asset CRUD, depreciation recording, warranty lifecycle, disposal flow |
| **Contract Tests** | Pact | 100% | gRPC contracts with billing, fleet-mgmt |
| **E2E Tests** | Karate DSL | Critical paths | Asset registration -> depreciation -> warranty claim -> disposal |
| **Performance Tests** | Gatling | SLO validation | Asset portfolio query (< 500ms for 10K assets), TCO report generation |
| **Depreciation Calculation Tests** | Kotest property-based | High | Edge cases: leap year depreciation, zero salvage value, mid-year acquisition |

### Key Test Scenarios

1. **Full Lifecycle:** Register -> Activate -> Depreciate over 7 years -> End-of-life -> Dispose
2. **Depreciation Accuracy:** Straight-line: $50,000 asset, $5,000 salvage, 7-year life = $6,428.57/year
3. **Units-of-Production:** $100,000 asset, 500,000 mile life, 10,000 miles this month = $2,000 depreciation
4. **Warranty Coverage:** File claim for in-warranty repair -> approved; file claim for out-of-warranty -> rejected
5. **TCO Calculation:** All cost categories aggregated accurately for 1-year, 3-year, and 7-year views
6. **Disposal Gain/Loss:** Sale price > book value = gain; sale price < book value = loss

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
