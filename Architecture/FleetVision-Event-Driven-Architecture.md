# FleetVision Event-Driven Architecture

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect  

---

## 1. Event Architecture Overview

### 1.1 Event-First Design Principle

Every state change in FleetVision is modeled as a domain event before any side effects occur. Events are the source of truth and the primary mechanism for cross-service communication.

### 1.2 Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       EVENT ARCHITECTURE OVERVIEW                             │
│                                                                              │
│  ┌──────────┐                                                                │
│  │ Command  │                                                                │
│  │ Request  │                                                                │
│  └────┬─────┘                                                                │
│       │                                                                       │
│       ▼                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐        │
│  │                    AGGREGATE ROOT                                 │        │
│  │  1. Validate command                                             │        │
│  │  2. Enforce invariants                                           │        │
│  │  3. Apply business logic                                         │        │
│  │  4. Generate domain events                                        │        │
│  │  5. Persist state + events (same transaction)                    │        │
│  └──────────────────┬────────────────────────────────────────────┘        │
│                     │                                                       │
│       ┌─────────────┼─────────────┐                                        │
│       │             │             │                                         │
│       ▼             ▼             ▼                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐                           │
│  │ State DB  │ │ Event    │ │ Command Response  │                           │
│  │ (PG/Mongo)│ │ Outbox   │ │ (HTTP/gRPC reply)  │                           │
│  └──────────┘ └─────┬────┘ └──────────────────┘                           │
│                     │                                                       │
│                     ▼                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐        │
│  │                    OUTBOX PROCESSOR                                │        │
│  │  (Debezium CDC or Kafka Connect)                                   │        │
│  │  Reads pending outbox entries → Publishes to Kafka → Marks sent   │        │
│  └──────────────────┬───────────────────────────────────────────────┘        │
│                     │                                                       │
│                     ▼                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐        │
│  │                    APACHE KAFKA CLUSTER                            │        │
│  │                                                                    │        │
│  │  Topics:                                                          │        │
│  │  ├── fleet.vehicle.registered.v1                                 │        │
│  │  ├── fleet.vehicle.assigned.v1                                   │        │
│  │  ├── tracking.position.updated.v1                                 │        │
│  │  ├── trip.dispatched.v1                                           │        │
│  │  ├── compliance.hos.violation.v1                                   │        │
│  │  ├── maintenance.workorder.created.v1                            │        │
│  │  ├── fuel.transaction.completed.v1                                │        │
│  │  └── ... (100+ topics)                                            │        │
│  │                                                                    │        │
│  │  Partitions: Keyed by aggregate_id for ordering                    │        │
│  │  Replication: Factor 3 (multi-AZ)                                  │        │
│  │  Schema Registry: Confluent (Avro)                                │        │
│  └──────────────────┬───────────────────────────────────────────────┘        │
│                     │                                                       │
│       ┌─────────────┼──────────────────────┐                                │
│       │             │                      │                                 │
│       ▼             ▼                      ▼                                 │
│  ┌──────────┐ ┌──────────┐        ┌──────────────┐                          │
│  │ Service  │ │ Service  │        │ Stream       │                          │
│  │ Consumer │ │ Consumer │        │ Processor    │                          │
│  │ (updates │ │ (sends   │        │ (Flink/Faust)│                          │
│  │  read    │ │  notif.) │        │ (aggregation, │                          │
│  │  model)  │ │          │        │  ML scoring)  │                          │
│  └──────────┘ └──────────┘        └──────────────┘                          │
│       │             │                      │                                 │
│       ▼             ▼                      ▼                                 │
│  ┌──────────┐ ┌──────────┐        ┌──────────────┐                          │
│  │ Read     │ │ Notif.   │        │ ClickHouse   │                          │
│  │ Model DB │ │ Channel  │        │ (OLAP)       │                          │
│  │ (CQRS)   │ │          │        │ Elasticsearch│                          │
│  └──────────┘ └──────────┘        └──────────────┘                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kafka Topology

