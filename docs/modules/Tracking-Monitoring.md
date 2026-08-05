# Tracking & Monitoring Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Tracking & Monitoring
**Service:** `tracking-service`
**Data Store:** TimescaleDB (time-series), PostgreSQL 16 (event store, geofences), Redis (latest position cache)
**Messaging:** Kafka (domain events), WebSocket (real-time positions)
**Pattern:** CQRS + Event Sourcing (VehicleTracker aggregate)

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Design — Event Sourced VehicleTracker](#3-aggregate-root-design--event-sourced-vehicletracker)
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

The Tracking & Monitoring context is the real-time nerve center of FleetVision. It ingests high-volume GPS position events, maintains live vehicle state via event-sourced VehicleTracker aggregates, evaluates geofence rules, detects speed violations, and streams live positions to connected clients via WebSocket. This context is the highest-throughput service in the platform, designed for sub-second position freshness.

### 1.2 Context Map

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  TELEMETRY & DEVICE MGMT      │     │  FLEET MANAGEMENT              │
│  Produces: PositionEvents     │     │  Produces: Fleet/vehicle      │
│  (Kafka)                      │     │  events (Kafka)                │
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │ (PositionEvents)                   │
                ▼                                    │
┌───────────────────────────────┐     ┌───────────────┴───────────────┐
│  TRIP & ROUTE MGMT            │     │  TRACKING & MONITORING       │
│  Produces: TripStarted events │────►│  (This Context)               │
│  Consumes: Geofence alerts    │     │                               │
└───────────────┬───────────────┘     └───────┬───────────┬───────────┘
                │                             │           │
┌───────────────┴───────────────┐     ┌───────┴───┐ ┌───┴───────────┐
│  COMPLIANCE & SAFETY          │     │ NOTIFICA- │ │ ANALYTICS      │
│  Consumes: Speed alerts,      │     │ TION      │ │ ENGINE         │
│  HOS data                     │     │ SERVICE   │ │ (all events)   │
└───────────────────────────────┘     └───────────┘ └───────────────┘

External:
  • Web Clients (WebSocket) — Live position streaming
  • Mobile Apps (WebSocket) — Driver position broadcast
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **VehicleTracker** | The event-sourced aggregate representing the live tracking state of a single vehicle |
| **Position** | A geographic coordinate (lat, lng, altitude) with timestamp, speed, heading, and accuracy |
| **Geofence** | A virtual geographic boundary (polygon or circle) that triggers alerts on vehicle entry, exit, or dwell |
| **PositionEvent** | An immutable event representing a single GPS reading from a telematics device |
| **SpeedEvent** | A derived event emitted when a vehicle exceeds the configured speed threshold |
| **GeofenceEvent** | A domain event emitted when a vehicle enters, exits, or dwells within a geofence boundary |
| **TrackingSession** | A continuous period of position reporting for a vehicle (started by ignition-on, ended by ignition-off) |
| **DwellTime** | Duration a vehicle remains stationary within a geofence boundary before triggering an alert |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TRACKING-SERVICE (Spring Boot 3.3 + Kotlin)            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ TimescaleDB  │ │ PostgreSQL   │ │ Redis        │ │ Kafka     │ │  │
│  │  │ Adapter      │ │ Event Store  │ │ Latest Pos   │ │ Producer  │ │  │
│  │  │ (Time-series)│ │ Adapter      │ │ Cache        │ │ Adapter   │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │  │
│  │  │ WebSocket    │ │ Geofence     │ │ Kafka       │              │  │
│  │  │ Broadcaster  │ │ Evaluator    │ │ Consumer     │              │  │
│  │  │ (STOMP)      │ │ (PostGIS)    │ │ (PositionIn) │              │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ REST Controllers │  │ WebSocket Ctrl   │  │ Event Listeners  │   │  │
│  │  │ (TrackingCtrl,   │  │ (PositionStream  │  │ (Kafka Consumer) │   │  │
│  │  │  GeofenceCtrl,  │  │  Controller)     │  │                   │   │  │
│  │  │  AlertCtrl)     │  │                  │  │                   │   │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘   │  │
│  │           │                     │                      │             │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴─────────┐   │  │
│  │  │ DTOs / Position Mappers / Geofence DTOs / Alert DTOs        │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ ProcessPosition  │ │ CreateGeofence   │ │ EvaluateGeofence │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ GetVehicleTrack  │ │ DetectSpeed      │ │ ReplayTracker    │     │  │
│  │  │ UseCase          │ │ ViolationUseCase │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                          │  │
│  │  │ GetLatestPositions│ │ GetTrackingSession│                          │  │
│  │  │ UseCase          │ │ UseCase           │                          │  │
│  │  └──────────────────┘ └──────────────────┘                          │  │
│  │  Ports: IEventStore, IPositionRepository, IGeofenceRepository       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ VehicleTracker│ │ Geofence     │ │ GeofenceRule │ │ Tracking   │ │  │
│  │  │ (Event-      │ │ (Aggregate)  │ │ (Entity)     │ │ Session    │ │  │
│  │  │  Sourced AR) │ │              │ │              │ │ (Entity)   │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  Domain Services: GeofenceEvaluationService, SpeedDetectionService │  │
│  │  Domain Events: PositionReceived, GeofenceEntered, SpeedExceeded  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design — Event Sourced VehicleTracker

### 3.1 Architecture Decision: Event Sourcing for VehicleTracker

The VehicleTracker is event-sourced because:
1. **Audit requirements**: Full position history must be reconstructable for compliance and dispute resolution.
2. **Temporal queries**: "Where was this vehicle at time T?" is a core operational query.
3. **Replay capability**: New geofence rules can be evaluated against historical positions via replay.
4. **High write throughput**: Append-only event store scales better than mutable state for millions of positions/day.

### 3.2 VehicleTracker Event-Sourced Aggregate

**AggregateId:** `VehicleTrackerId` (UUID, same as VehicleId from Fleet Management)
**Event Store:** PostgreSQL with `events` table (append-only, partitioned by vehicle_id + timestamp)

```kotlin
data class VehicleTrackerId(val value: UUID)

/**
 * VehicleTracker — Event-Sourced Aggregate Root
 *
 * State is NEVER persisted directly; it is reconstructed by replaying events.
 * Only new events are appended to the event store.
 */
data class VehicleTracker(
    val id: VehicleTrackerId,
    val tenantId: UUID,
    val vehicleId: UUID,
    // Reconstructed state
    val latestPosition: Position?,
    val currentSpeed: Double,             // km/h
    val currentHeading: Double,          // degrees
    val ignitionOn: Boolean,
    val currentGeofences: Set<UUID>,     // geofence IDs the vehicle is currently inside
    val trackingSessionId: UUID?,
    val totalDistanceKm: Double,
    val version: Long
) {
    companion object {
        fun empty(id: VehicleTrackerId, tenantId: UUID, vehicleId: UUID) = VehicleTracker(
            id = id,
            tenantId = tenantId,
            vehicleId = vehicleId,
            latestPosition = null,
            currentSpeed = 0.0,
            currentHeading = 0.0,
            ignitionOn = false,
            currentGeofences = emptySet(),
            trackingSessionId = null,
            totalDistanceKm = 0.0,
            version = 0
        )
    }

    // --- Event Application (State Reconstruction) ---

    fun apply(event: PositionReceivedEvent): VehicleTracker {
        val distanceDelta = if (latestPosition != null) {
            calculateDistance(latestPosition!!, event.position)
        } else 0.0

        return copy(
            latestPosition = event.position,
            currentSpeed = event.speed,
            currentHeading = event.heading,
            ignitionOn = event.ignitionOn,
            trackingSessionId = trackingSessionId ?: event.sessionId,
            totalDistanceKm = totalDistanceKm + distanceDelta,
            version = version + 1
        )
    }

    fun apply(event: GeofenceEnteredEvent): VehicleTracker {
        val updatedFences = currentGeofences + event.geofenceId
        return copy(currentGeofences = updatedFences, version = version + 1)
    }

    fun apply(event: GeofenceExitedEvent): VehicleTracker {
        val updatedFences = currentGeofences - event.geofenceId
        return copy(currentGeofences = updatedFences, version = version + 1)
    }

    fun apply(event: SpeedExceededEvent): VehicleTracker {
        return copy(currentSpeed = event.speed, version = version + 1)
    }

    fun apply(event: IgnitionTurnedOnEvent): VehicleTracker {
        return copy(ignitionOn = true, version = version + 1)
    }

    fun apply(event: IgnitionTurnedOffEvent): VehicleTracker {
        return copy(ignitionOn = false, version = version + 1)
    }

    fun apply(event: TrackingSessionStartedEvent): VehicleTracker {
        return copy(trackingSessionId = event.sessionId, version = version + 1)
    }

    fun apply(event: TrackingSessionEndedEvent): VehicleTracker {
        return copy(trackingSessionId = null, version = version + 1)
    }

    // --- Behaviors (Command Handlers producing events) ---

    fun processPosition(
        position: Position,
        speed: Double,
        heading: Double,
        ignitionOn: Boolean,
        timestamp: Instant
    ): List<DomainEvent> {
        val events = mutableListOf<DomainEvent>()
        val sessionId = trackingSessionId ?: UUID.randomUUID()

        events.add(
            PositionReceivedEvent(
                trackerId = id.value,
                tenantId = tenantId,
                vehicleId = vehicleId,
                position = position,
                speed = speed,
                heading = heading,
                ignitionOn = ignitionOn,
                sessionId = sessionId,
                timestamp = timestamp
            )
        )

        // Detect ignition state change
        if (!this.ignitionOn && ignitionOn) {
            events.add(
                IgnitionTurnedOnEvent(
                    trackerId = id.value,
                    tenantId = tenantId,
                    vehicleId = vehicleId,
                    sessionId = sessionId,
                    timestamp = timestamp
                )
            )
        }
        if (this.ignitionOn && !ignitionOn) {
            events.add(
                IgnitionTurnedOffEvent(
                    trackerId = id.value,
                    tenantId = tenantId,
                    vehicleId = vehicleId,
                    sessionId = sessionId,
                    timestamp = timestamp
                )
            )
        }

        return events
    }

    // --- Invariants ---
    // INV-01: version is monotonically increasing (enforced by event store)
    // INV-02: ignitionOff cannot occur without a prior ignitionOn (in same session)
    // INV-03: totalDistanceKm is monotonically increasing
}
```

### 3.3 Position Value Object

```kotlin
@JvmInline
value class Latitude(val value: Double) {
    init { require(value in -90.0..90.0) { "Latitude must be between -90 and 90" } }
}

@JvmInline
value class Longitude(val value: Double) {
    init { require(value in -180.0..180.0) { "Longitude must be between -180 and 180" } }
}

data class Position(
    val latitude: Latitude,
    val longitude: Longitude,
    val altitude: Double?,          // meters above sea level
    val accuracy: Double?,         // meters (HDOP)
    val timestamp: Instant
)
```

### 3.4 Geofence Aggregate Root

```kotlin
data class GeofenceId(val value: UUID)

enum class GeofenceType { CIRCLE, POLYGON, CORRIDOR }

enum class GeofenceTrigger { ENTER, EXIT, DWELL }

data class Geofence(
    val id: GeofenceId,
    val tenantId: UUID,
    val name: String,
    val type: GeofenceType,
    val geometry: GeofenceGeometry,
    val triggers: Set<GeofenceTrigger>,
    val dwellDurationMinutes: Int?,     // only for DWELL trigger
    val linkedVehicleIds: Set<UUID>,   // empty = applies to all fleet vehicles
    val linkedFleetId: UUID?,          // if set, applies to all vehicles in fleet
    val alertRecipients: Set<UUID>,    // user IDs to notify
    val status: GeofenceStatus,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun activate(): Geofence =
        copy(status = GeofenceStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(GeofenceActivatedEvent(it)) }

    fun deactivate(): Geofence =
        copy(status = GeofenceStatus.INACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(GeofenceDeactivatedEvent(it)) }

    fun updateGeometry(newGeometry: GeofenceGeometry): Geofence =
        copy(geometry = newGeometry, updatedAt = Instant.now())
            .also { raiseDomainEvent(GeofenceGeometryUpdatedEvent(it, newGeometry)) }

    // INV-01: name must be unique within tenant
    // INV-02: dwellDurationMinutes required when DWELL trigger present
    // INV-03: geometry must be valid (PostGIS validation)
}

sealed class GeofenceGeometry {
    data class Circle(val centerLat: Double, val centerLng: Double, val radiusMeters: Double) : GeofenceGeometry()
    data class Polygon(val coordinates: List<Pair<Double, Double>>) : GeofenceGeometry() {
        init { require(coordinates.size >= 3) { "Polygon requires at least 3 points" } }
    }
    data class Corridor(val points: List<Pair<Double, Double>>, val widthMeters: Double) : GeofenceGeometry()
}
```

### 3.5 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `tracking.position.received.v1` | New GPS position ingested | vehicleId, tenantId, lat, lng, altitude, speed, heading, accuracy, timestamp |
| `tracking.geofence.entered.v1` | Vehicle enters geofence | vehicleId, geofenceId, tenantId, position, timestamp |
| `tracking.geofence.exited.v1` | Vehicle exits geofence | vehicleId, geofenceId, tenantId, position, dwellMinutes, timestamp |
| `tracking.speed.exceeded.v1` | Speed limit violation | vehicleId, tenantId, speed, threshold, position, timestamp |
| `tracking.ignition.on.v1` | Vehicle ignition turned on | vehicleId, tenantId, sessionId, timestamp |
| `tracking.ignition.off.v1` | Vehicle ignition turned off | vehicleId, tenantId, sessionId, timestamp, totalDistanceKm |
| `tracking.session.started.v1` | Tracking session begins | vehicleId, tenantId, sessionId |
| `tracking.session.ended.v1` | Tracking session ends | vehicleId, tenantId, sessionId, duration, totalDistanceKm |

### 3.6 Event Store Schema

```sql
CREATE TABLE tracking_events (
    event_id       UUID PRIMARY KEY,
    aggregate_id   UUID NOT NULL,
    event_type     VARCHAR(255) NOT NULL,
    event_data     JSONB NOT NULL,
    tenant_id      UUID NOT NULL,
    vehicle_id     UUID NOT NULL,
    timestamp      TIMESTAMPTZ NOT NULL,
    aggregate_version BIGINT NOT NULL,
    metadata       JSONB DEFAULT '{}'
) PARTITION BY RANGE (timestamp);

-- Partitions by month (auto-created)
CREATE INDEX idx_tracking_events_aggregate ON tracking_events (aggregate_id, aggregate_version);
CREATE INDEX idx_tracking_events_vehicle ON tracking_events (vehicle_id, timestamp);
CREATE INDEX idx tracking_events_tenant_ts ON tracking_events (tenant_id, timestamp);

-- TimescaleDB hypertable for position projections
CREATE TABLE vehicle_positions (
    vehicle_id     UUID NOT NULL,
    tenant_id      UUID NOT NULL,
    latitude       DOUBLE PRECISION NOT NULL,
    longitude      DOUBLE PRECISION NOT NULL,
    altitude       DOUBLE PRECISION,
    speed          DOUBLE PRECISION NOT NULL,
    heading        DOUBLE PRECISION NOT NULL,
    accuracy       DOUBLE PRECISION,
    ignition_on    BOOLEAN NOT NULL,
    session_id     UUID,
    recorded_at    TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('vehicle_positions', 'recorded_at');
CREATE INDEX idx_positions_vehicle_time ON vehicle_positions (vehicle_id, recorded_at DESC);
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.tracking.domain.port.out

import com.fleetvision.tracking.domain.model.*
import java.time.Instant
import java.util.UUID

/**
 * Event Store interface for VehicleTracker event sourcing.
 */
interface VehicleTrackerEventStore {
    /** Append new events. Fails if version conflict (optimistic locking). */
    fun append(events: List<DomainEvent>, expectedVersion: Long)
    /** Load all events for an aggregate, ordered by version. */
    fun loadEvents(aggregateId: UUID): List<DomainEvent>
    /** Load events within a time range for a vehicle. */
    fun loadEventsByTimeRange(vehicleId: UUID, from: Instant, to: Instant): List<DomainEvent>
}

/**
 * Read-model repository for position data (TimescaleDB projection).
 */
interface PositionReadRepository {
    fun save(position: PositionRecord): PositionRecord
    fun saveBatch(positions: List<PositionRecord>)
    fun findLatest(vehicleId: UUID): PositionRecord?
    fun findLatestBatch(vehicleIds: List<UUID>): List<PositionRecord>
    fun findHistory(vehicleId: UUID, from: Instant, to: Instant, limit: Int): List<PositionRecord>
    fun findNearby(lat: Double, lng: Double, radiusKm: Double, tenantId: UUID, limit: Int): List<PositionRecord>
    fun deleteOlderThan(instant: Instant)
}

/**
 * Latest position cache (Redis).
 */
interface LatestPositionCache {
    fun set(vehicleId: UUID, position: PositionRecord, ttlSeconds: Long = 300)
    fun get(vehicleId: UUID): PositionRecord?
    fun getMulti(vehicleIds: List<UUID>): Map<UUID, PositionRecord>
    fun invalidate(vehicleId: UUID)
}

interface GeofenceRepository {
    fun save(geofence: Geofence): Geofence
    fun findById(geofenceId: UUID, tenantId: UUID): Geofence?
    fun findByTenant(tenantId: UUID): List<Geofence>
    fun findActiveByVehicleId(vehicleId: UUID, tenantId: UUID): List<Geofence>
    fun findActiveByFleetId(fleetId: UUID, tenantId: UUID): List<Geofence>
    fun delete(geofenceId: UUID, tenantId: UUID)
}

interface TrackingSessionRepository {
    fun save(session: TrackingSession): TrackingSession
    fun findById(sessionId: UUID): TrackingSession?
    fun findActiveByVehicleId(vehicleId: UUID): TrackingSession?
    fun findCompletedByVehicle(vehicleId: UUID, from: Instant, to: Instant, page: Int, size: Int): List<TrackingSession>
}

interface EventPublisher {
    fun publish(event: DomainEvent)
}

interface WebSocketBroadcaster {
    fun broadcastPosition(tenantId: UUID, vehicleId: UUID, position: PositionRecord)
    fun broadcastAlert(tenantId: UUID, alert: AlertDto)
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/tracking`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/vehicles/{vehicleId}/position` | Get latest position for a vehicle | `tracking.position.read` |
| `GET` | `/vehicles/positions` | Get latest positions for multiple vehicles (batch) | `tracking.position.read` |
| `GET` | `/vehicles/{vehicleId}/history` | Get position history for time range | `tracking.history.read` |
| `GET` | `/vehicles/{vehicleId}/session` | Get current or latest tracking session | `tracking.session.read` |
| `GET` | `/vehicles/{vehicleId}/sessions` | List completed tracking sessions | `tracking.session.read` |
| `GET` | `/vehicles/nearby` | Find vehicles near a coordinate | `tracking.position.read` |
| `GET` | `/geofences` | List geofences in tenant | `tracking.geofence.read` |
| `GET` | `/geofences/{geofenceId}` | Get geofence detail | `tracking.geofence.read` |
| `POST` | `/geofences` | Create a geofence | `tracking.geofence.create` |
| `PUT` | `/geofences/{geofenceId}` | Update geofence | `tracking.geofence.update` |
| `DELETE` | `/geofences/{geofenceId}` | Delete geofence | `tracking.geofence.delete` |
| `GET` | `/geofences/{geofenceId}/vehicles` | List vehicles currently inside geofence | `tracking.geofence.read` |
| `GET` | `/alerts` | List tracking alerts (speed, geofence) | `tracking.alert.read` |

### 5.2 WebSocket API

```
WebSocket endpoint: /ws/tracking

Subscribe to live positions:
  SEND: {"action": "subscribe", "channel": "positions", "tenantId": "uuid", "vehicleIds": ["id1", "id2"]}

Receive position updates:
  MESSAGE: {
    "type": "position.update",
    "vehicleId": "uuid",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "speed": 65.5,
    "heading": 180.0,
    "timestamp": "2026-08-02T14:30:00.000Z"
  }

Subscribe to geofence alerts:
  SEND: {"action": "subscribe", "channel": "geofence.alerts", "tenantId": "uuid"}

Receive alert:
  MESSAGE: {
    "type": "geofence.alert",
    "vehicleId": "uuid",
    "geofenceId": "uuid",
    "geofenceName": "Warehouse Zone A",
    "trigger": "ENTER",
    "position": {"latitude": 40.7128, "longitude": -74.0060},
    "timestamp": "2026-08-02T14:30:00.000Z"
  }
```

### 5.3 gRPC Service

```protobuf
service TrackingService {
  // Get latest position for a vehicle
  rpc GetLatestPosition (GetLatestPositionRequest) returns (PositionResponse);
  // Batch latest positions
  rpc GetLatestPositions (GetLatestPositionsRequest) returns (GetLatestPositionsResponse);
  // Get position history for time range
  rpc GetPositionHistory (GetPositionHistoryRequest) returns (GetPositionHistoryResponse);
  // Check if vehicle is inside geofence
  rpc CheckGeofenceStatus (CheckGeofenceStatusRequest) returns (CheckGeofenceStatusResponse);
}

message GetLatestPositionRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
}

