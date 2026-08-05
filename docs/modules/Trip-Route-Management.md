# Trip & Route Management Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Trip & Route Management
**Service:** `trip-management-service`
**Data Store:** PostgreSQL 16 (event store, read models), Redis (route cache), MongoDB (delivery documents)
**Messaging:** Kafka (domain events)
**Pattern:** CQRS + Event Sourcing (Trip aggregate)

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Design — Event Sourced Trip](#3-aggregate-root-design--event-sourced-trip)
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

The Trip & Route Management context manages the complete lifecycle of vehicle trips: from route planning and optimization, through dispatch and load management, to trip execution monitoring and proof-of-delivery (POD) capture. It handles route optimization (integrating with external mapping providers), waypoint management, ETA calculation, and multi-stop trip sequencing. The Trip aggregate is event-sourced to maintain a complete, auditable record of trip execution for regulatory compliance, customer billing, and operational analytics.

### 1.2 Context Map

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  FLEET MANAGEMENT             │     │  DRIVER MANAGEMENT            │
│  Produces: Vehicle events,   │     │  Consumes: Assignment events, │
│  fleet policies               │     │  Produces: Driver events     │
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │                                    │
┌───────────────┴───────────────┐     ┌───────────────┴───────────────┐
│  TRACKING & MONITORING       │     │  TRIP & ROUTE MANAGEMENT       │
│  Consumes: Trip route events  │◄────│  (This Context)                 │
│  Produces: Position events   │     │                                  │
└───────────────┬───────────────┘     └───────┬───────────┬───────────┘
                │                             │           │
┌───────────────┴───────────────┐     ┌───────┴───┐ ┌───┴───────────┐
│  COMPLIANCE & SAFETY          │     │ NOTIFICA- │ │ ANALYTICS      │
│  Consumes: Trip started/      │     │ TION      │ │ ENGINE         │
│  completed for HOS            │     │ SERVICE   │ │ (trip metrics) │
└───────────────┬───────────────┘     └───────────┘ └───────────────┘
                │
┌───────────────┴───────────────┐
│  BILLING & TENANT MGMT        │
│  Consumes: Trip completed     │
│  for cost allocation          │
└───────────────────────────────┘

External:
  • Google Maps / Mapbox — Route optimization, ETA, distance calculation
  • Weather APIs — Route weather conditions
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **Trip** | A discrete journey from origin to destination (possibly with intermediate stops), associated with a vehicle, driver, and optionally a load |
| **Route** | A planned sequence of waypoints and stops defining the path for one or more trips |
| **Waypoint** | An intermediate geographic point on a route that the vehicle must pass through |
| **Stop** | A planned location where the vehicle stops for pickup, delivery, rest, or fuel |
| **Dispatch** | The act of assigning a trip to a specific vehicle and driver |
| **POD (Proof of Delivery)** | Digital confirmation of successful delivery with timestamp, signature, photo, and notes |
| **ETA (Estimated Time of Arrival)** | Predicted arrival time at a stop or destination, calculated from route data and traffic |
| **Load** | Cargo or freight associated with a trip, with weight, dimensions, and handling requirements |
| **RouteDeviation** | An event when a vehicle deviates beyond a configurable threshold from the planned route |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TRIP-MANAGEMENT-SERVICE (Spring Boot 3.3 + Kotlin)       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ PostgreSQL   │ │ MongoDB      │ │ Redis        │ │ Kafka      │ │  │
│  │  │ Event Store  │ │ (POD Docs,  │ │ Route Cache  │ │ Producer   │ │  │
│  │  │ + Read Model │ │  Load Docs)  │ │ Adapter      │ │ Adapter    │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │  │
│  │  │ Google Maps  │ │ Fleet Mgmt   │ │ Driver Mgmt  │              │  │
│  │  │ / Mapbox     │ │ gRPC Client  │ │ gRPC Client  │              │  │
│  │  │ API Client   │ │              │ │              │              │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ REST Controllers │  │ gRPC Server      │  │ Event Listeners  │   │  │
│  │  │ (TripCtrl,       │  │ (TripMgmtGrpcSvc)│  │ (Kafka Consumer) │   │  │
│  │  │  RouteCtrl,      │  │                   │  │                   │   │  │
│  │  │  DispatchCtrl,   │  │                   │  │                   │   │  │
│  │  │  PODCtrl)        │  │                   │  │                   │   │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘   │  │
│  │           │                     │                      │             │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴─────────┐   │  │
│  │  │ DTOs / Trip Mappers / Route Mappers / ETA Calculators       │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ CreateTrip       │ │ OptimizeRoute    │ │ DispatchTrip     │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ StartTrip        │ │ CompleteTrip    │ │ RecordPOD       │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ CancelTrip       │ │ RecalculateETA  │ │ DetectRoute      │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ DeviationUseCase │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                          │  │
│  │  │ GetTripDashboard │ │ ReplanTrip       │                          │  │
│  │  │ UseCase          │ │ UseCase          │                          │  │
│  │  └──────────────────┘ └──────────────────┘                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ Trip         │ │ Route        │ │ Stop         │ │ POD        │ │  │
│  │  │ (Event-     │ │ (Aggregate)  │ │ (Entity)     │ │ (Entity)   │ │  │
│  │  │  Sourced AR) │ │              │ │              │ │            │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                   │  │
│  │  │ Load         │ │ Waypoint     │                                   │  │
│  │  │ (Entity)     │ │ (Value Obj)  │                                   │  │
│  │  └──────────────┘ └──────────────┘                                   │  │
│  │  Domain Services: RouteOptimizationService, ETACalculationService    │  │
│  │  Domain Events: TripCreated, TripDispatched, TripStarted, etc.      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design -- Event Sourced Trip

### 3.1 Architecture Decision: Event Sourcing for Trip

The Trip aggregate is event-sourced because:
1. **Regulatory compliance**: FMCSA requires auditable records of trip execution, driver assignments, rest stops, and delivery confirmations.
2. **Dispute resolution**: Shippers, drivers, and customers may dispute delivery times, routes taken, or load conditions.
3. **Analytics**: Full trip event history feeds route optimization ML models and operational dashboards.
4. **Billing**: Trip completion events trigger cost calculations and customer invoicing.

### 3.2 Trip Event-Sourced Aggregate

**AggregateId:** `TripId` (UUID)
**Event Store:** PostgreSQL with `trip_events` table (append-only)

```kotlin
data class TripId(val value: UUID)

enum class TripStatus {
    PLANNED, DISPATCHED, IN_PROGRESS, ARRIVED_AT_PICKUP, LOADING,
    EN_ROUTE, AT_STOP, DEPARTED_STOP, ARRIVED_AT_DESTINATION, UNLOADING,
    COMPLETED, CANCELLED, FAILED
}

enum class TripType { STANDARD, MULTI_STOP, DEDICATED, SPOT, RETURN, DEADHEAD }

data class Trip(
    val id: TripId,
    val tenantId: UUID,
    val type: TripType,
    val status: TripStatus,
    // Participants
    val vehicleId: UUID?,
    val driverId: UUID?,
    val fleetId: UUID?,
    // Route
    val origin: Location,
    val destination: Location,
    val stops: List<Stop>,
    // Timing
    val plannedDepartureTime: Instant?,
    val plannedArrivalTime: Instant?,
    val actualDepartureTime: Instant?,
    val actualArrivalTime: Instant?,
    // Distance & Duration
    val plannedDistanceKm: Double,
    val plannedDurationMinutes: Long,
    val actualDistanceKm: Double,
    val actualDurationMinutes: Long,
    // Load
    val load: Load?,
    // POD
    val proofOfDelivery: ProofOfDelivery?,
    // Cost
    val estimatedCostCents: Long,
    val actualCostCents: Long,
    // Metadata
    val routeDeviationCount: Int,
    val notes: String,
    val metadata: Map<String, String>,
    // Event sourcing
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    companion object {
        fun create(
            tenantId: UUID,
            type: TripType,
            origin: Location,
            destination: Location,
            stops: List<Stop>,
            plannedDistanceKm: Double,
            plannedDurationMinutes: Long,
            notes: String
        ): Pair<Trip, TripCreatedEvent> {
            require(origin != destination) { "Origin and destination must be different" }
            val now = Instant.now()
            val trip = Trip(
                id = TripId(UUID.randomUUID()),
                tenantId = tenantId,
                type = type,
                status = TripStatus.PLANNED,
                vehicleId = null,
                driverId = null,
                fleetId = null,
                origin = origin,
                destination = destination,
                stops = stops,
                plannedDepartureTime = null,
                plannedArrivalTime = null,
                actualDepartureTime = null,
                actualArrivalTime = null,
                plannedDistanceKm = plannedDistanceKm,
                plannedDurationMinutes = plannedDurationMinutes,
                actualDistanceKm = 0.0,
                actualDurationMinutes = 0,
                load = null,
                proofOfDelivery = null,
                estimatedCostCents = 0,
                actualCostCents = 0,
                routeDeviationCount = 0,
                notes = notes,
                metadata = emptyMap(),
                version = 1,
                createdAt = now,
                updatedAt = now
            )
            val event = TripCreatedEvent(
                tripId = trip.id.value,
                tenantId = tenantId,
                type = type.name,
                origin = origin,
                destination = destination,
                plannedDistanceKm = plannedDistanceKm,
                plannedDurationMinutes = plannedDurationMinutes,
                timestamp = now
            )
            return trip to event
        }
    }

    // --- Event Application (State Reconstruction) ---

    fun apply(event: TripDispatchedEvent): Trip = copy(
        vehicleId = event.vehicleId,
        driverId = event.driverId,
        fleetId = event.fleetId,
        plannedDepartureTime = event.plannedDepartureTime,
        plannedArrivalTime = event.plannedArrivalTime,
        estimatedCostCents = event.estimatedCostCents,
        status = TripStatus.DISPATCHED,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: TripStartedEvent): Trip = copy(
        actualDepartureTime = event.departureTime,
        status = if (type == TripType.MULTI_STOP) TripStatus.EN_ROUTE else TripStatus.IN_PROGRESS,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: ArrivedAtPickupEvent): Trip = copy(
        status = TripStatus.ARRIVED_AT_PICKUP,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: LoadingCompletedEvent): Trip = copy(
        load = event.load,
        status = TripStatus.EN_ROUTE,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: ArrivedAtStopEvent): Trip = copy(
        status = TripStatus.AT_STOP,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: DepartedStopEvent): Trip = copy(
        status = TripStatus.DEPARTED_STOP,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: ArrivedAtDestinationEvent): Trip = copy(
        status = TripStatus.ARRIVED_AT_DESTINATION,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: TripCompletedEvent): Trip = copy(
        status = TripStatus.COMPLETED,
        actualArrivalTime = event.arrivalTime,
        actualDistanceKm = event.actualDistanceKm,
        actualDurationMinutes = event.actualDurationMinutes,
        actualCostCents = event.actualCostCents,
        proofOfDelivery = event.proofOfDelivery,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: TripCancelledEvent): Trip = copy(
        status = TripStatus.CANCELLED,
        cancelReason = event.reason,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: TripFailedEvent): Trip = copy(
        status = TripStatus.FAILED,
        failReason = event.reason,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: RouteDeviationDetectedEvent): Trip = copy(
        routeDeviationCount = routeDeviationCount + 1,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: TripReplannedEvent): Trip = copy(
        stops = event.newStops,
        plannedDistanceKm = event.newDistanceKm,
        plannedDurationMinutes = event.newDurationMinutes,
        plannedArrivalTime = event.newEstimatedArrival,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: ETACalculatedEvent): Trip = copy(
        plannedArrivalTime = event.estimatedArrival,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: LoadAssignedEvent): Trip = copy(
        load = event.load,
        version = version + 1,
        updatedAt = Instant.now()
    )

    fun apply(event: PODRecordedEvent): Trip = copy(
        proofOfDelivery = event.proofOfDelivery,
        version = version + 1,
        updatedAt = Instant.now()
    )

    // --- Invariants ---
    // INV-01: version is monotonically increasing (enforced by event store)
    // INV-02: Status transitions follow valid state machine
    // INV-03: vehicleId and driverId must be set before DISPATCHED status
    // INV-04: origin and destination must be different locations
    // INV-05: actualDistanceKm must be >= 0
    // INV-06: Cannot add stops when trip is IN_PROGRESS or later
    // INV-07: POD required before COMPLETED for delivery trips
}
```

### 3.3 Trip State Machine

```
                    ┌───────────┐
                    │  PLANNED  │
                    └─────┬─────┘
                          │ dispatch()
                    ┌─────┴─────────┐
                    ▼               ▼
             ┌───────────┐  ┌───────────┐
             │DISPATCHED │  │ CANCELLED │
             └─────┬─────┘  └───────────┘
                   │ start()
             ┌─────┴──────┐
             ▼            ▼
     ┌──────────────┐ ┌───────────┐
     │ARRIVED_AT    │ │IN_PROGRESS│ (single destination)
     │PICKUP        │ └─────┬─────┘
     └─────┬────────┘       │
           │ load()          │ arriveAtDest()
     ┌─────┴──────┐   ┌─────┴──────────┐
     ▼            ▼   ▼                ▼
┌──────────┐ ┌─────────┐ ┌───────────────┐
│EN_ROUTE  │ │FAILED   │ │ARRIVED_AT     │
│(multi)    │ └─────────┘ │DESTINATION   │
└────┬─────┘              └─────┬─────────┘
     │ arriveAtStop()            │ recordPOD()
┌────┴─────┐              ┌─────┴─────────┐
│AT_STOP   │              │ UNLOADING      │
└────┬─────┘              └─────┬─────────┘
     │ departStop()              │ unload()
┌────┴─────┐              ┌─────┴─────────┐
│DEPARTED  │──────────────│ COMPLETED      │
│_STOP     │ (final stop) │ (with POD)     │
└──────────┘              └───────────────┘
```

### 3.4 Supporting Entities

```kotlin
data class Location(
    val address: String,
    val latitude: Double,
    val longitude: Double,
    val name: String? = null,
    val contactName: String? = null,
    val contactPhone: String? = null,
    val notes: String? = null
) {
    // INV-01: latitude in [-90, 90], longitude in [-180, 180]
}

data class Stop(
    val id: UUID,
    val sequence: Int,               // order in the route
    val location: Location,
    val type: StopType,
    val plannedArrivalTime: Instant?,
    val actualArrivalTime: Instant?,
    val plannedDepartureTime: Instant?,
    val actualDepartureTime: Instant?,
    val status: StopStatus,
    val loadAction: LoadAction?,     // pickup or dropoff
    val notes: String?
)

enum class StopType { PICKUP, DELIVERY, REST, FUEL, WAYPOINT }

enum class StopStatus { PENDING, ARRIVED, IN_PROGRESS, COMPLETED, SKIPPED }

enum class LoadAction { PICKUP, DROPOFF }

data class Load(
    val id: UUID,
    val description: String,
    val weightKg: Double,
    val volumeCubicM: Double?,
    val hazardous: Boolean,
    val temperatureControlled: Boolean,
    val requiredTemperatureCelsius: Double?,
    val numberOfPieces: Int,
    val commodityCode: String?,
    val customerReference: String?
)

data class ProofOfDelivery(
    val recordedAt: Instant,
    val recordedBy: UUID,           // driver or operator ID
    val recipientName: String,
    val recipientSignatureBase64: String?,
    val photos: List<PODPhoto>,
    val notes: String,
    val condition: DeliveryCondition
)

data class PODPhoto(
    val photoId: UUID,
    val storageUrl: String,          // S3/MinIO URL
    val takenAt: Instant,
    val description: String?
)

enum class DeliveryCondition { PERFECT, GOOD, ACCEPTABLE, DAMAGED, REFUSED }
```

### 3.5 Route Aggregate

```kotlin
data class RouteId(val value: UUID)

data class Route(
    val id: RouteId,
    val tenantId: UUID,
    val name: String,
    val description: String,
    val waypoints: List<Waypoint>,
    val totalDistanceKm: Double,
    val estimatedDurationMinutes: Long,
    val isOptimized: Boolean,
    val optimizationProvider: String?,    // "google_maps", "mapbox", "internal"
    val createdBy: UUID,
    val status: RouteStatus,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun optimize(newWaypoints: List<Waypoint>, distance: Double, duration: Long, provider: String): Route =
        copy(
            waypoints = newWaypoints,
            totalDistanceKm = distance,
            estimatedDurationMinutes = duration,
            isOptimized = true,
            optimizationProvider = provider,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(RouteOptimizedEvent(it, distance, duration)) }

    // INV-01: waypoints must have at least 2 points (origin + destination)
    // INV-02: waypoint sequence must be sequential
}

data class Waypoint(
    val sequence: Int,
    val location: Location,
    val expectedArrivalOffsetMinutes: Long,   // minutes from route start
    val stayDurationMinutes: Long
)

enum class RouteStatus { DRAFT, OPTIMIZED, PUBLISHED, ARCHIVED }
```

### 3.6 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `trip.trip.created.v1` | New trip planned | tripId, tenantId, type, origin, destination, plannedDistanceKm |
| `trip.trip.dispatched.v1` | Trip dispatched to driver/vehicle | tripId, tenantId, vehicleId, driverId, plannedDepartureTime |
| `trip.trip.started.v1` | Trip execution started | tripId, tenantId, departureTime |
| `trip.arrived.pickup.v1` | Arrived at pickup location | tripId, tenantId, location |
| `trip.loading.completed.v1` | Loading finished | tripId, tenantId, load |
| `trip.arrived.stop.v1` | Arrived at intermediate stop | tripId, tenantId, stopId, location |
| `trip.departed.stop.v1` | Departed from stop | tripId, tenantId, stopId |
| `trip.arrived.destination.v1` | Arrived at final destination | tripId, tenantId, location |
| `trip.trip.completed.v1` | Trip completed with POD | tripId, tenantId, actualDistanceKm, actualDurationMinutes, actualCostCents |
| `trip.trip.cancelled.v1` | Trip cancelled | tripId, tenantId, reason |
| `trip.trip.failed.v1` | Trip failed | tripId, tenantId, reason |
| `trip.pod.recorded.v1` | Proof of delivery captured | tripId, tenantId, recipientName, condition |
| `trip.route.deviation.detected.v1` | Vehicle deviated from route | tripId, tenantId, vehicleId, deviationDistanceKm |
| `trip.route.replanned.v1` | Trip route replanned | tripId, tenantId, newStops, newDistanceKm |
| `trip.eta.calculated.v1` | ETA updated | tripId, tenantId, estimatedArrivalTime |
| `trip.load.assigned.v1` | Load assigned to trip | tripId, tenantId, loadId, weightKg |
| `trip.route.optimized.v1` | Route optimized | routeId, tenantId, distanceKm, durationMinutes |

### 3.7 Event Store Schema

```sql
CREATE TABLE trip_events (
    event_id          UUID PRIMARY KEY,
    aggregate_id      UUID NOT NULL,
    event_type        VARCHAR(255) NOT NULL,
    event_data        JSONB NOT NULL,
    tenant_id         UUID NOT NULL,
    vehicle_id        UUID,
    driver_id         UUID,
    timestamp         TIMESTAMPTZ NOT NULL,
    aggregate_version BIGINT NOT NULL,
    metadata          JSONB DEFAULT '{}'
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_trip_events_aggregate ON trip_events (aggregate_id, aggregate_version);
CREATE INDEX idx_trip_events_vehicle ON trip_events (vehicle_id, timestamp);
CREATE INDEX idx_trip_events_driver ON trip_events (driver_id, timestamp);
CREATE INDEX idx_trip_events_tenant_status ON trip_events (tenant_id, event_type);

-- Read model projection
CREATE TABLE trip_read_model (
    trip_id              UUID PRIMARY KEY,
    tenant_id            UUID NOT NULL,
    type                 VARCHAR(50) NOT NULL,
    status               VARCHAR(50) NOT NULL,
    vehicle_id           UUID,
    driver_id            UUID,
    fleet_id             UUID,
    origin_address       TEXT NOT NULL,
    destination_address  TEXT NOT NULL,
    planned_departure    TIMESTAMPTZ,
    planned_arrival      TIMESTAMPTZ,
    actual_departure     TIMESTAMPTZ,
    actual_arrival       TIMESTAMPTZ,
    planned_distance_km  DOUBLE PRECISION,
    actual_distance_km   DOUBLE PRECISION,
    estimated_cost_cents BIGINT DEFAULT 0,
    has_pod              BOOLEAN DEFAULT FALSE,
    pod_recipient_name   VARCHAR(255),
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    aggregate_version    BIGINT NOT NULL
);
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.trip.domain.port.out

import com.fleetvision.trip.domain.model.*
import java.time.Instant
import java.util.UUID

/**
 * Event Store interface for Trip event sourcing.
 */
interface TripEventStore {
    fun append(events: List<DomainEvent>, expectedVersion: Long)
    fun loadEvents(tripId: UUID): List<DomainEvent>
    fun loadEventsByVehicle(vehicleId: UUID, from: Instant?, to: Instant?): List<DomainEvent>
    fun loadEventsByDriver(driverId: UUID, from: Instant?, to: Instant?): List<DomainEvent>
}

/**
 * Read-model repository for Trip queries.
 */
interface TripReadRepository {
    fun save(trip: TripReadModel): TripReadModel
    fun findById(tripId: UUID, tenantId: UUID): TripReadModel?
    fun findByVehicleId(vehicleId: UUID, tenantId: UUID, page: Int, size: Int): List<TripReadModel>
    fun findByDriverId(driverId: UUID, tenantId: UUID, page: Int, size: Int): List<TripReadModel>
    fun findByStatus(status: TripStatus, tenantId: UUID, page: Int, size: Int): List<TripReadModel>
    fun findActiveTrips(tenantId: UUID): List<TripReadModel>
    fun findTripsByDateRange(from: LocalDate, to: LocalDate, tenantId: UUID, page: Int, size: Int): List<TripReadModel>
    fun findTripsWithoutPOD(since: Instant, tenantId: UUID): List<TripReadModel>
    fun countByStatus(tenantId: UUID): Map<TripStatus, Long>
    fun search(query: String, tenantId: UUID, page: Int, size: Int): List<TripReadModel>
}

interface RouteRepository {
    fun save(route: Route): Route
    fun findById(routeId: UUID, tenantId: UUID): Route?
    fun findByTenant(tenantId: UUID, page: Int, size: Int): List<Route>
    fun findByName(name: String, tenantId: UUID): Route?
    fun delete(routeId: UUID, tenantId: UUID)
}

interface PODDocumentRepository {
    /** MongoDB-based POD document storage */
    fun savePOD(tripId: UUID, pod: ProofOfDelivery)
    fun getPOD(tripId: UUID): ProofOfDelivery?
    fun findRecentPODs(tenantId: UUID, limit: Int): List<ProofOfDelivery>
}

interface EventPublisher {
    fun publish(event: DomainEvent)
}

interface RouteOptimizationClient {
    /** Google Maps / Mapbox API for route optimization */
    fun optimizeRoute(
        origin: Location,
        destination: Location,
        stops: List<Location>,
        preferences: RoutePreferences
    ): RouteOptimizationResult
    fun calculateETA(
        origin: Location,
        destination: Location,
        currentLocation: Location,
        trafficConditions: Boolean
    ): Instant
    fun calculateDistance(origin: Location, destination: Location): Double
}

data class RoutePreferences(
    val avoidTolls: Boolean = false,
    val avoidHighways: Boolean = false,
    val optimizeFor: OptimizeFor = OptimizeFor.FASTEST
)

enum class OptimizeFor { FASTEST, SHORTEST, FUEL_EFFICIENT }

data class RouteOptimizationResult(
    val optimizedWaypoints: List<Location>,
    val totalDistanceKm: Double,
    val estimatedDurationMinutes: Long,
    val provider: String
)

interface FleetManagementClient {
    fun getVehicle(vehicleId: UUID, tenantId: UUID): VehicleInfo?
}

interface DriverManagementClient {
    fun checkDriverEligibility(driverId: UUID, tenantId: UUID): EligibilityResult
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/trips`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/trips` | List trips (paginated, filterable) | `trip.trip.read` |
| `GET` | `/trips/{tripId}` | Get trip detail with full event history | `trip.trip.read` |
| `POST` | `/trips` | Create a new trip (PLANNED) | `trip.trip.create` |
| `PUT` | `/trips/{tripId}` | Update trip metadata (PLANNED only) | `trip.trip.update` |
| `POST` | `/trips/{tripId}/dispatch` | Dispatch trip to vehicle/driver | `trip.trip.dispatch` |
| `POST` | `/trips/{tripId}/start` | Start trip execution | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/arrive-pickup` | Record arrival at pickup | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/complete-loading` | Record loading completion | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/arrive-stop/{stopId}` | Record arrival at stop | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/depart-stop/{stopId}` | Record departure from stop | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/arrive-destination` | Record arrival at destination | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/pod` | Record proof of delivery | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/complete` | Complete trip | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/cancel` | Cancel trip | `trip.trip.cancel` |
| `POST` | `/trips/{tripId}/replan` | Replan trip route | `trip.trip.execute` |
| `POST` | `/trips/{tripId}/eta` | Recalculate ETA | `trip.trip.read` |
| `GET` | `/trips/{tripId}/history` | Get event history for trip | `trip.trip.read` |
| `GET` | `/trips/active` | List all active trips | `trip.trip.read` |
| `GET` | `/trips/missing-pod` | List completed trips without POD | `trip.trip.read` |
| `GET` | `/trips/dashboard` | Trip management dashboard | `trip.dashboard.read` |
| `GET` | `/routes` | List routes | `trip.route.read` |
| `POST` | `/routes` | Create a route | `trip.route.create` |
| `POST` | `/routes/{routeId}/optimize` | Optimize route | `trip.route.optimize` |
| `POST` | `/loads` | Create a load | `trip.load.create` |
| `POST` | `/trips/{tripId}/load` | Assign load to trip | `trip.load.assign` |

### 5.2 gRPC Service

```protobuf
service TripManagementService {
  rpc GetTrip (GetTripRequest) returns (TripResponse);
  rpc GetActiveTripsForVehicle (GetActiveTripsForVehicleRequest) returns (GetTripsResponse);
  rpc GetActiveTripsForDriver (GetActiveTripsForDriverRequest) returns (GetTripsResponse);
  rpc CheckVehicleTripConflict (CheckVehicleTripConflictRequest) returns (CheckVehicleTripConflictResponse);
}

message GetTripRequest {
  string trip_id = 1;
  string tenant_id = 2;
}

message TripResponse {
  string id = 1;
  string tenant_id = 2;
  string type = 3;
  string status = 4;
  optional string vehicle_id = 5;
  optional string driver_id = 6;
  string origin_address = 7;
  string destination_address = 8;
  double planned_distance_km = 9;
  double actual_distance_km = 10;
  optional string planned_departure = 11;
  optional string planned_arrival = 12;
  bool has_pod = 13;
  string pod_recipient_name = 14;
}

message GetActiveTripsForVehicleRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
}

