# FleetVision Database Architecture

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect, Database Architect  

---

## 1. Polyglot Persistence Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DATA ARCHITECTURE OVERVIEW                         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    WRITE PATH                                   │    │
│  │                                                                  │    │
│  │  Command → Aggregate Root → Domain Event → Outbox Table          │    │
│  │                                          │                       │    │
│  │                                          ▼                       │    │
│  │                                     Kafka Producer               │    │
│  │                                          │                       │    │
│  │               ┌──────────────────────────┼──────────────┐       │    │
│  │               ▼                          ▼              ▼       │    │
│  │         Event Store              Read Model       Other         │    │
│  │         (PostgreSQL)             Projections     Services       │    │
│  │                                         │                       │    │
│  └─────────────────────────────────────────┼───────────────────────┘    │
│                                            ▼                            │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    DATA STORES                                  │    │
│  │                                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │    │
│  │  │PostgreSQL│  │Timescale │  │ MongoDB  │  │ Redis    │      │    │
│  │  │ OLTP +   │  │ Time-    │  │ Docs +   │  │ Cache +  │      │    │
│  │  │ Event    │  │ Series   │  │ Event    │  │ Session  │      │    │
│  │  │ Store    │  │ GPS +    │  │ Sourced  │  │ Rate     │      │    │
│  │  │ (Rels)   │  │ Telemetry│  │ (Inspections│ │ Limiting │      │    │
│  │  │          │  │          │  │  Commands)│  │          │      │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │    │
│  │                                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │    │
│  │  │ClickHouse│  │Elastic-  │  │ S3/MinIO │  │  Kafka   │      │    │
│  │  │ OLAP     │  │ search   │  │ Objects  │  │ Event    │      │    │
│  │  │ Analytics│  │ Full-Text│  │ Firmware │  │ Stream   │      │    │
│  │  │ Reports  │  │ Search   │  │ Documents│  │ Buffer   │      │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. PostgreSQL Schema Design

### 2.1 Schema per Bounded Context

```
fleetvision_db
├── public (empty — no objects in public schema)
│
├── identity (Identity & Access Management)
│   ├── users
│   ├── roles
│   ├── permissions
│   ├── role_permissions
│   ├── user_roles
│   ├── organizations
│   ├── organization_hierarchy
│   └── user_sessions
│
├── fleet (Fleet Management)
│   ├── vehicles
│   ├── fleets
│   ├── vehicle_groups
│   ├── fleet_memberships
│   ├── vehicle_group_memberships
│   ├── fleet_policies
│   ├── fleet_policy_rules
│   └── vehicle_specifications
│
├── maintenance (Vehicle Maintenance)
│   ├── maintenance_work_orders
│   ├── maintenance_work_order_events   (event store)
│   ├── maintenance_work_order_snapshots
│   ├── maintenance_plans
│   ├── maintenance_plan_tasks
│   ├── maintenance_plan_applicability
│   ├── parts_inventory
│   ├── parts_transactions
│   ├── vendors
│   └── vendor_ratings
│
├── compliance (Compliance & Safety)
│   ├── hos_logs
│   ├── hos_log_events                  (event store - tamper proof)
│   ├── hos_log_snapshots
│   ├── dvir_inspections
│   ├── dvir_inspection_events
│   ├── dvir_inspection_defects
│   ├── incidents
│   ├── incident_events
│   ├── compliance_records
│   └── safety_scores
│
├── trip (Trip & Route Management)
│   ├── trips
│   ├── trip_events                     (event store)
│   ├── trip_snapshots
│   ├── routes
│   ├── route_waypoints
│   ├── dispatches
│   ├── dispatch_events
│   ├── proofs_of_delivery
│   ├── loads
│   └── trip_milestones
│
├── fuel (Fuel Management)
│   ├── fuel_cards
│   ├── fuel_transactions
│   ├── fuel_stations
│   ├── fuel_station_networks
│   └── fuel_fraud_alerts
│
├── billing (Billing & Tenant Mgmt)
│   ├── tenants
│   ├── subscriptions
│   ├── invoices
│   ├── invoice_events
│   ├── invoice_line_items
│   ├── payments
│   ├── usage_meters
│   ├── usage_records
│   └── subscription_features
│
├── asset (Asset Lifecycle)
│   ├── vehicle_assets
│   ├── procurement_records
│   ├── depreciation_schedules
│   ├── depreciation_entries
│   ├── disposal_records
│   └── tco_calculations
│
├── notification (Notification & Alerting)
│   ├── alert_rules
│   ├── alert_rule_conditions
│   ├── notifications
│   ├── notification_events
│   ├── notification_preferences
│   ├── escalation_policies
│   └── escalation_steps
│
├── audit (Audit & Compliance Log)
│   ├── audit_entries
│   ├── retention_policies
│   ├── compliance_archives
│   └── data_retention_audit
│
└── shared (Cross-cutting entities)
    ├── tenants_summary (materialized view)
    └── event_outbox
```