message PositionResponse {
  string vehicle_id = 1;
  double latitude = 2;
  double longitude = 3;
  double speed = 4;
  double heading = 5;
  int64 timestamp = 6;
  bool ignition_on = 7;
}

message GetLatestPositionsRequest {
  repeated string vehicle_ids = 1;
  string tenant_id = 2;
}

message GetLatestPositionsResponse {
  repeated PositionResponse positions = 1;
}

message GetPositionHistoryRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
  int64 from_timestamp = 3;
  int64 to_timestamp = 4;
  int32 limit = 5;
}

message GetPositionHistoryResponse {
  repeated PositionResponse positions = 1;
}

message CheckGeofenceStatusRequest {
  string vehicle_id = 1;
  string geofence_id = 2;
  string tenant_id = 3;
}

message CheckGeofenceStatusResponse {
  bool is_inside = 1;
  optional string entered_at = 2;
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.tracking.position.events` | `vehicleId` | 7 days | tracking-service |
| `fleetvision.tracking.geofence.events` | `geofenceId` | 7 days | tracking-service |
| `fleetvision.tracking.alert.events` | `vehicleId` | 30 days | tracking-service |
| `fleetvision.telemetry.position.raw` | `deviceId` | 3 days | telemetry-ingestion-service |

### 6.2 Published Events (Producer)

```json
// tracking.position.received.v1
{
  "specversion": "1.0",
  "type": "tracking.position.received.v1",
  "source": "/tracking-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "vehicle_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "position": {
      "latitude": 40.7128,
      "longitude": -74.0060,
      "altitude": 10.5,
      "accuracy": 5.2
    },
    "speed": 65.5,
    "heading": 180.0,
    "ignition_on": true,
    "session_id": "880e8400-e29b-41d4-a716-446655440003"
  },
  "fleetvision": {
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "correlation_id": "uuid-v4",
    "causation_id": "uuid-v4",
    "aggregate_id": "550e8400-e29b-41d4-a716-446655440000",
    "aggregate_version": 12345
  }
}