message GetActiveTripsForDriverRequest {
  string driver_id = 1;
  string tenant_id = 2;
}

message GetTripsResponse {
  repeated TripResponse trips = 1;
}

message CheckVehicleTripConflictRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
  string proposed_start = 3;
  string proposed_end = 4;
  string exclude_trip_id = 5;
}

message CheckVehicleTripConflictResponse {
  bool has_conflict = 1;
  repeated TripResponse conflicting_trips = 2;
}
```

### 5.3 Sample REST Request/Response

```
POST /api/v1/trips
Content-Type: application/json

{
  "type": "MULTI_STOP",
  "origin": {
    "address": "123 Warehouse Blvd, Newark, NJ 07102",
    "latitude": 40.7357,
    "longitude": -74.1724,
    "name": "Distribution Center A"
  },
  "destination": {
    "address": "456 Market St, Philadelphia, PA 19102",
    "latitude": 39.9526,
    "longitude": -75.1652,
    "name": "Customer Site B"
  },
  "stops": [
    {
      "sequence": 1,
      "location": {
        "address": "789 Commerce Dr, Trenton, NJ 08608",
        "latitude": 40.2171,
        "longitude": -74.7429,
        "name": "Drop-off Point C"
      },
      "type": "DELIVERY",
      "loadAction": "DROPOFF"
    }
  ],
  "notes": "Priority delivery, fragile cargo"
}

