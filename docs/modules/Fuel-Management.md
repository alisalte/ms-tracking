# Fuel Management Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Service:** `fuel-management-service`
**Bounded Context:** Fuel Management

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

The Fuel Management context handles the complete fuel lifecycle for fleet operations: fuel card management, transaction processing, consumption analytics, fraud detection, and fuel price optimization. It integrates with external fuel card providers (WEX, Comdata) and provides real-time fueling cost visibility.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                   FUEL MANAGEMENT CONTEXT                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ FuelCard     │  │ FuelTrans-   │  │ FuelQuote    │          │
│  │ (Aggregate)  │  │ action       │  │ (Aggregate)  │          │
│  └──────────────┘  │ (Aggregate)  │  └──────────────┘          │
│                    └──────────────┘                               │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ FuelStation  │  │ FraudAlert   │  Domain Services:            │
│  │ (Aggregate)  │  │ (Read Model) │  - FuelConsumptionAnalyzer  │
│  └──────────────┘  └──────────────┘  - FraudDetectionEngine      │
│                                          - FuelCostOptimizer     │
└────────┬──────────┬──────────────────┬───────────────┬───────────┘
         │          │                  │               │
    ┌────┴───┐  ┌───┴─────┐     ┌──────┴──────┐  ┌────┴─────┐
    │ Trip & │  │ Fleet    │     │  Billing    │  │ Analy-   │
    │ Route  │  │ Mgmt    │     │  & Tenant   │  │ tics     │
    └────────┘  └──────────┘     └─────────────┘  └──────────┘
```

**Upstream (produces events consumed by):**
- `billing-service` — Fuel transaction completed events for invoice generation
- `analytics-engine` — Fuel consumption data for dashboards and ML models
- `notification-service` — Fraud alerts, fuel card status change alerts
- `audit-log-service` — Fuel transaction audit trail

**Downstream (consumes events from):**
- `tracking-service` — GPS position events (to validate fueling location)
- `trip-management-service` — Trip lifecycle (fuel consumption attribution per trip)
- `driver-management-service` — Driver assignment changes (fuel card reassignment)

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **FuelCard** | A payment card assigned to a vehicle or driver for fuel purchases |
| **FuelTransaction** | A recorded fuel purchase event: volume, cost, location, odometer |
| **FuelQuote** | A projected fuel cost estimate for a planned trip or route |
| **FuelStation** | A registered fueling location with pricing, services, and brand |
| **FraudAlert** | A detected anomaly indicating potential fuel card misuse or fraud |
| **FuelingEvent** | A real-time notification of an in-progress or completed fueling |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                   fuel-management-service                        │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST Controllers│  │  gRPC Service Implementations│   │  │
│  │  │  (Spring MVC)    │  │  (FuelServiceGrpcImpl)       │   │  │
│  │  └────────┬────────┘  └──────────────┬───────────────┘   │  │
│  │           │                          │                    │  │
│  │  ┌────────┴────────┐  ┌─────────────┴──────────────┐    │  │
│  │  │  DTO Mappers   │  │  Event Publishers (Kafka)  │    │  │
│  │  │  (MapStruct)   │  │  (DomainEventPublisher)   │    │  │
│  │  └─────────────────┘  └──────────────────────────┘    │  │
│  │                                                           │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │  External Adapters (Anti-Corruption Layers)       │    │  │
│  │  │  • WEXFuelCardAdapter (REST + SFTP)               │    │  │
│  │  │  • ComdataFuelCardAdapter (REST + SFTP)          │    │  │
│  │  │  • FuelPriceProviderAdapter                        │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Command Handlers                                  │    │  │
│  │  │  • IssueFuelCardCommandHandler                     │    │  │
│  │  │  • SuspendFuelCardCommandHandler                   │    │  │
│  │  │  • RecordFuelTransactionCommandHandler             │    │  │
│  │  │  • ProcessBulkImportCommandHandler                 │    │  │
│  │  │  • CreateFuelQuoteCommandHandler                  │    │  │
│  │  │  • ResolveFraudAlertCommandHandler                 │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Query Handlers (CQRS)                              │    │  │
│  │  │  • GetFuelCardQueryHandler                          │    │  │
│  │  │  • GetFuelTransactionsQueryHandler                  │    │  │
│  │  │  • GetFuelConsumptionReportQueryHandler             │    │  │
│  │  │  • GetFraudAlertsQueryHandler                        │    │  │
│  │  │  • GetFuelStationPricesQueryHandler                  │    │  │
│  │  │  • GetFleetFuelAnalyticsQueryHandler                │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Services                                    │    │  │
│  │  │  • FuelConsumptionAnalyzer                         │    │  │
│  │  │  • FraudDetectionEngine                             │    │  │
│  │  │  • FuelCostOptimizer                               │    │  │
│  │  │  • FuelCardLimitCalculator                         │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Aggregate Roots                                    │    │  │
│  │  │  • FuelCard                                         │    │  │
│  │  │  • FuelTransaction                                   │    │  │
│  │  │  • FuelQuote                                        │    │  │
│  │  │  • FuelStation                                      │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • CardStatus, CardType, FuelType                   │    │  │
│  │  │  • TransactionType, FraudSeverity                     │    │  │
│  │  │  • FuelVolume, Money, OdometerReading               │    │  │
│  │  │  • StationAmenities, StationBrand                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Events (see Section 6)                     │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Persistence (PostgreSQL)                          │    │  │
│  │  │  • FuelCardJpaRepository                           │    │  │
│  │  │  • FuelTransactionJpaRepository                    │    │  │
│  │  │  • FuelStationJpaRepository                        │    │  │
│  │  │  • FuelConsumptionReadModelRepository              │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Kafka Consumers                                   │    │  │
│  │  │  • PositionEventConsumer (from tracking-service)   │    │  │
│  │  │  • TripEventConsumer (from trip-mgmt)               │    │  │
│  │  │  • DriverEventConsumer (from driver-mgmt)          │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  External Integration Adapters                      │    │  │
│  │  │  • WEXFuelCardAdapter                               │    │  │
│  │  │  • ComdataFuelCardAdapter                           │    │  │
│  │  │  • FuelPriceProviderAdapter                         │    │  │
│  │  │  • OFACSanctionCheckAdapter                        │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
com.fleetvision.fuel/
├── api/
│   ├── rest/
│   │   ├── FuelCardController.kt
│   │   ├── FuelTransactionController.kt
│   │   ├── FuelStationController.kt
│   │   └── FuelAnalyticsController.kt
│   └── grpc/
│       ├── FuelServiceGrpcImpl.kt
│       └── proto/
├── application/
│   ├── command/ + commandhandler/
│   ├── query/ + queryhandler/
│   ├── service/
│   └── port/inbound/ + port/outbound/
├── domain/
│   ├── model/
│   │   ├── aggregate/ (FuelCard, FuelTransaction, FuelQuote, FuelStation)
│   │   ├── valueobject/
│   │   └── event/
│   └── service/
├── infrastructure/
│   ├── config/
│   ├── persistence/
│   ├── messaging/
│   └── adapter/
└── FuelManagementServiceApplication.kt
```