// tracking.speed.exceeded.v1
{
  "specversion": "1.0",
  "type": "tracking.speed.exceeded.v1",
  "source": "/tracking-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "data": {
    "vehicle_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "speed": 135.0,
    "threshold": 120.0,
    "position": { "latitude": 40.7128, "longitude": -74.0060 },
    "fleet_id": "660e8400-e29b-41d4-a716-446655440001"
  },
  "fleetvision": { ... }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.telemetry.position.raw` | `telemetry.position.raw.v1` | Ingest raw GPS data, create VehicleTracker events, evaluate geofences |
| `fleetvision.fleet.vehicle.events` | `fleet.vehicle.added.v1` | Initialize VehicleTracker aggregate for new vehicles |
| `fleetvision.fleet.vehicle.events` | `fleet.vehicle.decommissioned.v1` | End tracking session, archive VehicleTracker state |
| `fleetvision.fleet.fleet.policy.events` | `fleet.fleet.policy.updated.v1` | Update speed threshold cache for affected fleet |
| `fleetvision.trip.events` | `trip.route.assigned.v1` | Apply route-specific geofences to VehicleTracker |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| Telemetry Ingestion | Kafka (inbound) | Receive raw position data |
| Fleet Management | Kafka (inbound), gRPC (outbound) | Vehicle/fleet data for validation, policy lookup |
| Trip & Route Mgmt | Kafka (inbound) | Route assignment, route geofences |
| Notification Service | Kafka (outbound) | Speed alerts, geofence alerts |
| Compliance & Safety | Kafka (outbound) | Speed violation events for HOS integration |
| Analytics Engine | Kafka (outbound) | All position and alert events |
| Audit Log Service | Kafka (outbound) | Geofence configuration changes |
| Identity & Access Mgmt | gRPC (outbound) | Permission checks |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **Mapbox / Google Maps** | REST/gRPC | Outbound | Map tile rendering for position visualization (via frontend) |
| **Weather API** | REST | Outbound | Enrich position events with weather data (via stream processor) |

### 7.3 Data Flow

```
Telemetry Device
    │ MQTT
    ▼