### 2.1 Topic Architecture

#### Topic Naming Convention

```
{domain}.{aggregate}.{event-type}.{version}

Examples:
  fleet.vehicle.registered.v1
  tracking.position.updated.v2
  compliance.hos.violation.detected.v1
  billing.invoice.generated.v1
```

#### Topic Categories

| Category | Prefix | Description | Partition Key | Retention |
|---|---|---|---|---|
| **Domain Events** | `{domain}.{aggregate}.{event}` | State change events from aggregate roots | `aggregate_id` | 7 days |
| **Telemetry Raw** | `telemetry.device.raw-data` | Raw device data from MQTT bridge | `device_id` | 7 days |
| **Position Events** | `tracking.position.updated` | GPS positions (high volume) | `vehicle_id` | 7 days |
| **Notification Commands** | `notification.send` | Notification delivery commands | `recipient_id` | 3 days |
| **Audit Events** | `audit.{domain}.{action}` | Audit trail events | `tenant_id` | 30 days |
| **Dead Letter** | `{original-topic}.dlq` | Failed event processing | Original key | 14 days |

### 2.2 Topic Configuration Matrix

| Topic | Partitions | Replication Factor | Compaction | Cleanup | Estimated Throughput |
|---|---|---|---|---|---|
| `tracking.position.updated.v1` | 256 | 3 | Delete | 7 days | 600K msg/s |
| `telemetry.device.raw-data.v1` | 128 | 3 | Delete | 7 days | 200K msg/s |
| `fleet.vehicle.*` | 32 | 3 | Compact | 7 days | 100 msg/s |
| `tracking.geofence.*` | 32 | 3 | Delete | 7 days | 5K msg/s |
| `trip.*` | 64 | 3 | Compact | 7 days | 1K msg/s |
| `compliance.*` | 64 | 3 | Compact | 30 days | 500 msg/s |
| `maintenance.*` | 32 | 3 | Compact | 7 days | 100 msg/s |
| `fuel.*` | 32 | 3 | Delete | 7 days | 500 msg/s |
| `driver.*` | 32 | 3 | Compact | 7 days | 100 msg/s |
| `billing.*` | 16 | 3 | Compact | 30 days | 50 msg/s |
| `notification.send` | 64 | 3 | Delete | 3 days | 5K msg/s |
| `audit.*` | 64 | 3 | Delete | 30 days | 10K msg/s |

### 2.3 Kafka Cluster Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    KAFKA CLUSTER (MSK)                           │
│                                                                  │
│  AZ-a                AZ-b                AZ-c                    │
│  ┌─────────┐        ┌─────────┐        ┌─────────┐            │
│  │Broker 0 │        │Broker 1 │        │Broker 2 │            │
│  │ (leader)│        │ (leader)│        │ (leader)│            │
│  │Controller│       │         │        │         │            │
│  └─────────┘        └─────────┘        └─────────┘            │
│  ┌─────────┐        ┌─────────┐        ┌─────────┐            │
│  │Broker 3 │        │Broker 4 │        │Broker 5 │            │
│  │         │        │         │        │         │            │
│  └─────────┘        └─────────┘        └─────────┘            │
│                                                                  │
│  Config:                                                         │
│  • brokers: 6 (2 per AZ)                                        │
│  • replication.factor: 3                                        │
│  • min.insync.replicas: 2                                        │
│  • default.retention.ms: 604800000 (7 days)                     │
│  • compression.type: lz4                                         │
│  • num.io.threads: 16                                           │
│  • num.network.threads: 8                                        │
│  • socket.send.buffer.bytes: 1024000                            │
│  • socket.receive.buffer.bytes: 1024000                          │
│  • log.segment.bytes: 1073741824 (1GB)                           │
│                                                                  │
│  Schema Registry: Confluent (3 nodes, 1 per AZ)                  │
│  Kafka Connect: Distributed (3 workers)                          │
│    → JDBC Source (outbox polling fallback)                       │
│    → JDBC Sink (read model projections)                         │
│    → S3 Sink (event archival)                                    │
│    → Elasticsearch Sink (search indexing)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Event Schema Design