---

## 3. Aggregate Root Designs

### 3.1 FuelCard (Aggregate Root)

**Purpose:** Manages the lifecycle of a fuel payment card, including issuance, activation, limit management, suspension, and deactivation.

#### Fields

| Field | Type | Description |
|---|---|---|
| `cardId` | `FuelCardId` (UUID) | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `cardNumber` | `String` | Masked card number (last 4 visible) |
| `cardType` | `CardType` | `FLEET`, `PERSONAL`, `HYBRID` |
| `provider` | `FuelCardProvider` | `WEX`, `COMDATA`, `INTERNAL` |
| `externalCardId` | `String?` | Provider-side card reference |
| `assignedVehicleId` | `VehicleId?` (UUID) | Vehicle this card is assigned to |
| `assignedDriverId` | `DriverId?` (UUID) | Driver this card is assigned to |
| `status` | `CardStatus` | `ISSUED`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED`, `TERMINATED` |
| `dailyLimit` | `Money` (BigDecimal) | Maximum spend per day |
| `monthlyLimit` | `Money` (BigDecimal) | Maximum spend per month |
| `transactionLimit` | `Money` (BigDecimal) | Maximum per-transaction spend |
| `maxGallonsPerTransaction` | `Int` | Maximum fuel volume per transaction |
| `allowedFuelTypes` | `Set<FuelType>` | `DIESEL`, `GASOLINE`, `E85`, `CNG`, `DEF` |
| `allowedProductCategories` | `Set<ProductCategory>` | `FUEL`, `OIL`, `MAINTENANCE`, `TOLL` |
| `currentDaySpend` | `Money` (BigDecimal) | Spend tracking (current day) |
| `currentMonthSpend` | `Money` (BigDecimal) | Spend tracking (current month) |
| `createdAt` | `Instant` | Card issuance timestamp |
| `updatedAt` | `Instant` | Last update timestamp |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `issueCard()` | cardType, provider, assignedVehicleId, assignedDriverId, limits | `FuelCardIssuedEvent` | Vehicle must exist and be active; driver must exist if assigned |
| `activateCard()` | — | `FuelCardActivatedEvent` | Card must be in ISSUED status; provider card must be activated externally |
| `suspendCard()` | reason | `FuelCardSuspendedEvent` | Card must be ACTIVE |
| `reinstateCard()` | — | `FuelCardReinstatedEvent` | Card must be SUSPENDED |
| `updateLimits()` | dailyLimit, monthlyLimit, transactionLimit, maxGallons | `FuelCardLimitsUpdatedEvent` | Limits must be within tenant quota |
| `assignToVehicle()` | vehicleId | `FuelCardVehicleAssignedEvent` | Card must be ACTIVE; vehicle must be active and unassigned |
| `assignToDriver()` | driverId | `FuelCardDriverAssignedEvent` | Card must be ACTIVE; driver must be active |
| `deactivateCard()` | reason | `FuelCardDeactivatedEvent` | Card must be ACTIVE or SUSPENDED |
| `terminateCard()` | reason | `FuelCardTerminatedEvent` | Card must be DEACTIVATED |

#### Invariants

1. **Unique Card Assignment:** A card can be assigned to at most one vehicle OR one driver at a time.
2. **Spend Limits:** No transaction can exceed `transactionLimit`; cumulative daily/monthly spend cannot exceed respective limits.
3. **Allowed Products:** Purchases of products not in `allowedProductCategories` are rejected.
4. **Suspended Card Transactions:** A SUSPENDED card cannot authorize new transactions.
5. **Provider Sync:** External provider card state must eventually match internal state; conflicts trigger alerts.

#### Domain Events

```kotlin
// Event naming: fuel.card.<event>.v1
data class FuelCardIssuedEvent(
    val cardId: UUID, val tenantId: UUID,
    val cardNumber: String, val cardType: CardType,
    val provider: FuelCardProvider, val assignedVehicleId: UUID?,
    val assignedDriverId: UUID?, val dailyLimit: BigDecimal,
    val monthlyLimit: BigDecimal, val transactionLimit: BigDecimal,
    val maxGallonsPerTransaction: Int, val allowedFuelTypes: Set<FuelType>,
    val timestamp: Instant
)