Telemetry Ingestion Service
    │ Kafka: telemetry.position.raw
    ▼
Tracking Service
    ├──► Event Store (PostgreSQL) — VehicleTracker events
    ├──► TimescaleDB — Position read model
    ├──► Redis — Latest position cache
    ├──► WebSocket — Live position broadcast to clients
    ├──► Geofence Evaluator (PostGIS)
    │       ├──► Kafka: tracking.geofence.events
    │       └──► Kafka: tracking.alert.events → Notification Service
    └──► Kafka: tracking.position.events → Analytics Engine
```

---

## 8. Configuration Properties

```yaml
# application-tracking.yaml
fleetvision:
  tracking:
    service-name: tracking-service

    position:
      max-age-seconds: 300              # reject positions older than this
      max-speed-kmh: 350.0              # reject unreasonable speeds
      min-accuracy-meters: 0.5          # minimum accepted accuracy
      dedup-distance-meters: 1.0        # ignore positions within this distance
      batch-size: 500                   # batch write to TimescaleDB
      batch-flush-interval-ms: 1000     # max wait before flushing batch
      history-default-limit: 1000

    geofence:
      evaluation-interval-ms: 500       # geofence eval cycle
      dwell-default-minutes: 10
      max-geofences-per-tenant: 1000
      max-polygon-points: 100

    websocket:
      max-connections-per-tenant: 500
      heartbeat-interval-seconds: 30
      max-subscriptions-per-connection: 20
      stale-position-threshold-seconds: 600

    cache:
      latest-position-ttl-seconds: 300
      fleet-policy-ttl-seconds: 300

  database:
    primary:
      jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_tracking
      username: ${DB_USERNAME}
      password: ${DB_PASSWORD}
      pool:
        maximum-pool-size: 30
        minimum-idle: 10
    timescale:
      jdbc-url: jdbc:postgresql://${TIMESCALEDB_HOST}:5432/fleetvision_tracking_ts
      username: ${DB_USERNAME}
      password: ${DB_PASSWORD}
      pool:
        maximum-pool-size: 20
        minimum-idle: 5
    migration:
      locations: classpath:db/migration/tracking

  redis:
    host: ${REDIS_HOST}
    port: 6379
    password: ${REDIS_PASSWORD}
    database-index: 2

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: tracking-producer
      acks: all
      retries: 3
      linger-ms: 5
      compression-type: lz4
      batch-size: 16384
    consumer:
      group-id: tracking-consumer
      auto-offset-reset: latest
      enable-auto-commit: false
      max-poll-records: 1000
      max-poll-interval-ms: 300000
    topics:
      position-events: fleetvision.tracking.position.events
      geofence-events: fleetvision.tracking.geofence.events
      alert-events: fleetvision.tracking.alert.events
      raw-position-input: fleetvision.telemetry.position.raw
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| PostgreSQL (event store) | 5 failures in 30s | 30s | 3 | Buffer events in Redis, replay when recovered |
| TimescaleDB (positions) | 5 failures in 30s | 30s | 3 | Buffer positions in Redis batch queue |
| Redis (cache) | 3 failures in 10s | 10s | 5 | Skip cache, query DB directly |
| Fleet Mgmt gRPC | 10 failures in 30s | 10s | 5 | Use cached fleet policy data |
| IAM gRPC (auth) | 10 failures in 30s | 10s | 5 | Deny operation |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| Event store append | 5 | Exponential (50ms base, 2x) | Full jitter |
| TimescaleDB batch write | 3 | Exponential (100ms, 200ms, 400ms) | +/- 25% |
| Redis operations | 2 | Fixed 50ms | None |
| Fleet Mgmt gRPC calls | 2 | Fixed 200ms | +/- 50ms |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| gRPC requests | 2s | 3s | 5s |
| Event store write | 1s | 2s | 3s |
| TimescaleDB write | 1s | 5s | 6s |
| Redis operations | 100ms | 200ms | 300ms |
| Kafka produce | 5s | — | 30s |
| Geofence evaluation | — | — | 50ms (budget) |