### 3.1 CloudEvents Envelope

All events follow the [CloudEvents v1.0](https://cloudevents.io/) specification with FleetVision extensions:

```json
{
  "specversion": "1.0",
  "type": "fleet.vehicle.registered.v1",
  "source": "/fleet-management-service/aggregate/vehicle",
  "id": "evt_550e8400-e29b-41d4-a716-446655440000",
  "time": "2026-08-02T14:30:00.000Z",
  "datacontenttype": "application/avro",
  "dataschema": "https://schema-registry.fleetvision.io/subjects/fleet.vehicle.registered.v1/versions/latest",
  "data": {
    "vehicle_id": "550e8400-e29b-41d4-a716-446655440000",
    "vin": "1HGCM82633A004352",
    "make": "Honda",
    "model": "Accord",
    "year": 2023,
    "vehicle_type": "SEDAN",
    "fuel_type": "GASOLINE",
    "license_plate": "ABC-1234",
    "license_state": "CA",
    "fleet_id": "660e8400-e29b-41d4-a716-446655440001",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002"
  },
  "fleetvision": {
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "correlation_id": "corr_660e8400-e29b-41d4-a716-446655440003",
    "causation_id": "cmd_550e8400-e29b-41d4-a716-446655440004",
    "aggregate_id": "550e8400-e29b-41d4-a716-446655440000",
    "aggregate_type": "Vehicle",
    "aggregate_version": 1
  }
}
```

### 3.2 Event Schema Examples (Avro)

#### fleet.vehicle.registered.v1

```json
{
  "type": "record",
  "name": "VehicleRegisteredEvent",
  "namespace": "com.fleetvision.fleet.events",
  "fields": [
    {"name": "vehicle_id", "type": "string", "logicalType": "uuid"},
    {"name": "vin", "type": "string"},
    {"name": "make", "type": "string"},
    {"name": "model", "type": "string"},
    {"name": "year", "type": "int"},
    {"name": "vehicle_type", "type": {"type": "enum", "name": "VehicleType", "symbols": ["TRUCK","VAN","SEDAN","BUS","TRAILER","MOTORCYCLE","OTHER"]}},
    {"name": "fuel_type", "type": {"type": "enum", "name": "FuelType", "symbols": ["GASOLINE","DIESEL","ELECTRIC","HYBRID","CNG","LPG"]}},
    {"name": "license_plate", "type": ["null", "string"], "default": null},
    {"name": "license_state", "type": ["null", "string"], "default": null},
    {"name": "fleet_id", "type": ["null", "string"], "default": null, "logicalType": "uuid"},
    {"name": "tenant_id", "type": "string", "logicalType": "uuid"},
    {"name": "registered_at", "type": "long", "logicalType": "timestamp-micros"}
  ]
}
```

#### tracking.position.updated.v1

```json
{
  "type": "record",
  "name": "PositionUpdatedEvent",
  "namespace": "com.fleetvision.tracking.events",
  "fields": [
    {"name": "vehicle_id", "type": "string", "logicalType": "uuid"},
    {"name": "tenant_id", "type": "string", "logicalType": "uuid"},
    {"name": "timestamp", "type": "long", "logicalType": "timestamp-micros"},
    {"name": "latitude", "type": "double"},
    {"name": "longitude", "type": "double"},
    {"name": "altitude", "type": ["null", "double"], "default": null},
    {"name": "heading", "type": ["null", "int"], "default": null},
    {"name": "speed_kmh", "type": ["null", "float"], "default": null},
    {"name": "accuracy_m", "type": ["null", "float"], "default": null},
    {"name": "ignition_on", "type": ["null", "boolean"], "default": null},
    {"name": "odometer_km", "type": ["null", "long"], "default": null},
    {"name": "source", "type": {"type": "enum", "name": "PositionSource", "symbols": ["GPS","CELL_TOWER","WIFI","MANUAL"]}},
    {"name": "device_id", "type": ["null", "string"], "default": null, "logicalType": "uuid"}
  ]
}
```

### 3.3 Schema Evolution Strategy

| Change Type | Compatibility | Action |
|---|---|---|
| Add new optional field | Forward compatible | Register new schema version; existing consumers ignore unknown field |
| Add new field with default | Backward + Forward | Register new schema version |
| Remove field | Breaking (backward) | Create new event type version; consumers must migrate |
| Rename field | Breaking | Create new event type version; upcaster for old events |
| Change field type | Breaking | Create new event type version; upcaster for old events |
| Add enum value | Forward compatible | Register new schema version |
| Remove enum value | Breaking (backward) | Create new event type version; default to UNKNOWN for old values |

**Schema Registry Compatibility Mode:** `BACKWARD_TRANSITIVE` for new topics; `FULL_TRANSITIVE` where both old and new consumers must interoperate.

---

## 4. Saga Patterns

### 4.1 Choreography Saga: Trip Dispatch

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Trip Mgmt    │     │ Compliance   │     │ Tracking     │     │ Notification │
│ Service      │     │ Service      │     │ Service      │     │ Service      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ 1. TripDispatched  │                    │                    │
       │───────────────────►│                    │                    │
       │                    │ 2. Check HOS      │                    │
       │                    │    eligibility     │                    │
       │                    │ 3. HOSViolation?   │                    │
       │                    │   (if violation)   │                    │
       │◄───────────────────│                    │                    │
       │                    │                    │                    │
       │ 4. (If eligible)   │                    │                    │
       │    TripStarted     │                    │                    │
       │────────────────────────────────────────►                    │
       │                    │                    │ 5. Start tracking │
       │                    │                    │                    │
       │                    │                    │ 6. TripStatusChanged │
       │                    │                    │───────────────────►│
       │                    │                    │                    │ 7. Send notification
       │                    │                    │                    │
       │ COMPENSATION:      │                    │                    │
       │ If HOS violation:  │                    │                    │
       │ Trip.cancel()      │                    │                    │
       │ → TripCancelled    │                    │                    │
       │   event published  │                    │                    │
```

### 4.2 Compensation Triggers

| Saga | Compensating Event | Compensation Action |
|---|---|---|
| Trip Dispatch | HOS violation detected | Cancel trip, notify driver and fleet manager |
| Vehicle Assignment | Fleet at capacity | Revert vehicle status, notify |
| Fuel Card Issuance | Card provider rejection | Revoke card record, notify driver |
| Maintenance Work Order | Parts unavailable | Downgrade work order priority, create procurement request |
| Invoice Generation | Billing system error | Retry with exponential backoff; alert billing admin after 3 failures |
| Device Provisioning | Device pairing failure | Roll back provisioning record, alert fleet admin |

---

## 5. Event Processing Patterns

### 5.1 Consumer Patterns

| Pattern | Use Case | Implementation |
|---|---|---|
| **Event Handler** | Simple state update on single event | `@KafkaListener` in Spring, idempotent handler |
| **Projection** | Build/maintain read model from events | Kafka Streams / custom consumer writing to read DB |
| **Process Manager** | Orchestrate multi-step saga | Stateful consumer tracking saga instance state |
| **Stream Processor** | Windowed aggregation, anomaly detection | Kafka Streams / Faust / Flink |
| **Event Sourcing** | Persist events for aggregate reconstruction | Event store consumer (append to event table) |

### 5.2 Idempotent Event Processing

```kotlin
interface IdempotentEventHandler<T : DomainEvent> {
    fun handle(event: T) {
        // 1. Check deduplication
        val processed = deduplicationStore.wasProcessed(
            aggregateId = event.aggregateId,
            eventId = event.eventId,
            eventType = event.eventType
        )
        if (processed) return

        // 2. Process event
        processEvent(event)

        // 3. Mark as processed
        deduplicationStore.markProcessed(
            aggregateId = event.aggregateId,
            eventId = event.eventId,
            eventType = event.eventType,
            processedAt = Instant.now()
        )
    }
}
```

### 5.3 Dead Letter Queue Strategy

| Failure Type | DLQ Target | Action |
|---|---|---|
| Deserialization error | `{topic}.dlq-deser` | Alert engineering team; manual investigation |
| Business logic error | `{topic}.dlq-business` | Alert domain team; manual intervention |
| Infrastructure error | Retry (exponential backoff) | Automatic retry; if exhausted → DLQ |
| Poison pill (null key) | `{topic}.dlq-poison` | Alert platform team; investigate source |

**DLQ Monitoring:**
- Consumer lag alert when DLQ size > 100 messages
- PagerDuty alert when DLQ size > 1000 messages
- Daily DLQ review in Grafana dashboard

---

## 6. Exactly-Once Semantics

### 6.1 Transactional Outbox Pattern

```kotlin
@Transactional
fun registerVehicle(command: RegisterVehicleCommand): VehicleId {
    // 1. Create aggregate
    val vehicle = Vehicle.register(command)
    
    // 2. Persist state
    vehicleRepository.save(vehicle)
    
    // 3. Persist events to outbox (same transaction)
    val events = vehicle.domainEvents
    eventOutboxRepository.saveAll(events.map { event ->
        OutboxEntry(
            aggregateType = vehicle.javaClass.simpleName,
            aggregateId = vehicle.id,
            eventType = event.eventType,
            eventData = objectMapper.writeValueAsString(event),
            metadata = mapOf(
                "tenant_id" to event.tenantId.toString(),
                "correlation_id" to event.correlationId.toString()
            )
        )
    })
    
    // 4. Clear domain events
    vehicle.clearDomainEvents()
    
    return vehicle.id
}
```

### 6.2 Outbox Processor (Debezium CDC)

```
PostgreSQL Outbox Table
    │
    │ Debezium CDC Connector (WAL streaming)
    │ (no polling — real-time, no missed events)
    │
    ▼
Kafka Connect Framework
    │
    │ Transforms:
    │   - Extract event data from outbox record
    │   - Wrap in CloudEvents envelope
    │   - Route to correct topic based on event_type
    │
    ▼
Kafka Topic: {domain}.{aggregate}.{event-type}.v{version}
```

---

## 7. Event Versioning Strategy

### 7.1 Version Lifecycle

1. **v1 Created** — Initial event schema registered
2. **v1 Deprecated** — New version released; consumers should migrate
3. **v1 Retired** — No consumers remain; topic cleanup scheduled
4. **v1 Removed** — Topic deleted; schema archived

### 7.2 Migration Path

When a breaking change is needed:

```
1. Create new event type version (e.g., tracking.position.updated.v2)
2. Deploy v2 producer with feature flag (off)
3. Deploy v2 consumers alongside v1 consumers (dual consumer)
4. Enable feature flag on v2 producer → v2 events start flowing
5. Migrate v1 consumers to v2 (or deploy upcaster)
6. Verify v1 topic drain (no new messages for 7 days)
7. Remove v1 consumer
8. Delete v1 topic
```

---

## 8. Event Monitoring

### 8.1 Kafka Metrics

| Metric | Alert Threshold | Action |
|---|---|---|
| Consumer group lag | > 10,000 messages | Scale consumers; investigate bottleneck |
| Under-replicated partitions | > 0 | Immediate investigation (broker health) |
| Offline partitions | > 0 | SEV-2 incident; broker recovery |
| Producer error rate | > 0.1% | Investigate network/broker issues |
| Consumer error rate | > 0.1% | Investigate consumer logic; check DLQ |
| Topic bytes in/sec | > 80% of provisioned capacity | Add partitions; scale cluster |
| Schema registry compatibility failure | Any | Block deployment; fix schema |