### 2.2 Core Table Definitions

#### vehicles (fleet schema)

```sql
CREATE TABLE fleet.vehicles (
    vehicle_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    vin               VARCHAR(17) NOT NULL,
    make              VARCHAR(100) NOT NULL,
    model             VARCHAR(100) NOT NULL,
    year              INT NOT NULL,
    vehicle_type      VARCHAR(50) NOT NULL,
    fuel_type         VARCHAR(50) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'active',
    license_plate     VARCHAR(20),
    license_state    VARCHAR(10),
    license_country   VARCHAR(3) DEFAULT 'USA',
    odometer_km       BIGINT DEFAULT 0,
    odometer_updated  TIMESTAMP WITH TIME ZONE,
    fleet_id          UUID REFERENCES fleet.fleets(fleet_id),
    telematics_device_id UUID,
    acquisition_date  DATE,
    engine_hp         INT,
    tare_weight_kg    INT,
    gvwr_kg           INT,
    fuel_tank_liters   INT,
    seats             INT,
    axles             INT,
    custom_fields     JSONB DEFAULT '{}',
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by        UUID,
    updated_by        UUID,

    CONSTRAINT uq_vehicles_tenant_vin UNIQUE (tenant_id, vin),
    CONSTRAINT chk_vehicle_type CHECK (vehicle_type IN ('TRUCK','VAN','SEDAN','BUS','TRAILER','MOTORCYCLE','OTHER')),
    CONSTRAINT chk_vehicle_status CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE','DECOMMISSIONED','RETIRED','STOLEN','TOTALED')),
    CONSTRAINT chk_year CHECK (year >= 1900 AND year <= EXTRACT(YEAR FROM CURRENT_DATE) + 1)
);

-- Row-Level Security
ALTER TABLE fleet.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_tenant_isolation ON fleet.vehicles
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Indexes
CREATE INDEX idx_vehicles_tenant ON fleet.vehicles (tenant_id);
CREATE INDEX idx_vehicles_fleet ON fleet.vehicles (fleet_id);
CREATE INDEX idx_vehicles_status ON fleet.vehicles (status);
CREATE INDEX idx_vehicles_vin ON fleet.vehicles (vin);
CREATE INDEX idx_vehicles_type ON fleet.vehicles (vehicle_type);
CREATE INDEX idx_vehicles_custom_fields ON fleet.vehicles USING GIN (custom_fields);
CREATE INDEX idx_vehicles_created ON fleet.vehicles (created_at DESC);

-- Partitioning (for standard/professional tenants by tenant_id hash)
-- Enterprise tenants get dedicated schema on separate instance
```

#### fleets (fleet schema)

```sql
CREATE TABLE fleet.fleets (
    fleet_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    organization_id  UUID NOT NULL,
    name             VARCHAR(200) NOT NULL,
    description      TEXT,
    max_vehicles     INT DEFAULT 100,
    current_vehicles INT DEFAULT 0,
    status           VARCHAR(20) NOT NULL DEFAULT 'active',
    timezone         VARCHAR(50) DEFAULT 'UTC',
    region           VARCHAR(100),
    custom_settings  JSONB DEFAULT '{}',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by       UUID,
    updated_by       UUID,

    CONSTRAINT uq_fleets_tenant_org_name UNIQUE (tenant_id, organization_id, name),
    CONSTRAINT chk_fleet_status CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED'))
);

ALTER TABLE fleet.fleets ENABLE ROW LEVEL SECURITY;
CREATE POLICY fleets_tenant_isolation ON fleet.fleets
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE INDEX idx_fleets_tenant ON fleet.fleets (tenant_id);
CREATE INDEX idx_fleets_org ON fleet.fleets (organization_id);
```

#### event_outbox (shared schema)

```sql
CREATE TABLE shared.event_outbox (
    outbox_id       BIGSERIAL PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      VARCHAR(200) NOT NULL,
    event_data      JSONB NOT NULL,
    metadata        JSONB DEFAULT '{}',
    tenant_id       UUID NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_at    TIMESTAMP WITH TIME ZONE,
    status          VARCHAR(20) DEFAULT 'pending',

    CONSTRAINT chk_outbox_status CHECK (status IN ('pending','published','failed'))
);

CREATE INDEX idx_outbox_pending ON shared.event_outbox (created_at) WHERE status = 'pending';
CREATE INDEX idx_outbox_tenant ON shared.event_outbox (tenant_id);
CREATE INDEX idx_outbox_aggregate ON shared.event_outbox (aggregate_type, aggregate_id);

-- Outbox polling: Kafka Connect or Debezium CDC connector reads pending events
-- and publishes to Kafka, then marks as published
```