data class FuelCardSuspendedEvent(
    val cardId: UUID, val tenantId: UUID,
    val reason: String, val suspendedBy: UUID, val timestamp: Instant
)

data class FuelCardLimitsUpdatedEvent(
    val cardId: UUID, val tenantId: UUID,
    val dailyLimit: BigDecimal, val monthlyLimit: BigDecimal,
    val transactionLimit: BigDecimal, val maxGallonsPerTransaction: Int,
    val updatedBy: UUID, val timestamp: Instant
)

data class FuelCardVehicleAssignedEvent(
    val cardId: UUID, val tenantId: UUID,
    val vehicleId: UUID, val timestamp: Instant
)
```

---

### 3.2 FuelTransaction (Aggregate Root)

**Purpose:** Records a single fuel purchase or transfer event. Each transaction is validated against the associated fuel card and vehicle for fraud detection.

#### Fields

| Field | Type | Description |
|---|---|---|
| `transactionId` | `FuelTransactionId` (UUID) | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `cardId` | `FuelCardId` (UUID) | Fuel card used |
| `vehicleId` | `VehicleId` (UUID) | Vehicle fueled |
| `driverId` | `DriverId?` (UUID) | Driver performing fueling |
| `tripId` | `TripId?` (UUID) | Associated trip for attribution |
| `transactionType` | `TransactionType` | `FUEL_PURCHASE`, `DEF_PURCHASE`, `MAINTENANCE`, `TOLL` |
| `fuelType` | `FuelType?` | Type of fuel purchased |
| `volume` | `BigDecimal` | Gallons or liters |
| `pricePerUnit` | `BigDecimal` | Price per gallon/liter |
| `totalAmount` | `BigDecimal` | Total cost including tax |
| `taxAmount` | `BigDecimal` | Tax component |
| `odometerReading` | `Long?` | Odometer at fueling |
| `fuelingTimestamp` | `Instant` | When fueling occurred |
| `stationId` | `UUID?` | Fuel station |
| `stationName` | `String?` | Station display name |
| `stationLocation` | `LocationSnapshot?` | Station coordinates |
| `receiptUrl` | `String?` | Digital receipt |
| `status` | `TransactionStatus` | `PENDING_AUTH`, `AUTHORIZED`, `COMPLETED`, `DECLINED`, `REVERSED`, `DISPUTED` |
| `fraudScore` | `Double?` | Fraud detection score (0-1) |
| `fraudAlertId` | `UUID?` | Linked fraud alert if applicable |
| `mpg` | `BigDecimal?` | Calculated miles per gallon (if prior odometer available) |
| `createdAt` | `Instant` | Record creation time |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `initiateTransaction()` | cardId, vehicleId, transactionType, fuelType, volume, pricePerUnit, stationId | `FuelTransactionInitiatedEvent` | Card must be ACTIVE; limits checked |
| `completeTransaction()` | odometerReading, receiptUrl, actualAmount | `FuelTransactionCompletedEvent` | Transaction must be AUTHORIZED |
| `declineTransaction()` | declineReason | `FuelTransactionDeclinedEvent` | Transaction must be PENDING_AUTH or AUTHORIZED |
| `reverseTransaction()` | reason | `FuelTransactionReversedEvent` | Transaction must be COMPLETED |
| `disputeTransaction()` | disputeReason, evidence | `FuelTransactionDisputedEvent` | Transaction must be COMPLETED |
| `attachFraudAlert()` | fraudAlertId, fraudScore | `FuelTransactionFlaggedEvent` | fraudScore must be above threshold |

#### Invariants

1. **Authorization Before Completion:** Transaction must be in `AUTHORIZED` status before completion.
2. **Volume Validation:** Volume must be within reasonable bounds for the vehicle type (e.g., truck 50-200 gal, car 5-25 gal).
3. **Odometer Consistency:** Odometer reading must be >= previous reading for the same vehicle.
4. **Geographic Validation:** Fueling location must be within reasonable distance from the vehicle's last known GPS position (configurable radius, default 50 miles).
5. **Time Window:** Fueling must occur during the driver's on-duty hours or within 1 hour of trip completion.
6. **Duplicate Detection:** Same card + station + timestamp (within 5 minutes) triggers duplicate check.

#### Domain Events

```kotlin
// Event naming: fuel.transaction.<event>.v1
data class FuelTransactionCompletedEvent(
    val transactionId: UUID, val tenantId: UUID,
    val cardId: UUID, val vehicleId: UUID, val driverId: UUID?,
    val tripId: UUID?, val transactionType: TransactionType,
    val fuelType: FuelType?, val volume: BigDecimal,
    val pricePerUnit: BigDecimal, val totalAmount: BigDecimal,
    val taxAmount: BigDecimal, val odometerReading: Long?,
    val stationId: UUID?, val stationName: String?,
    val stationLocation: LocationSnapshot?, val mpg: BigDecimal?,
    val timestamp: Instant
)