### 9.4 Backpressure & Overflow

```yaml
# Kafka consumer backpressure
tracking:
  position:
    max-buffer-size: 100000           # max positions in memory buffer
    overflow-strategy: DISCARD_OLDEST  # drop oldest if buffer full
    alert-on-buffer-percent: 80        # alert when buffer is 80% full
```

### 9.5 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Position history queries | 100/min per user | 200 | Sliding window |
| Geofence creation | 20/min per tenant | 40 | Token bucket |
| WebSocket connections | 500 per tenant | 1000 | Token bucket |
| Nearby vehicle queries | 60/min per user | 120 | Sliding window |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | VehicleTracker event sourcing, geofence logic, position validation | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | Event store, TimescaleDB, Redis, Kafka | Testcontainers (PG, TimescaleDB, Redis, Kafka) | 80% |
| **Contract Tests** | REST/WebSocket/gRPC API contracts | Spring Cloud Contract | 100% |
| **Component Tests** | Full position ingestion pipeline | SpringBootTest | Critical paths |
| **Load Tests** | High-throughput position ingestion | Gatling / k6 | Performance budgets |

### 10.2 Domain Test Scenarios

**VehicleTracker (Event Sourcing):**
- Append events to event store, replay to reconstruct state
- Optimistic locking: concurrent append with version conflict fails
- Position received event updates latest position, speed, heading
- Ignition state transitions tracked correctly
- Total distance calculated correctly across many positions