#### hos_log_events (compliance schema — Event Store)

```sql
CREATE TABLE compliance.hos_log_events (
    event_id         BIGSERIAL PRIMARY KEY,
    aggregate_id     UUID NOT NULL,
    event_type       VARCHAR(200) NOT NULL,
    event_data       JSONB NOT NULL,
    aggregate_version INT NOT NULL,
    previous_hash    VARCHAR(64),     -- SHA-256 hash of previous event
    current_hash     VARCHAR(64) NOT NULL, -- SHA-256 hash of this event
    tenant_id         UUID NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT uq_hos_event_version UNIQUE (aggregate_id, aggregate_version)
);

-- Hash chain: current_hash = SHA256(previous_hash + event_data)
-- This ensures tamper-proof integrity for FMCSA compliance

CREATE INDEX idx_hos_events_aggregate ON compliance.hos_log_events (aggregate_id, aggregate_version);
CREATE INDEX idx_hos_events_tenant ON compliance.hos_log_events (tenant_id);
```

---

## 3. TimescaleDB Schema Design

### 3.1 GPS Positions (Hypertable)

```sql
CREATE TABLE tracking.positions (
    time            TIMESTAMPTZ NOT NULL,
    vehicle_id      UUID NOT NULL,
    tenant_id        UUID NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    altitude        DOUBLE PRECISION,
    heading         SMALLINT,
    speed_kmh       REAL,
    accuracy_m      REAL,
    ignition_on     BOOLEAN,
    odometer_km     BIGINT,
    fuel_level_pct  REAL,
    engine_hours    REAL,
    metadata        JSONB DEFAULT '{}'
);

SELECT create_hypertable('tracking.positions', 'time',
    chunk_time_interval => INTERVAL '1 day',
    partitioning_column => 'tenant_id',
    number_partitions => 4,
    if_not_exists => TRUE
);

-- Compression: 7 days after write
ALTER TABLE tracking.positions SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id, tenant_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compress_chunk_policy('tracking.positions',
    compress_after => INTERVAL '7 days'
);

-- Retention: 90 days hot, then move to cold storage
SELECT add_retention_policy('tracking.positions',
    retention_period => INTERVAL '90 days',
    if_not_exists => TRUE
);

-- Indexes
CREATE INDEX idx_positions_vehicle_time ON tracking.positions (vehicle_id, time DESC);
CREATE INDEX idx_positions_tenant_time ON tracking.positions (tenant_id, time DESC);
```

### 3.2 Telemetry Sensor Data (Hypertable)

```sql
CREATE TABLE telemetry.sensor_data (
    time            TIMESTAMPTZ NOT NULL,
    device_id       UUID NOT NULL,
    vehicle_id      UUID NOT NULL,
    tenant_id        UUID NOT NULL,
    sensor_type     VARCHAR(50) NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    unit            VARCHAR(20),
    metadata        JSONB DEFAULT '{}'
);

SELECT create_hypertable('telemetry.sensor_data', 'time',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);
```

---

## 4. MongoDB Collections

### 4.1 Device Configurations

```javascript
// telemetry.devices
db.devices.createIndex({ serialNumber: 1 }, { unique: true })
db.devices.createIndex({ tenantId: 1, vehicleId: 1 })
db.devices.createIndex({ status: 1 })

Document Schema:
{
  _id: ObjectId,
  deviceId: UUID,
  serialNumber: "TL-2024-00123",
  imei: "490154203237518",
  tenantId: UUID,
  vehicleId: UUID | null,
  firmwareVersion: "3.2.1",
  hardwareVersion: "2.0",
  status: "active" | "inactive" | "provisioning" | "faulted",
  supportedSensors: ["gps", "obd", "accelerometer", "fuel_level"],
  configuration: {
    reportingIntervalMs: 1000,
    gpsAccuracyThreshold: 10,
    speedThresholds: { harshBraking: -6.0, rapidAcceleration: 4.0 },
    diagnosticCodes: ["P0300", "P0420", "P0700"],
    geofenceCheckIntervalMs: 5000
  },
  lastHeartbeat: ISODate,
  lastPosition: { lat, lng, speed, heading, timestamp },
  healthStatus: { batteryLevel, signalStrength, dataQuality },
  provisionedAt: ISODate,
  pairedAt: ISODate,
  metadata: {}
}
```