data class FuelTransactionDeclinedEvent(
    val transactionId: UUID, val tenantId: UUID,
    val cardId: UUID, val vehicleId: UUID,
    val declineReason: String, val timestamp: Instant
)

data class FuelTransactionFlaggedEvent(
    val transactionId: UUID, val tenantId: UUID,
    val fraudAlertId: UUID, val fraudScore: Double,
    val fraudIndicators: List<String>, val timestamp: Instant
)

data class FuelTransactionDisputedEvent(
    val transactionId: UUID, val tenantId: UUID,
    val disputeReason: String, val evidenceUrls: List<String>,
    val disputedBy: UUID, val timestamp: Instant
)
```

---

### 3.3 FuelQuote (Aggregate Root)

**Purpose:** Generates projected fuel cost estimates for planned trips, enabling cost comparison and budgeting.

#### Fields

| Field | Type | Description |
|---|---|---|
| `quoteId` | `FuelQuoteId` (UUID) | Unique identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `tripId` | `TripId?` (UUID) | Associated planned trip |
| `vehicleId` | `VehicleId` (UUID) | Vehicle for the trip |
| `routeDistanceMiles` | `BigDecimal` | Total route distance |
| `estimatedFuelVolume` | `BigDecimal` | Projected fuel needed |
| `vehicleMPG` | `BigDecimal` | Vehicle fuel efficiency |
| `fuelType` | `FuelType` | Required fuel type |
| `stations` | `List<StationQuote>` | Fueling stop recommendations with prices |
| `totalEstimatedCost` | `BigDecimal` | Total projected fuel cost |
| `savingsVsAverage` | `BigDecimal` | Cost savings vs. average station prices |
| `validUntil` | `Instant` | Quote expiration |
| `status` | `QuoteStatus` | `PENDING`, `ACCEPTED`, `EXPIRED` |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `generateQuote()` | vehicleId, routeDistance, fuelType, stations | `FuelQuoteGeneratedEvent` | Vehicle must have MPG data; route must be valid |
| `acceptQuote()` | — | `FuelQuoteAcceptedEvent` | Quote must not be expired |

---

### 3.4 FuelStation (Aggregate Root)

**Purpose:** Catalog of fueling locations with pricing, amenities, and real-time availability.

#### Fields

| Field | Type | Description |
|---|---|---|
| `stationId` | `StationId` (UUID) | Unique identifier |
| `tenantId` | `TenantId?` (UUID) | Owning tenant (null = public) |
| `name` | `String` | Station name |
| `brand` | `StationBrand` | `PILOT`, `LOVES`, `TA`, `SHELL`, `BP`, `INDEPENDENT` |
| `address` | `String` | Full address |
| `location` | `LocationSnapshot` | Coordinates |
| `fuelTypes` | `Set<FuelType>` | Available fuel types |
| `amenities` | `Set<Amenity>` | Parking, showers, food, ATM |
| `hoursOfOperation` | `String` | Operating hours |
| `isTruckStop` | `Boolean` | Accepts heavy vehicles |
| `lastPriceUpdate` | `Instant` | Last pricing data refresh |

#### Domain Events

```kotlin
data class FuelQuoteGeneratedEvent(
    val quoteId: UUID, val tenantId: UUID,
    val tripId: UUID?, val vehicleId: UUID,
    val routeDistanceMiles: BigDecimal, val estimatedFuelVolume: BigDecimal,
    val totalEstimatedCost: BigDecimal, val fuelType: FuelType,
    val recommendedStations: List<StationQuote>, val validUntil: Instant,
    val timestamp: Instant
)
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.fuel.application.port.outbound