**Geofence:**
- Create circular geofence with valid parameters
- Create polygon geofence with < 3 points fails
- Activate/deactivate transitions succeed
- Dwell duration required when DWELL trigger set
- Max polygon points enforced

### 10.3 Integration Test Scenarios

- Position event received from Kafka, stored in event store and TimescaleDB
- Latest position cached in Redis, returned on cache hit
- Geofence evaluation triggers alert on position within boundary
- WebSocket broadcast delivers position to subscribed clients
- Batch position write to TimescaleDB within flush interval

### 10.4 Contract Test Scenarios
- `GET /vehicles/{id}/position` returns latest position or 404
- `POST /geofences` validates geometry; returns 400 for invalid polygon
- WebSocket subscription delivers correct vehicle positions
- `GetLatestPositions` gRPC returns positions for requested vehicle IDs

### 10.5 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| Position ingestion throughput | 150,000 events/sec sustained | k6 / custom Kafka producer |
| Latest position read latency (Redis cache) | < 5ms p99 | Redis benchmark |
| Position history query (1 week) | < 500ms p99 | k6 |
| Geofence evaluation latency | < 50ms p99 per vehicle | Gatling |
| WebSocket concurrent connections | 10,000 concurrent | ws-bench |
| Event replay (100K events) | < 5 seconds total | JUnit benchmark |