### 4.2 DVIR Inspections

```javascript
// compliance.inspections
db.inspections.createIndex({ tenantId: 1, vehicleId: 1, inspectionDate: -1 })
db.inspections.createIndex({ driverId: 1 })
db.inspections.createIndex({ status: 1 })

Document Schema:
{
  _id: ObjectId,
  inspectionId: UUID,
  tenantId: UUID,
  vehicleId: UUID,
  driverId: UUID,
  tripId: UUID | null,
  type: "PRE_TRIP" | "POST_TRIP",
  status: "completed" | "defects_found" | "rejected",
  inspectionDate: ISODate,
  odometerReading: 45230,
  defects: [
    {
      component: "brakes",
      location: "rear_driver_side",
      severity: "major",
      description: "Brake pad wear below minimum",
      photoIds: ["s3://...", "s3://..."],
      requiresImmediateAttention: false
    }
  ],
  totalDefects: 1,
  criticalDefects: 0,
  driverSignature: { data: "base64...", timestamp: ISODate },
  reviewedBy: UUID | null,
  reviewedAt: ISODate | null
}
```

---

## 5. ClickHouse Schema Design (OLAP)

### 5.1 Analytics Fact Tables

```sql
-- Fleet-wide vehicle activity summary (materialized from position events)
CREATE TABLE analytics.vehicle_activity_daily (
    date            Date,
    tenant_id       UUID,
    vehicle_id      UUID,
    fleet_id        UUID,
    driver_id       UUID,
    total_distance_km Float64,
    total_drive_time_sec UInt32,
    total_idle_time_sec UInt32,
    avg_speed_kmh   Float64,
    max_speed_kmh   Float64,
    fuel_consumed_liters Float64,
    harsh_braking_events UInt16,
    rapid_accel_events UInt16,
    geofence_entries UInt16,
    geofence_exits   UInt16,
    trips_completed UInt8,
    trips_cancelled UInt8
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, vehicle_id, date)
TTL date + INTERVAL 3 YEAR;

-- Driver behavior aggregation
CREATE TABLE analytics.driver_behavior_daily (
    date            Date,
    tenant_id       UUID,
    driver_id       UUID,
    behavior_score  Float32,
    total_distance_km Float64,
    total_drive_time_sec UInt32,
    harsh_braking_count UInt16,
    rapid_accel_count UInt16,
    harsh_cornering_count UInt16,
    speeding_count UInt16,
    idle_time_pct Float32,
    fatigue_events UInt8,
    hos_violations UInt8
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, driver_id, date)
TTL date + INTERVAL 3 YEAR;

-- Fuel analytics
CREATE TABLE analytics.fuel_consumption_daily (
    date            Date,
    tenant_id       UUID,
    vehicle_id      UUID,
    fleet_id        UUID,
    fuel_type       String,
    total_liters    Float64,
    total_cost      Decimal64(2),
    avg_mpg         Float64,
    avg_cost_per_liter Decimal64(2),
    station_count   UInt16,
    transaction_count UInt16,
    fraud_alert_count UInt8
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, vehicle_id, date)
TTL date + INTERVAL 3 YEAR;
```

---

## 6. Redis Data Structures

### 6.1 Key Design

```
# Session Management
session:{session_id}                     → Hash (user_id, tenant_id, expires_at, refresh_token)
tenant:sessions:{tenant_id}              → Set (active session_ids)

# Rate Limiting
ratelimit:{tenant_id}:{user_id}:{endpoint} → String (token count, TTL=window)

# Real-time Position Cache (latest position per vehicle)
position:{vehicle_id}                    → Hash (lat, lng, speed, heading, timestamp, ignition)
fleet:positions:{fleet_id}              → Sorted Set (vehicle_id → timestamp, for active tracking)

# Geofence Active List (per tenant)
geofences:{tenant_id}                    → Hash (geofence_id → boundary_json)

# Tenant Configuration Cache
tenant:config:{tenant_id}                → Hash (tier, features, quotas, rate_limits, timezone)

# Device Online Status
device:online:{device_id}               → String (timestamp, TTL=30s)
devices:online:{tenant_id}               → Set (device_ids online now)

# Outbox (alternative to DB polling for high-throughput services)
outbox:{service_name}                   → Stream (event_id, payload)

# Distributed Locks (for saga orchestration)
lock:{aggregate_type}:{aggregate_id}     → String (owner_id, TTL=30s)

# Usage Metering (atomic increments)
usage:{tenant_id}:{metric}:{period}     → String (count, TTL=end_of_period)
```