import com.fleetvision.fuel.domain.model.aggregate.*
import com.fleetvision.fuel.application.query.*
import java.time.Instant
import java.util.UUID

// --- Write Repositories ---

interface FuelCardRepository {
    fun save(card: FuelCard): FuelCard
    fun findById(cardId: UUID): FuelCard?
    fun findByExternalCardId(externalCardId: String): FuelCard?
    fun findActiveByVehicle(vehicleId: UUID): List<FuelCard>
    fun findActiveByDriver(driverId: UUID): List<FuelCard>
    fun findByTenant(tenantId: UUID, page: Int, size: Int): PageResult<FuelCard>
    fun delete(card: FuelCard)
}

interface FuelTransactionRepository {
    fun save(transaction: FuelTransaction): FuelTransaction
    fun findById(transactionId: UUID): FuelTransaction?
    fun findByCard(cardId: UUID, page: Int, size: Int): PageResult<FuelTransaction>
    fun findByVehicle(vehicleId: UUID, from: Instant, to: Instant): List<FuelTransaction>
    fun findByTenant(tenantId: UUID, from: Instant, to: Instant, page: Int, size: Int, filters: TransactionFilterDto): PageResult<FuelTransaction>
    fun findDuplicates(cardId: UUID, stationId: UUID?, timestampWindow: Instant): List<FuelTransaction>
}

interface FuelQuoteRepository {
    fun save(quote: FuelQuote): FuelQuote
    fun findById(quoteId: UUID): FuelQuote?
}

interface FuelStationRepository {
    fun save(station: FuelStation): FuelStation
    fun findById(stationId: UUID): FuelStation?
    fun findByLocation(latitude: Double, longitude: Double, radiusMiles: Double): List<FuelStation>
    fun findByBrand(brand: StationBrand): List<FuelStation>
}

// --- Read Model Repositories (CQRS) ---

interface FuelAnalyticsReadModelPort {
    fun getFleetConsumptionReport(tenantId: UUID, from: Instant, to: Instant): FleetConsumptionReportDto
    fun getVehicleConsumption(vehicleId: UUID, from: Instant, to: Instant): VehicleConsumptionDto
    fun getDriverConsumption(driverId: UUID, from: Instant, to: Instant): DriverConsumptionDto
    fun getFuelCostTrend(tenantId: UUID, months: Int): FuelCostTrendDto
    fun getMPGAnalysis(vehicleId: UUID, from: Instant, to: Instant): MPGAnalysisDto
}

interface FraudAlertReadModelPort {
    fun findOpenAlerts(tenantId: UUID): List<FraudAlertDto>
    fun findByTransaction(transactionId: UUID): FraudAlertDto?
    fun getFraudStats(tenantId: UUID, from: Instant, to: Instant): FraudStatsDto
}

// --- DTOs ---
data class TransactionFilterDto(
    val vehicleId: UUID? = null, val driverId: UUID? = null,
    val cardId: UUID? = null, val status: String? = null,
    val fuelType: String? = null, val transactionType: String? = null,
    val minAmount: BigDecimal? = null, val maxAmount: BigDecimal? = null
)

data class FleetConsumptionReportDto(
    val totalGallons: BigDecimal, val totalCost: BigDecimal,
    val averagePricePerGallon: BigDecimal, val transactionCount: Int,
    val fleetMPG: BigDecimal, val costPerMile: BigDecimal,
    val topStations: List<StationSummaryDto>, val vehicleBreakdown: List<VehicleFuelSummaryDto>
)

data class VehicleConsumptionDto(
    val vehicleId: UUID, val totalGallons: BigDecimal, val totalCost: BigDecimal,
    val averageMPG: BigDecimal, val transactionCount: Int
)