---

## Appendix A: Package Structure

```
com.fleetvision.tracking/
├── domain/
│   ├── model/
│   │   ├── VehicleTracker.kt
│   │   ├── Geofence.kt
│   │   ├── TrackingSession.kt
│   │   ├── Position.kt
│   │   └── valueobjects/
│   │       ├── VehicleTrackerId.kt
│   │       ├── GeofenceId.kt
│   │       ├── Latitude.kt
│   │       ├── Longitude.kt
│   │       └── GeofenceGeometry.kt
│   ├── event/
│   │   ├── PositionReceivedEvent.kt
│   │   ├── GeofenceEnteredEvent.kt
│   │   ├── SpeedExceededEvent.kt
│   │   ├── IgnitionTurnedOnEvent.kt
│   │   └── ...
│   ├── service/
│   │   ├── GeofenceEvaluationService.kt
│   │   └── SpeedDetectionService.kt
│   └── port/
│       └── out/
│           ├── VehicleTrackerEventStore.kt
│           ├── PositionReadRepository.kt
│           ├── LatestPositionCache.kt
│           ├── GeofenceRepository.kt
│           ├── TrackingSessionRepository.kt
│           ├── EventPublisher.kt
│           └── WebSocketBroadcaster.kt
├── application/
│   ├── usecase/
│   │   ├── ProcessPositionUseCase.kt
│   │   ├── CreateGeofenceUseCase.kt
│   │   ├── EvaluateGeofenceUseCase.kt
│   │   ├── GetVehicleHistoryUseCase.kt
│   │   ├── GetLatestPositionsUseCase.kt
│   │   ├── DetectSpeedViolationUseCase.kt
│   │   └── ReplayTrackerUseCase.kt
│   └── dto/
│       ├── PositionDto.kt
│       ├── GeofenceDto.kt
│       ├── AlertDto.kt
│       └── WebSocketMessage.kt
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── TrackingController.kt
│   │   │   ├── GeofenceController.kt
│   │   │   └── AlertController.kt
│   │   ├── websocket/
│   │   │   ├── PositionStreamController.kt
│   │   │   └── WebSocketSubscriptionManager.kt
│   │   ├── grpc/
│   │   │   └── TrackingGrpcService.kt
│   │   └── event/
│   │       ├── PositionEventConsumer.kt
│   │       └── FleetEventConsumer.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── eventsourcing/
│       │   │   ├── VehicleTrackerEventStoreAdapter.kt
│       │   │   └── EventSourcingSession.kt
│       │   ├── timescale/
│       │   │   └── PositionReadRepositoryAdapter.kt
│       │   └── jpa/
│       │       └── GeofenceJpaRepository.kt
│       ├── redis/
│       │   └── LatestPositionCacheAdapter.kt
│       ├── websocket/
│       │   └── WebSocketBroadcasterImpl.kt
│       └── kafka/
│           └── TrackingEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── EventSourcingConfig.kt
│   │   ├── TimescaleDbConfig.kt
│   │   ├── WebSocketConfig.kt
│   │   ├── KafkaConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── StalePositionException.kt
│       ├── InvalidPositionException.kt
│       └── GeofenceViolationException.kt
└── TrackingServiceApplication.kt
```