---

## 7. Data Flow Architecture

### 7.1 CQRS Write Path

```
Command Request
    │
    ▼
Aggregate Root
    │  1. Validate invariants
    │  2. Apply business rules
    │  3. Generate domain events
    │
    ├──► Write to Domain Table (PostgreSQL/MongoDB)
    │       INSERT INTO {schema}.{table} ...
    │
    └──► Write to Event Outbox (PostgreSQL)
            INSERT INTO shared.event_outbox (
                aggregate_type, aggregate_id, event_type, event_data, metadata, tenant_id
            ) VALUES (...)
            -- In same transaction (XA or savepoint)

Outbox Processor (Debezium CDC / Kafka Connect)
    │  Reads pending outbox events
    │  Publishes to Kafka topics
    │  Marks outbox entries as published
    │
    ▼
Kafka Topic: {domain}.{aggregate}.{event-type}.v{version}
```

### 7.2 CQRS Read Path

```
Kafka Topic
    │
    ▼
Projection Handler (per service)
    │  Consumes events
    │  Updates read model
    │
    ├──► PostgreSQL (operational read models)
    │       INSERT/UPDATE INTO {read_model_table} ...
    │
    ├──► ClickHouse (analytics materialized views)
    │       INSERT INTO analytics.{table} ...
    │
    ├──► Elasticsearch (search indices)
    │       POST /{index}/_doc/{id} ...
    │
    └──► Redis (cache invalidation)
            DEL position:{vehicle_id}
            SET position:{vehicle_id} {fields}
```

### 7.3 Data Retention

| Data | Hot Storage | Cold Storage | Total Retention |
|---|---|---|---|
| GPS Positions | TimescaleDB (90 days) | S3 Parquet (2 years) | 2 years |
| Telemetry Sensor Data | TimescaleDB (30 days) | S3 Parquet (1 year) | 1 year |
| Domain Events (Kafka) | Kafka (7 days) | S3 (7 years) | 7 years |
| HOS Logs | PostgreSQL (7 years) | S3 (7 years) | 7 years (FMCSA) |
| DVIR Inspections | MongoDB (3 years) | S3 (3 years) | 3 years |
| Financial Records | PostgreSQL (7 years) | S3 (7 years) | 7 years |
| Audit Logs | ClickHouse (90 days) | S3 (7 years) | 7 years |
| Analytics Aggregates | ClickHouse (3 years) | S3 (3 years) | 3 years |
| User Activity Logs | Elasticsearch (90 days) | S3 (1 year) | 1 year |

---

## 8. Backup & Recovery

### 8.1 Backup Strategy

| Data Store | Method | Frequency | Retention |
|---|---|---|---|
| PostgreSQL | WAL-G (continuous WAL + base backup) | Continuous (WAL), Daily (full) | 30 days |
| TimescaleDB | pg_dump + WAL-G | Daily | 30 days |
| MongoDB | mongodump | Daily | 30 days |
| Redis | RDB snapshots | Every 15 minutes | 7 days |
| ClickHouse | ClickHouse backup to S3 | Daily | 30 days |
| Elasticsearch | Snapshot API to S3 | Daily | 30 days |
| Kafka | Topic replication + S3 sink | Continuous | 90 days |
| S3/MinIO | Cross-region replication | Continuous | Per policy |

### 8.2 Disaster Recovery

| Scenario | RPO | RTO | Procedure |
|---|---|---|---|
| Single AZ failure | < 1 min | < 5 min | Automatic failover within cluster |
| Region failure | < 1 min | < 15 min | DNS failover to DR cluster |
| Database corruption | < 1 min | < 10 min | Point-in-time recovery via WAL |
| Accidental data deletion | < 5 min | < 30 min | PITR or snapshot restore |

---

## 9. Database Connection Management

### 9.1 Connection Pooling

| Service | Pool Type | Max Connections | Idle Timeout |
|---|---|---|---|
| Spring Boot Services | HikariCP (per service) | 20 per instance | 300s |
| Go Services | pgxpool | 30 per instance | 300s |
| Python Services | asyncpg pool | 15 per instance | 300s |
| Cross-service | PgBouncer (transaction mode) | 1000 per database | 60s |

### 9.2 Read/Write Splitting

```
Write (Primary) → PostgreSQL Primary (leader)
Read (Replica)  → PostgreSQL Replica(s) via PgBouncer
                   │
                   ├── Operational reads → Replica 1
                   └── Analytics reads → Replica 2
```