data class FraudAlertDto(
    val alertId: UUID, val transactionId: UUID, val cardId: UUID,
    val vehicleId: UUID, val fraudScore: Double, val severity: String,
    val indicators: List<String>, val status: String, val createdAt: Instant
)
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/fuel`

#### Fuel Card Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/cards` | Issue a new fuel card | `201` `FuelCardResponse` |
| `GET` | `/cards/{cardId}` | Get card details | `200` `FuelCardDetailResponse` |
| `GET` | `/cards` | List cards with filters | `200` `Page<FuelCardSummaryResponse>` |
| `GET` | `/vehicles/{vehicleId}/cards` | Get cards assigned to vehicle | `200` `List<FuelCardSummaryResponse>` |
| `GET` | `/drivers/{driverId}/cards` | Get cards assigned to driver | `200` `List<FuelCardSummaryResponse>` |
| `POST` | `/cards/{cardId}/activate` | Activate card | `200` `FuelCardResponse` |
| `POST` | `/cards/{cardId}/suspend` | Suspend card | `200` `FuelCardResponse` |
| `POST` | `/cards/{cardId}/reinstate` | Reinstate suspended card | `200` `FuelCardResponse` |
| `PUT` | `/cards/{cardId}/limits` | Update card limits | `200` `FuelCardResponse` |
| `POST` | `/cards/{cardId}/assign-vehicle` | Assign card to vehicle | `200` `FuelCardResponse` |
| `POST` | `/cards/{cardId}/assign-driver` | Assign card to driver | `200` `FuelCardResponse` |
| `POST` | `/cards/{cardId}/deactivate` | Deactivate card | `200` `FuelCardResponse` |
| `POST` | `/cards/{cardId}/terminate` | Terminate card permanently | `200` `FuelCardResponse` |

#### Fuel Transaction Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/transactions` | Record a fuel transaction | `201` `FuelTransactionResponse` |
| `GET` | `/transactions/{transactionId}` | Get transaction details | `200` `FuelTransactionDetailResponse` |
| `GET` | `/transactions` | List transactions with filters | `200` `Page<FuelTransactionSummaryResponse>` |
| `GET` | `/cards/{cardId}/transactions` | Get transactions for a card | `200` `Page<FuelTransactionSummaryResponse>` |
| `GET` | `/vehicles/{vehicleId}/transactions` | Get transactions for a vehicle | `200` `Page<FuelTransactionSummaryResponse>` |
| `POST` | `/transactions/bulk-import` | Bulk import from provider file | `202` `BulkImportResponse` |
| `POST` | `/transactions/{transactionId}/dispute` | Dispute a transaction | `200` `FuelTransactionResponse` |
| `POST` | `/transactions/{transactionId}/reverse` | Reverse a transaction | `200` `FuelTransactionResponse` |

#### Fuel Station & Quote Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/stations` | Search stations by location | `200` `List<StationResponse>` |
| `GET` | `/stations/{stationId}` | Get station details | `200` `StationDetailResponse` |
| `GET` | `/stations/{stationId}/prices` | Get current fuel prices | `200` `PriceListResponse` |
| `POST` | `/quotes` | Generate fuel cost estimate | `201` `FuelQuoteResponse` |
| `GET` | `/quotes/{quoteId}` | Get quote details | `200` `FuelQuoteResponse` |

#### Analytics Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/analytics/fleet-consumption` | Fleet fuel consumption report | `200` `FleetConsumptionReportResponse` |
| `GET` | `/analytics/vehicles/{vehicleId}/consumption` | Vehicle consumption data | `200` `VehicleConsumptionResponse` |
| `GET` | `/analytics/cost-trend` | Fuel cost trend over time | `200` `FuelCostTrendResponse` |
| `GET` | `/analytics/mpg` | MPG analysis by vehicle/fleet | `200` `MPGAnalysisResponse` |
| `GET` | `/analytics/fraud-alerts` | Get fraud alerts | `200` `List<FraudAlertResponse>` |

### 5.2 gRPC API

```protobuf
syntax = "proto3";
package fleetvision.fuel.v1;

service FuelService {
  // Card Management
  rpc GetActiveCardByVehicle(GetActiveCardRequest) returns (FuelCardResponse);
  rpc ValidateCardForTransaction(ValidateCardRequest) returns (ValidationResponse);

  // Transaction Validation (called by trip/dispatch)
  rpc AuthorizeFueling(AuthorizeFuelingRequest) returns (AuthorizeFuelingResponse);

  // Analytics (called by analytics-engine)
  rpc GetFleetFuelSummary(GetFleetFuelSummaryRequest) returns (FleetFuelSummaryResponse);
}
```

---

## 6. Kafka Event Contracts