Response 201:
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "MULTI_STOP",
    "status": "PLANNED",
    "origin": { ... },
    "destination": { ... },
    "stops": [ ... ],
    "planned_distance_km": 145.2,
    "planned_duration_minutes": 185,
    "created_at": "2026-08-02T14:30:00.000Z"
  }
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.trip.events` | `tripId` | 7 days | trip-management-service |
| `fleetvision.trip.route.events` | `routeId` | 7 days | trip-management-service |
| `fleetvision.trip.load.events` | `loadId` | 7 days | trip-management-service |

### 6.2 Published Events (Producer)

```json
// trip.trip.dispatched.v1
{
  "specversion": "1.0",
  "type": "trip.trip.dispatched.v1",
  "source": "/trip-management-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "data": {
    "trip_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "vehicle_id": "660e8400-e29b-41d4-a716-446655440001",
    "driver_id": "770e8400-e29b-41d4-a716-446655440003",
    "fleet_id": "880e8400-e29b-41d4-a716-446655440004",
    "planned_departure_time": "2026-08-03T06:00:00.000Z",
    "planned_arrival_time": "2026-08-03T09:05:00.000Z",
    "estimated_cost_cents": 35000
  },
  "fleetvision": { ... }
}

// trip.trip.completed.v1
{
  "specversion": "1.0",
  "type": "trip.trip.completed.v1",
  "source": "/trip-management-service",
  "id": "uuid-v4",
  "time": "2026-08-03T09:30:00.000Z",
  "data": {
    "trip_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "actual_distance_km": 148.7,
    "actual_duration_minutes": 210,
    "actual_cost_cents": 38500,
    "proof_of_delivery": {
      "recipient_name": "Jane Doe",
      "condition": "PERFECT",
      "recorded_at": "2026-08-03T09:25:00.000Z"
    }
  },
  "fleetvision": { ... }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.tracking.position.events` | `tracking.position.received.v1` | Evaluate route deviation, recalculate ETA |
| `fleetvision.tracking.geofence.events` | `tracking.geofence.entered.v1` | Detect arrival at stop/destination geofence |
| `fleetvision.fleet.vehicle.events` | `fleet.vehicle.maintenance.started.v1` | Cancel active trips for vehicle entering maintenance |
| `fleetvision.driver.profile.events` | `driver.profile.suspended.v1` | Cancel active trips for suspended driver |
| `fleetvision.driver.license.events` | `driver.license.expired.v1` | Flag trips for re-dispatch |
| `fleetvision.billing.tenant.events` | `billing.tenant.suspended.v1` | Suspend new trip creation |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| Fleet Management | gRPC (outbound) | Vehicle info, vehicle availability check |
| Driver Management | gRPC (outbound) | Driver eligibility check, driver info |
| Tracking & Monitoring | Kafka (inbound) | Position events for deviation detection, ETA recalculation |
| Compliance & Safety | Kafka (outbound) | Trip started/completed for HOS tracking |
| Notification Service | Kafka (outbound) | Trip status alerts, ETA updates, POD notifications |
| Analytics Engine | Kafka (outbound) | All trip events for dashboards and route analytics |
| Audit Log Service | Kafka (outbound) | All trip lifecycle audit trails |
| Billing & Tenant Mgmt | Kafka (outbound) | Trip completed events for cost allocation and invoicing |
| Identity & Access Mgmt | gRPC (outbound) | Permission checks |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **Google Maps / Mapbox** | REST/gRPC | Outbound | Route optimization, ETA calculation, distance matrix |
| **Weather API** | REST API | Outbound | Route weather enrichment (via stream processor) |
| **S3/MinIO** | S3 API | Outbound | POD photo storage |

### 7.3 Data Flow

```
Trip Created (PLANNED)
    │
    ▼
Trip Dispatched → assigns vehicle + driver
    │ publishes: trip.dispatched → Tracking, Compliance, Driver Mgmt
    ▼
Trip Started → vehicle departs origin
    │ publishes: trip.started → Compliance (HOS clock)
    ▼
En Route → position events from Tracking
    │ evaluates: route deviation, ETA recalculation
    ▼
At Stop / At Destination → geofence detection from Tracking
    │
    ▼
POD Recorded → signature + photos captured
    │ stores: POD in MongoDB, photos in S3
    ▼
Trip Completed → distance, duration, cost finalized
    │ publishes: trip.completed → Billing, Analytics, Notification
    ▼
Trip Closed
```

---

## 8. Configuration Properties

```yaml
# application-trip.yaml
fleetvision:
  trip:
    service-name: trip-management-service

    trip:
      auto-cancel-planned-days: 7
      max-stops-per-trip: 50
      max-trips-per-vehicle-concurrent: 1
      max-trips-per-driver-concurrent: 1
      pod-required: true               // require POD for delivery trips
      pod-photo-max-size-mb: 10
      pod-photo-max-count: 10

    route:
      optimization:
        enabled: true
        provider: google_maps          // google_maps or mapbox
        google-maps-api-key: ${GOOGLE_MAPS_API_KEY}
        mapbox-api-key: ${MAPBOX_API_KEY}
        max-waypoints: 25
        timeout: 10s
      deviation-threshold-meters: 500  // alert if vehicle is this far off route
      deviation-alert-interval-min: 5  // min between deviation alerts

    eta:
      calculation-interval-seconds: 60
      traffic-aware: true
      buffer-minutes: 15               // add buffer to ETA for display

    cost:
      default-cost-per-km-cents: 150
      default-driver-rate-cents-per-hour: 2200
      currency: USD

  database:
    jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_trip
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    pool:
      maximum-pool-size: 25
      minimum-idle: 5
    migration:
      locations: classpath:db/migration/trip

  mongodb:
    uri: mongodb://${MONGO_HOST}:27017/fleetvision_trip
    database: fleetvision_trip
    collections:
      pod-documents: trip_pod_documents
      load-documents: trip_load_documents

  redis:
    host: ${REDIS_HOST}
    port: 6379
    password: ${REDIS_PASSWORD}
    database-index: 5
    ttl:
      trip-detail: 300
      active-trips: 60
      route-cache: 3600

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: trip-mgmt-producer
      acks: all
      retries: 3
      compression-type: lz4
    consumer:
      group-id: trip-mgmt-consumer
      auto-offset-reset: earliest
      enable-auto-commit: false
    topics:
      trip-events: fleetvision.trip.events
      route-events: fleetvision.trip.route.events
      load-events: fleetvision.trip.load.events
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| PostgreSQL (event store) | 5 failures in 30s | 30s | 3 | Buffer events in Redis |
| Fleet Mgmt gRPC | 10 failures in 30s | 10s | 5 | Deny dispatch if vehicle not validated |
| Driver Mgmt gRPC | 10 failures in 30s | 10s | 5 | Deny dispatch if driver not validated |
| Google Maps API | 5 failures in 60s | 120s | 3 | Skip optimization, use straight-line distance |
| Mapbox API | 5 failures in 60s | 120s | 3 | Skip optimization, use straight-line distance |
| MongoDB (POD) | 3 failures in 30s | 30s | 3 | Buffer POD in PostgreSQL |
| IAM gRPC | 10 failures in 30s | 10s | 5 | Deny operation |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| Event store append | 5 | Exponential (50ms base, 2x) | Full jitter |
| Fleet Mgmt gRPC call | 2 | Fixed 200ms | +/- 50ms |
| Driver Mgmt gRPC call | 2 | Fixed 200ms | +/- 50ms |
| Google Maps API | 3 | Exponential (500ms, 1s, 2s) | +/- 20% |
| Mapbox API | 3 | Exponential (500ms, 1s, 2s) | +/- 20% |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |
| Database write (read model) | 3 | Exponential (50ms, 100ms, 200ms) | +/- 25% |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| gRPC requests | 3s | 5s | 8s |
| Event store write | 1s | 2s | 3s |
| Google Maps API | 5s | 10s | 15s |
| Mapbox API | 5s | 10s | 15s |
| MongoDB operations | 2s | 5s | 7s |
| Kafka produce | 5s | — | 30s |

### 9.4 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Trip creation | 100/min per tenant | 200 | Token bucket |
| Trip dispatch | 50/min per tenant | 100 | Token bucket |
| Route optimization | 20/min per tenant | 40 | Token bucket |
| POD recording | 100/min per tenant | 200 | Token bucket |
| Trip search | 200/min per user | 400 | Sliding window |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | Trip state machine, event sourcing, route logic, ETA | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | Event store, Kafka, PostgreSQL, MongoDB, Redis | Testcontainers (PG, Mongo, Kafka, Redis) | 80% |
| **Contract Tests** | REST/gRPC API contracts | Spring Cloud Contract | 100% |
| **Component Tests** | Full trip lifecycle with testcontainers | SpringBootTest | Critical paths |
| **End-to-End Tests** | Multi-service (dispatch -> start -> stop -> complete -> POD) | Testcontainers Compose | Critical paths |

### 10.2 Domain Test Scenarios

**Trip (Event Sourcing):**
- Create trip in PLANNED status with valid origin/destination
- Create trip with same origin and destination fails
- Dispatch PLANNED trip with vehicle+driver transitions to DISPATCHED
- Dispatch without vehicle fails
- Start DISPATCHED trip transitions to IN_PROGRESS/EN_ROUTE
- Arrive at stop, depart stop sequence works for multi-stop
- Record POD at destination
- Complete trip with POD, actual distance, duration
- Cancel PLANNED trip succeeds
- Cancel IN_PROGRESS trip fails (use fail instead)
- Version conflict on concurrent append fails
- Route deviation increments deviation counter
- Replan updates stops and recalculates distance

**Route:**
- Optimize route with valid waypoints succeeds
- Optimize with < 2 waypoints fails
- Distance calculation returns reasonable value

### 10.3 Integration Test Scenarios
- Trip creation persists events to event store and updates read model
- Trip dispatch publishes Kafka events consumed by Tracking and Driver Mgmt
- Position events trigger ETA recalculation
- Geofence events trigger arrival detection
- POD stored in MongoDB with photo references in S3

### 10.4 Contract Test Scenarios
- `POST /trips` returns 201 with PLANNED status
- `POST /trips/{id}/dispatch` on non-PLANNED trip returns 409
- `POST /trips/{id}/complete` without POD returns 400 for delivery trips
- `CheckVehicleTripConflict` gRPC returns correct conflict status

### 10.5 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| Trip creation throughput | 100 TPS sustained | Gatling |
| Trip read (by ID) latency | < 50ms p99 | k6 |
| Event replay (10K events) | < 3 seconds total | JUnit benchmark |
| Route optimization latency | < 5s p99 | k6 (mocked Maps API) |
| Active trips dashboard query | < 2s p99 for 10K active trips | k6 |

---

## Appendix A: Package Structure

```
com.fleetvision.trip/
├── domain/
│   ├── model/
│   │   ├── Trip.kt
│   │   ├── Route.kt
│   │   ├── Stop.kt
│   │   ├── Load.kt
│   │   ├── ProofOfDelivery.kt
│   │   └── valueobjects/
│   │       ├── TripId.kt
│   │       ├── RouteId.kt
│   │       ├── Location.kt
│   │       └── Waypoint.kt
│   ├── event/
│   │   ├── TripCreatedEvent.kt
│   │   ├── TripDispatchedEvent.kt
│   │   ├── TripStartedEvent.kt
│   │   ├── ArrivedAtStopEvent.kt
│   │   ├── TripCompletedEvent.kt
│   │   ├── PODRecordedEvent.kt
│   │   ├── RouteDeviationDetectedEvent.kt
│   │   └── ...
│   ├── service/
│   │   ├── RouteOptimizationService.kt
│   │   └── ETACalculationService.kt
│   └── port/
│       └── out/
│           ├── TripEventStore.kt
│           ├── TripReadRepository.kt
│           ├── RouteRepository.kt
│           ├── PODDocumentRepository.kt
│           ├── EventPublisher.kt
│           ├── RouteOptimizationClient.kt
│           ├── FleetManagementClient.kt
│           └── DriverManagementClient.kt
├── application/
│   ├── usecase/
│   │   ├── CreateTripUseCase.kt
│   │   ├── DispatchTripUseCase.kt
│   │   ├── StartTripUseCase.kt
│   │   ├── ArriveAtStopUseCase.kt
│   │   ├── CompleteTripUseCase.kt
│   │   ├── RecordPODUseCase.kt
│   │   ├── CancelTripUseCase.kt
│   │   ├── OptimizeRouteUseCase.kt
│   │   ├── RecalculateETAUseCase.kt
│   │   ├── DetectRouteDeviationUseCase.kt
│   │   ├── ReplanTripUseCase.kt
│   │   └── GetTripDashboardUseCase.kt
│   └── dto/
│       ├── TripRequest.kt
│       ├── TripResponse.kt
│       ├── RouteRequest.kt
│       ├── PODRequest.kt
│       └── LoadRequest.kt
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── TripController.kt
│   │   │   ├── RouteController.kt
│   │   │   ├── DispatchController.kt
│   │   │   └── PODController.kt
│   │   ├── grpc/
│   │   │   └── TripManagementGrpcService.kt
│   │   └── event/
│   │       ├── TrackingEventConsumer.kt
│   │       └── FleetEventConsumer.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── eventsourcing/
│       │   │   ├── TripEventStoreAdapter.kt
│       │   │   └── TripProjection.kt
│       │   ├── jpa/
│       │   │   ├── TripReadJpaRepository.kt
│       │   │   └── RouteJpaRepository.kt
│       │   └── mongo/
│       │       └── PODDocumentMongoRepository.kt
│       ├── routing/
│       │   ├── GoogleMapsAdapter.kt
│       │   └── MapboxAdapter.kt
│       ├── fleet/
│       │   └── FleetManagementGrpcClient.kt
│       ├── driver/
│       │   └── DriverManagementGrpcClient.kt
│       └── kafka/
│           └── TripEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── EventSourcingConfig.kt
│   │   ├── ProjectionConfig.kt
│   │   ├── KafkaConfig.kt
│   │   ├── RoutingConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── InvalidTripStateException.kt
│       ├── TripNotFoundException.kt
│       ├── VehicleNotAvailableException.kt
│       ├── DriverNotEligibleException.kt
│       ├── RouteOptimizationException.kt
│       └── PODRequiredException.kt
└── TripManagementServiceApplication.kt
```