### 6.1 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `fuel.card.issued.v1` | `FuelCardIssuedEvent` | `cardId` | By card |
| `fuel.card.suspended.v1` | `FuelCardSuspendedEvent` | `cardId` | By card |
| `fuel.card.activated.v1` | `FuelCardActivatedEvent` | `cardId` | By card |
| `fuel.card.deactivated.v1` | `FuelCardDeactivatedEvent` | `cardId` | By card |
| `fuel.card.limits-updated.v1` | `FuelCardLimitsUpdatedEvent` | `cardId` | By card |
| `fuel.card.vehicle-assigned.v1` | `FuelCardVehicleAssignedEvent` | `vehicleId` | By vehicle |
| `fuel.transaction.completed.v1` | `FuelTransactionCompletedEvent` | `tenantId` | By tenant |
| `fuel.transaction.declined.v1` | `FuelTransactionDeclinedEvent` | `tenantId` | By tenant |
| `fuel.transaction.flagged.v1` | `FuelTransactionFlaggedEvent` | `tenantId` | By tenant |
| `fuel.transaction.disputed.v1` | `FuelTransactionDisputedEvent` | `tenantId` | By tenant |
| `fuel.quote.generated.v1` | `FuelQuoteGeneratedEvent` | `tenantId` | By tenant |

### 6.2 Events Consumed (Subscriber)

| Source Topic | Consuming Handler | Purpose |
|---|---|---|
| `tracking.position.updated.v1` | `PositionEventConsumer` | Validate fueling location against vehicle GPS position |
| `trip.lifecycle.changed.v1` | `TripEventConsumer` | Attribute fuel consumption to trips; trigger fuel quote for planned trips |
| `driver.assignment.changed.v1` | `DriverEventConsumer` | Update fuel card assignments on driver reassignment |
| `fleet.vehicle.deactivated.v1` | `VehicleLifecycleConsumer` | Auto-suspend fuel cards for deactivated vehicles |

### 6.3 Consumer Group Configuration

```yaml
kafka:
  consumer:
    groups:
      fuel-position-validator:
        topics:
          - tracking.position.updated.v1
        concurrency: 4
        auto-offset-reset: latest
      fuel-trip-attributor:
        topics:
          - trip.lifecycle.changed.v1
        concurrency: 2
      fuel-driver-sync:
        topics:
          - driver.assignment.changed.v1
          - fleet.vehicle.deactivated.v1
        concurrency: 2
```

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| `tracking-service` | Kafka (async) | GPS positions for fueling location validation | Eventual consistency |
| `trip-management-service` | Kafka (async) | Trip lifecycle for fuel attribution | Eventual consistency |
| `driver-management-service` | Kafka (async) | Driver assignment changes | Eventual consistency |
| `fleet-management-service` | gRPC | Validate vehicle status, fleet membership | Circuit breaker, 3s timeout |
| `billing-service` | Kafka (async) | Publish fuel transaction totals for billing | Fire-and-forget |
| `notification-service` | Kafka (async) | Fraud alerts, card status notifications | Fire-and-forget |

### 7.2 External Integrations

| Integration | Protocol | Purpose | Adapter |
|---|---|---|---|
| **WEX** | REST + SFTP | Card management, transaction file import/export | `WEXFuelCardAdapter` |
| **Comdata** | REST + SFTP | Card management, transaction file import/export | `ComdataFuelCardAdapter` |
| **OPIS (Oil Price Information Service)** | REST API | Real-time fuel price data | `FuelPriceProviderAdapter` |
| **OFAC** | REST API | Sanction screening for flagged transactions | `OFACSanctionCheckAdapter` |

### 7.3 Spring Boot Dependencies

```kotlin
dependencies {
    // Core
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")

    // gRPC
    implementation("net.devh:grpc-spring-boot-starter:3.1.0.RELEASE")

    // Kafka
    implementation("org.springframework.kafka:spring-kafka")
    implementation("io.confluent:kafka-avro-serializer:7.6.0")

    // Batch Processing (for SFTP file imports)
    implementation("org.springframework.batch:spring-batch-core")

    // SFTP
    implementation("com.jcraft:jsch:0.1.55")

    // Database
    runtimeOnly("org.postgresql:postgresql")
    implementation("org.flywaydb:flyway-core")

    // Resilience
    implementation("io.github.resilience4j:resilience4j-spring-boot3:2.2.0")

    // Observability
    implementation("io.micrometer:micrometer-tracing-bridge-brave")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.mockk:mockk:1.13.10")
    testImplementation("org.testcontainers:kafka:1.19.7")
    testImplementation("org.testcontainers:postgresql:1.19.7")
}
```

---

## 8. Configuration Properties

```yaml
# application.yml
fuel:
  service:
    name: fuel-management-service

  fraud:
    enabled: true
    score-threshold: 0.7
    volume-anomaly-deviation-percent: 30
    geographic-radius-miles: 50
    time-window-minutes: 60
    duplicate-window-minutes: 5
    auto-block-threshold: 0.95

  transaction:
    max-volume-truck-gallons: 200
    max-volume-car-gallons: 25
    odometer-max-decrease-allowed: 0
    price-max-deviation-percent: 50

  import:
    batch-size: 1000
    sftp-poll-interval-seconds: 300
    file-pattern: "fuel_transactions_*.csv"
    archive-after-import: true

  pricing:
    refresh-interval-minutes: 60
    cache-ttl-minutes: 30
    max-stations-per-quote: 5

  card:
    default-daily-limit: 500.00
    default-monthly-limit: 10000.00
    default-transaction-limit: 500.00
    default-max-gallons: 200

server:
  port: 8091

spring:
  application:
    name: fuel-management-service

  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:fleetvision_fuel}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:}

  jpa:
    hibernate:
      ddl-auto: validate

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    producer:
      key-serializer: io.confluent.kafka.serializers.KafkaAvroSerializer
      value-serializer: io.confluent.kafka.serializers.KafkaAvroSerializer
      acks: all
    consumer:
      group-id: fuel-management-service
      auto-offset-reset: latest

grpc:
  server:
    port: 9096
  client:
    fleet-management:
      address: static://fleet-management-service:9092
      negotiation-type: tls

resilience4j:
  circuitbreaker:
    instances:
      fleetManagement:
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
  retry:
    instances:
      fleetManagement:
        maxAttempts: 3
        waitDuration: 500ms
      wexAdapter:
        maxAttempts: 3
        waitDuration: 5s
  timelimiter:
    instances:
      fleetManagement:
        timeoutDuration: 3s
      wexAdapter:
        timeoutDuration: 10s
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configuration

| Target Service | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| `fleet-management-service` (gRPC) | 10 calls | 50% | 30s | 3 |
| WEX Adapter (REST) | 5 calls | 60% | 60s | 2 |
| Comdata Adapter (REST) | 5 calls | 60% | 60s | 2 |
| Fuel Price Provider (REST) | 10 calls | 50% | 30s | 3 |

### 9.2 Retry Configuration

| Operation | Max Attempts | Backoff | Retryable Errors |
|---|---|---|---|
| gRPC calls (internal) | 3 | 500ms exponential | `UNAVAILABLE`, `DEADLINE_EXCEEDED` |
| WEX card operations | 3 | 5s fixed | HTTP 502, 503, 504 |
| Price provider fetch | 3 | 2s exponential | HTTP 429, 5xx |
| SFTP file download | 5 | 10s exponential | Connection timeout, auth failure |

### 9.3 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| gRPC: Validate vehicle | 3s | Reject with `VEHICLE_SERVICE_UNAVAILABLE` |
| WEX card issuance | 10s | Queue for async retry |
| Comdata transaction sync | 10s | Accept transaction locally; sync later |
| Fuel price fetch | 5s | Return cached price with staleness indicator |

### 9.4 Graceful Degradation

- **Provider adapter down:** Accept fuel card operations locally; queue external provider sync for later reconciliation.
- **Price provider unavailable:** Use last cached fuel prices; display price staleness warning in UI.
- **Fraud detection engine failure:** Accept transactions without fraud scoring; generate post-hoc fraud reports when engine recovers.

---

## 10. Test Strategy

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | JUnit 5 + MockK + Kotest | 90% | Aggregate invariants, fraud detection rules, limit calculations, MPG computations |
| **Integration Tests** | Spring Boot Test + Testcontainers | 80% | Card lifecycle, transaction processing, bulk import, read model projections |
| **Contract Tests** | Pact | 100% | gRPC contracts with fleet-mgmt; REST contracts with billing, API gateway |
| **E2E Tests** | Testcontainers + Karate DSL | Critical paths | Card issuance -> transaction -> fraud detection -> alert -> dispute resolution |
| **Performance Tests** | Gatling | SLO validation | Transaction throughput (500 TPS), bulk import (100K records), fraud scoring latency |
| **Fraud Detection Tests** | Kotest property-based | High | Edge cases: volume anomalies, geographic impossibilities, duplicate transactions |

### Key Test Scenarios

1. **Card Lifecycle:** Issue -> Activate -> Use -> Suspend -> Reinstate -> Deactivate -> Terminate
2. **Fraud Detection:** Same card, different state within 10 minutes -> flagged; volume exceeds 200 gal for car -> flagged; fueling 1000 miles from vehicle position -> flagged
3. **Limit Enforcement:** Transaction at $400 with $500 daily limit accepted; next $200 transaction declined
4. **Bulk Import:** 50K transactions from WEX CSV parsed, validated, and persisted within 60 seconds
5. **Fuel Quote:** Route with 3 fueling stops generates accurate volume estimates within 5% of actual

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
