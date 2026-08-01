# FleetVision Domain Model Specification

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect  

---

## Table of Contents

1. [Ubiquitous Language](#1-ubiquitous-language)
2. [Bounded Context Definitions](#2-bounded-context-definitions)
3. [Aggregate Design](#3-aggregate-design)
4. [Domain Events Catalog](#4-domain-events-catalog)
5. [Context Mapping](#5-context-mapping)
6. [Value Objects](#6-value-objects)
7. [Domain Services](#7-domain-services)
8. [Domain Rules & Invariants](#8-domain-rules--invariants)

---

## 1. Ubiquitous Language

### 1.1 Core Domain Vocabulary

| Term | Definition | Bounded Context |
|---|---|---|
| **Vehicle** | A tracked mobile asset uniquely identified by VIN, equipped with a telematics device, having an operational status, current location, and maintenance history | Fleet Management, Tracking |
| **Fleet** | A logical grouping of vehicles under a single management entity with shared policies, reporting lines, and operational rules | Fleet Management |
| **Vehicle Group** | A hierarchical categorization of vehicles by type, purpose, region, or custom criteria; used for policy application and reporting segmentation | Fleet Management |
| **Fleet Policy** | A set of operational rules applied to a fleet or vehicle group governing speed limits, geofence rules, HOS configurations, and maintenance schedules | Fleet Management, Compliance |
| **Telematics Device** | A physical hardware unit installed in a vehicle comprising a GPS receiver, cellular modem, OBD-II interface, accelerometer, and optional sensors | Telematics & Device Mgmt |
| **Driver** | A person authorized and qualified to operate vehicles within the system, possessing a valid license, certifications, and a behavioral profile | Driver Management |
| **Driver Profile** | A composite record of a driver's identity, qualifications, behavior scores, assignment history, and compliance status | Driver Management |
| **Behavior Score** | A numeric indicator (0-100) derived from driving events (harsh braking, rapid acceleration, speeding, cornering) reflecting overall driving safety | Driver Management, Tracking |
| **Trip** | A discrete operational journey of a vehicle from departure to arrival, with an assigned driver, planned route, and optionally associated loads and delivery confirmations | Trip & Route Management |
| **Route** | A planned path defined by an ordered sequence of waypoints and stops, with estimated times, distances, and constraints | Trip & Route Management |
| **Dispatch** | The act of assigning a trip to a driver and vehicle, triggering the trip lifecycle from planning to execution | Trip & Route Management |
| **Proof of Delivery (POD)** | A digital confirmation record of successful delivery including timestamp, geolocation, recipient signature, photos, and condition notes | Trip & Route Management |
| **Load** | A cargo assignment associated with a trip, including weight, dimensions, type, hazardous classification, and handling requirements | Trip & Route Management |
| **Geofence** | A virtual geographic boundary (polygon, circle, or corridor) that triggers defined actions when a vehicle enters, exits, or dwells within its perimeter | Tracking & Monitoring |
| **Position** | A point-in-time geographic coordinate with heading, speed, altitude, accuracy, and associated vehicle state metadata | Tracking & Monitoring |
| **Speed Event** | A recorded instance of a vehicle exceeding a defined speed threshold, with contextual data (location, speed limit, driver) | Tracking & Monitoring |
| **Alert** | A notification triggered by a defined rule or event requiring human attention, classified by severity and requiring acknowledgment | Notification & Alerting |
| **Maintenance Work Order** | A formal request for vehicle service, containing task descriptions, parts requirements, labor estimates, priority, and assignment | Vehicle Maintenance |
| **Maintenance Plan** | A scheduled template defining recurring maintenance tasks based on time intervals, mileage thresholds, or engine hours | Vehicle Maintenance |
| **Parts Inventory** | A catalog of spare parts with stock levels, reorder points, supplier information, and usage history | Vehicle Maintenance |
| **DVIR** | Driver Vehicle Inspection Report; a regulatory pre-trip and post-trip vehicle condition assessment required by FMCSA | Compliance & Safety |
| **HOS Log** | Hours of Service record tracking driver status (driving, on-duty, sleeper berth, off-duty) with location annotations | Compliance & Safety |
| **HOS Violation** | An event where a driver's logged activity exceeds regulatory HOS limits | Compliance & Safety |
| **Incident** | An unplanned event involving a vehicle, driver, or third party resulting in damage, injury, or regulatory breach | Compliance & Safety |
| **Fuel Transaction** | A recorded fuel purchase, transfer, or reconciliation event linked to a fuel card, vehicle, and driver | Fuel Management |
| **Fuel Card** | A payment instrument assigned to a driver or vehicle for authorized fuel purchases at network stations | Fuel Management |
| **Invoice** | A billing document sent to a tenant for platform usage, reflecting subscription fees, overage charges, and payment terms | Billing & Tenant Mgmt |
| **Subscription** | A tenant's contracted service tier defining feature access, vehicle limits, and billing rates | Billing & Tenant Mgmt |
| **Tenant** | An independent organizational entity operating on the platform with isolated data, configurable policies, and independent billing | Billing & Tenant Mgmt |
| **Organization** | A hierarchical structural unit within a tenant representing a division, department, or subsidiary | Identity & Access Mgmt |
| **User** | A person with platform access, belonging to an organization, holding one or more roles defining their permissions | Identity & Access Mgmt |
| **Role** | A named collection of permissions defining what actions a user can perform within the system | Identity & Access Mgmt |
| **Asset Lifecycle** | The full economic life of a vehicle from procurement through operation to disposal, tracked for total cost of ownership | Asset Lifecycle |

---

## 2. Bounded Context Definitions

### 2.1 Identity & Access Management Context

**Context Alias:** `identity`

**Responsibility:** User authentication, authorization, role management, organizational hierarchy, session management, SSO integration.

**Core Domain:** Supporting (shared kernel for all contexts)

**Domain Expert:** Security & IAM Team

**Strategic Classification:** Core

**Entities & Aggregates:**
- **User Aggregate** (Aggregate Root)
- **Role Aggregate** (Aggregate Root)
- **Organization Aggregate** (Aggregate Root)

**Key Invariants:**
- A user must belong to exactly one organization
- A role's permissions are a superset of any role it inherits from
- A user cannot be assigned permissions outside their organization's scope
- Password policy must satisfy tenant configuration requirements

**Ubiquitous Language:**
- User, Role, Permission, Organization, Session, Token, Authentication, Authorization, Principal, Credential, MFA, SSO, Federation

---

### 2.2 Fleet Management Context

**Context Alias:** `fleet`

**Responsibility:** Vehicle registration, fleet composition, vehicle grouping, fleet policy definition, vehicle-to-fleet assignment, organizational fleet hierarchies.

**Core Domain:** Core

**Domain Expert:** Fleet Operations Manager

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **Vehicle Aggregate** (Aggregate Root)
- **Fleet Aggregate** (Aggregate Root)
- **VehicleGroup Aggregate** (Aggregate Root)
- **FleetPolicy Aggregate** (Aggregate Root)

**Key Invariants:**
- A vehicle can belong to exactly one fleet at a time
- A fleet policy is valid only when all its rules are internally consistent
- Vehicle assignment to a fleet requires the fleet to have capacity
- A vehicle's VIN must be unique within the tenant
- A vehicle cannot be deleted if it has active trips or open maintenance orders

**Ubiquitous Language:**
- Vehicle, Fleet, VehicleGroup, FleetPolicy, Assignment, Capacity, VIN, Make, Model, Year, LicensePlate, Status, Retired, Decommissioned

---

### 2.3 Tracking & Monitoring Context

**Context Alias:** `tracking`

**Responsibility:** Real-time GPS position processing, geofence management and evaluation, speed monitoring, vehicle state tracking, live map data serving.

**Core Domain:** Core

**Domain Expert:** Tracking Engineer

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **VehicleTracker Aggregate** (Aggregate Root) — **Event Sourced**
- **Geofence Aggregate** (Aggregate Root)
- **TrackingSession Aggregate** (Aggregate Root)

**Key Invariants:**
- Position events must be processed within 10 seconds of receipt
- Geofence evaluation must complete within 20ms per position
- A vehicle can have at most one active tracking session
- Historical positions are immutable once persisted
- Geofence boundaries must be validated (no self-intersection, minimum area)

**Ubiquitous Language:**
- Position, Geofence, Polygon, Corridor, DwellZone, TrackingSession, SpeedEvent, Heading, Altitude, Accuracy, PointOfInterest, Landmark

---

### 2.4 Telematics & Device Management Context

**Context Alias:** `telemetry`

**Responsibility:** Telematics device lifecycle management, firmware OTA updates, device command execution, raw sensor data ingestion, device health monitoring.

**Core Domain:** Core

**Domain Expert:** IoT/Telematics Engineer

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **TelematicsDevice Aggregate** (Aggregate Root)
- **FirmwarePackage Aggregate** (Aggregate Root)
- **DeviceCommand Aggregate** (Aggregate Root)

**Key Invariants:**
- A device serial number must be globally unique
- A device can be assigned to only one vehicle at a time
- Firmware updates must be signed and verified before installation
- Device commands have a TTL and expire if not acknowledged
- Device health status is derived from heartbeat frequency and data quality

**Ubiquitous Language:**
- TelematicsDevice, SerialNumber, Firmware, OTA, Heartbeat, DeviceCommand, SensorData, DiagnosticCode, IMEI, Provisioning, Pairing, Unpairing

---

### 2.5 Vehicle Maintenance Context

**Context Alias:** `maintenance`

**Responsibility:** Preventive maintenance scheduling, corrective work orders, parts inventory management, vendor management, maintenance cost tracking.

**Core Domain:** Core

**Domain Expert:** Maintenance Manager

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **MaintenanceWorkOrder Aggregate** (Aggregate Root) — **Event Sourced**
- **MaintenancePlan Aggregate** (Aggregate Root)
- **PartsInventory Aggregate** (Aggregate Root)
- **Vendor Aggregate** (Aggregate Root)

**Key Invariants:**
- A work order must reference a valid vehicle
- Parts consumption cannot exceed available inventory
- A work order in "completed" status cannot be reopened
- Maintenance plans generate work orders only for vehicles matching their applicability criteria
- Vendor ratings are computed from completed work order feedback

**Ubiquitous Language:**
- WorkOrder, MaintenancePlan, PartsInventory, Vendor, PreventiveMaintenance, CorrectiveMaintenance, Inspection, Defect, LaborHours, PartsCost, EstimatedCost, ActualCost, Priority

---

### 2.6 Driver Management Context

**Context Alias:** `driver`

**Responsibility:** Driver onboarding, profile management, license and certification tracking, behavior scoring, driver assignment, fatigue management.

**Core Domain:** Core

**Domain Expert:** Driver Management / HR

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **DriverProfile Aggregate** (Aggregate Root)
- **LicenseRecord Aggregate** (Aggregate Root)
- **BehaviorAnalysis Aggregate** (Aggregate Root)

**Key Invariants:**
- A driver's license must be valid for them to be eligible for assignment
- Behavior score is a read-only computed value (derived from tracking events)
- A driver cannot be assigned to a trip if they have an active HOS violation
- License expiry warnings must be triggered 30, 14, and 7 days before expiration
- Driver deactivation must cascade to cancel all pending trip assignments

**Ubiquitous Language:**
- Driver, License, Certification, BehaviorScore, HarshBraking, RapidAcceleration, Cornering, IdleTime, Fatigue, Eligibility, Assignment, Onboarding, Offboarding

---

### 2.7 Trip & Route Management Context

**Context Alias:** `trip`

**Responsibility:** Trip planning, route optimization, dispatch management, load assignment, proof of delivery, trip execution monitoring.

**Core Domain:** Core

**Domain Expert:** Dispatch / Logistics Manager

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **Trip Aggregate** (Aggregate Root) — **Event Sourced**
- **Route Aggregate** (Aggregate Root)
- **Dispatch Aggregate** (Aggregate Root)
- **ProofOfDelivery Aggregate** (Aggregate Root)

**Key Invariants:**
- A trip must have exactly one vehicle and one primary driver
- A trip cannot be dispatched if the driver is not HOS-eligible
- A route's waypoints must form a valid path (no duplicated stops in sequence)
- POD requires at minimum a timestamp and geolocation
- Trip completion requires all mandatory stops to have been visited
- A vehicle cannot have overlapping active trips

**Ubiquitous Language:**
- Trip, Route, Waypoint, Stop, Dispatch, ETA, ETD, ActualArrival, ActualDeparture, ProofOfDelivery, Load, Shipment, Consignment, Manifest

---

### 2.8 Compliance & Safety Context

**Context Alias:** `compliance`

**Responsibility:** FMCSA ELD compliance, Hours of Service management, DVIR inspections, incident reporting, regulatory report generation, safety scoring.

**Core Domain:** Core

**Domain Expert:** Compliance Officer / Safety Manager

**Strategic Classification:** Core Domain

**Entities & Aggregates:**
- **HOSLog Aggregate** (Aggregate Root) — **Event Sourced**
- **DVIRInspection Aggregate** (Aggregate Root)
- **Incident Aggregate** (Aggregate Root)
- **ComplianceRecord Aggregate** (Aggregate Root)

**Key Invariants:**
- HOS logs must be tamper-proof (event sourced with cryptographic integrity)
- DVIR inspections must be completed before and after every trip
- Incidents must be reported within regulatory time limits
- Compliance records must be retained per regulatory requirements (minimum 6 months)
- Safety scores are computed per FMCSA CSA methodology

**Ubiquitous Language:**
- ELD, HOS, DVIR, Inspection, Defect, Incident, Violation, SafetyScore, CSA, RegulatoryReport, TamperProof, Annotation, Certification

---

### 2.9 Fuel Management Context

**Context Alias:** `fuel`

**Responsibility:** Fuel card management, fuel transaction processing, fuel consumption analytics, fuel fraud detection, fuel station network management.

**Core Domain:** Generic

**Domain Expert:** Fuel Program Manager

**Strategic Classification:** Generic (with core subdomain for fraud detection)

**Entities & Aggregates:**
- **FuelCard Aggregate** (Aggregate Root)
- **FuelTransaction Aggregate** (Aggregate Root)
- **FuelStation Aggregate** (Aggregate Root)

**Key Invariants:**
- A fuel card can be assigned to either a driver or a vehicle, not both simultaneously
- Fuel transactions must be matched to a vehicle's proximity at transaction time
- Fraud alerts are triggered when transaction patterns deviate from baseline
- Fuel card limits (daily, weekly, monthly) are enforced at authorization time
- A suspended fuel card cannot process new transactions

**Ubiquitous Language:**
- FuelCard, FuelTransaction, FuelType, Octane, Diesel, TransactionAuth, FraudAlert, ConsumptionRate, MilesPerGallon, FuelStation, NetworkDiscount

---

### 2.10 Analytics & Reporting Context

**Context Alias:** `analytics`

**Responsibility:** Dashboard data aggregation, custom report generation, predictive analytics, ML model management, data warehouse integration, executive KPI computation.

**Core Domain:** Generic

**Domain Expert:** Data Analyst / BI Engineer

**Strategic Classification:** Generic (with core subdomain for ML predictions)

**Entities & Aggregates:**
- **Dashboard Aggregate** (Aggregate Root)
- **ReportDefinition Aggregate** (Aggregate Root)
- **MLModel Aggregate** (Aggregate Root)
- **KPIDefinition Aggregate** (Aggregate Root)

**Key Invariants:**
- Dashboard data is materialized from domain events (eventual consistency acceptable)
- Reports are generated asynchronously and stored for retrieval
- ML models must pass validation thresholds before deployment to production
- KPI definitions are tenant-configurable but use a standardized computation framework

**Ubiquitous Language:**
- Dashboard, Widget, Report, Chart, Metric, KPI, Prediction, Anomaly, Trend, DataWarehouse, ETL, Pipeline, Model, Feature, Training, Inference

---

### 2.11 Asset Lifecycle Context

**Context Alias:** `asset`

**Responsibility:** Vehicle procurement, depreciation calculation, lifecycle stage management, disposal, total cost of ownership tracking, asset valuation.

**Core Domain:** Generic

**Domain Expert:** Asset Manager / Finance

**Strategic Classification:** Generic

**Entities & Aggregates:**
- **VehicleAsset Aggregate** (Aggregate Root)
- **ProcurementRecord Aggregate** (Aggregate Root)
- **DepreciationSchedule Aggregate** (Aggregate Root)
- **DisposalRecord Aggregate** (Aggregate Root)

**Key Invariants:**
- Asset lifecycle transitions follow a strict state machine (Ordered → InTransit → Received → Active → Maintenance → Retired → Disposed)
- Depreciation is computed monthly using the tenant's chosen method (straight-line, declining balance, units of production)
- Disposal requires final condition assessment and fair market valuation
- TCO is a computed value: acquisition cost + operating costs + maintenance costs - residual value

**Ubiquitous Language:**
- Acquisition, Depreciation, Disposal, ResidualValue, FairMarketValue, LifecycleStage, TotalCostOfOwnership, BookValue, CapitalExpenditure

---

### 2.12 Notification & Alerting Context

**Context Alias:** `notification`

**Core Domain:** Supporting (Infrastructure)

**Responsibility:** Multi-channel notification delivery (email, SMS, push, in-app), alert rule management, alert escalation, notification preferences, delivery tracking.

**Entities & Aggregates:**
- **AlertRule Aggregate** (Aggregate Root)
- **Notification Aggregate** (Aggregate Root)
- **EscalationPolicy Aggregate** (Aggregate Root)
- **NotificationPreference Aggregate** (Aggregate Root)

**Key Invariants:**
- Alert rules are tenant-scoped and cannot cross tenant boundaries
- Notifications must be delivered at-least-once (idempotent processing)
- Escalation policies define a time-based chain: unacknowledged alerts escalate per schedule
- User preferences override system defaults for notification channels
- Rate limiting applies to prevent notification fatigue (max N per hour per user)

---

### 2.13 Billing & Tenant Management Context

**Context Alias:** `billing`

**Core Domain:** Supporting (Core for revenue)

**Responsibility:** Tenant onboarding, subscription management, usage metering, invoice generation, payment processing, feature flags per tier.

**Entities & Aggregates:**
- **Tenant Aggregate** (Aggregate Root)
- **Subscription Aggregate** (Aggregate Root)
- **Invoice Aggregate** (Aggregate Root)
- **UsageMeter Aggregate** (Aggregate Root)

**Key Invariants:**
- A tenant's subscription tier determines feature access and resource quotas
- Usage meters increment atomically to prevent double-billing
- Invoices are generated on the billing cycle date and are immutable once issued
- Over-quota usage is tracked and either blocked or billed at overage rates per tenant configuration
- Tenant suspension freezes all services but preserves data for 90 days

---

### 2.14 Audit & Compliance Log Context

**Context Alias:** `audit`

**Core Domain:** Supporting (Infrastructure)

**Responsibility:** Immutable audit trail of all system actions, compliance record archival, data retention enforcement, audit query interface.

**Entities & Aggregates:**
- **AuditEntry Aggregate** (Append-Only)
- **RetentionPolicy Aggregate** (Aggregate Root)
- **ComplianceArchive Aggregate** (Aggregate Root)

**Key Invariants:**
- Audit entries are append-only; no modification or deletion is permitted
- All cross-service operations produce audit entries
- Retention policies enforce automated data purging per regulatory and tenant requirements
- Compliance archives are cryptographically integrity-verified

---

## 3. Aggregate Design

### 3.1 Vehicle Aggregate (Fleet Management Context)

```
┌─────────────────────────────────────────────────────────┐
│                    VEHICLE AGGREGATE                     │
│                    (Aggregate Root)                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Vehicle                                              │ │
│  │ • vehicleId: VehicleId (UUID)                      │ │
│  │ • vin: VIN (Value Object)                           │ │
│  │ • make: string                                      │ │
│  │ • model: string                                     │ │
│  │ • year: int                                         │ │
│  │ • licensePlate: LicensePlate (Value Object)         │ │
│  │ • vehicleType: VehicleType (Enum)                  │ │
│  │ • fuelType: FuelType (Enum)                         │ │
│  │ • status: VehicleStatus (Enum)                     │ │
│  │ • odometerReading: OdometerReading (Value Object)  │ │
│  │ • telematicsDeviceId: DeviceId? (reference)          │ │
│  │ • fleetId: FleetId (reference)                      │ │
│  │ • tenantId: TenantId                                │ │
│  │ • acquisitionDate: Instant                          │ │
│  │ • specifications: VehicleSpecs (Value Object)       │ │
│  │ • customFields: Map<string, string>                 │ │
│  │                                                      │ │
│  │ BEHAVIORS:                                           │ │
│  │ + register(vin, make, model, year, ...)             │ │
│  │ + assignToFleet(fleetId)                            │ │
│  │ + removeFromFleet()                                  │ │
│  │ + updateOdometer(reading)                            │ │
│  │ + assignTelematicsDevice(deviceId)                  │ │
│  │ + decommission(reason)                              │ │
│  │ + retire(reason)                                     │ │
│  │ + updateLicensePlate(plate)                          │ │
│  └───────────────────────────────────────────────────┘ │
│                                                          │
│  VALUE OBJECTS:                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ VIN           │ │ LicensePlate │ │ Odometer     │   │
│  │ - value       │ │ - number     │ │ Reading      │   │
│  │ - checksum    │ │ - state      │ │ - km/miles   │   │
│  │ - country    │ │ - country    │ │ - timestamp  │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐                     │
│  │ VehicleType  │ │ VehicleSpecs │                     │
│  │ - TRUCK      │ │ - engineHP   │                     │
│  │ - VAN        │ │ - tareWeight │                     │
│  │ - SEDAN      │ │ - gvwr       │                     │
│  │ - BUS        │ │ - fuelTankL  │                     │
│  │ - TRAILER    │ │ - seats      │                     │
│  │ - MOTORCYCLE │ │ - axles      │                     │
│  └──────────────┘ └──────────────┘                     │
│                                                          │
│  ENUMS:                                                  │
│  VehicleStatus: ACTIVE, INACTIVE, MAINTENANCE,         │
│    DECOMMISSIONED, RETIRED, STOLEN, TOTALED              │
│                                                          │
│  INVARIANTS:                                             │
│  I1: VIN uniqueness within tenant                        │
│  I2: Status transition rules (state machine)            │
│  I3: Fleet assignment requires fleet capacity            │
│  I4: Telematics device single-assignment                 │
│                                                          │
│  DOMAIN EVENTS:                                          │
│  → VehicleRegistered                                     │
│  → VehicleAssignedToFleet                                │
│  → VehicleRemovedFromFleet                               │
│  → VehicleStatusChanged                                  │
│  → VehicleDecommissioned                                 │
│  → VehicleRetired                                        │
│  → VehicleSpecsUpdated                                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Trip Aggregate (Trip & Route Management Context) — Event Sourced

```
┌─────────────────────────────────────────────────────────┐
│                    TRIP AGGREGATE                        │
│              (Aggregate Root - Event Sourced)             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Trip (Event Sourced)                               │ │
│  │ • tripId: TripId (UUID)                            │ │
│  │ • vehicleId: VehicleId (reference)                  │ │
│  │ • driverId: DriverId (reference)                    │ │
│  │ • routeId: RouteId (reference)                      │ │
│  │ • status: TripStatus (Enum)                        │ │
│  │ • tenantId: TenantId                               │ │
│  │ • plannedDeparture: Instant                         │ │
│  │ • plannedArrival: Instant                           │ │
│  │ • actualDeparture: Instant?                         │ │
│  │ • actualArrival: Instant?                           │ │
│  │ • loadId: LoadId? (reference)                       │ │
│  │ • dispatchId: DispatchId (reference)                │ │
│  │ • milestones: List<Milestone>                       │ │
│  │                                                      │ │
│  │ BEHAVIORS:                                           │ │
│  │ + plan(vehicleId, driverId, routeId, ...)           │ │
│  │ + dispatch(dispatchId)                               │ │
│  │ + start()                                            │ │
│  │ + arriveAtStop(stopId, timestamp, location)          │ │
│  │ + departFromStop(stopId, timestamp)                 │ │
│  │ + complete(podData)                                  │ │
│  │ + cancel(reason)                                     │ │
│  │ + divert(newRouteId, reason)                         │ │
│  │ + updateETA(newEta, reason)                          │ │
│  └───────────────────────────────────────────────────┘ │
│                                                          │
│  STATE MACHINE:                                          │
│  PLANNED → DISPATCHED → IN_PROGRESS → COMPLETED          │
│    │           │            │           ↑                │
│    └───────────┼────────────┼───────────┘                │
│                ▼            ▼                             │
│              CANCELLED     DIVERTED                      │
│                                                          │
│  EVENT STREAM:                                           │
│  TripPlanned → TripDispatched → TripStarted →            │
│    TripStopArrived → TripStopDeparted → ... →            │
│    TripPODSubmitted → TripCompleted                      │
│                                                          │
│  DOMAIN EVENTS:                                          │
│  → TripPlanned                                           │
│  → TripDispatched                                        │
│  → TripStarted                                           │
│  → TripStopArrived                                       │
│  → TripStopDeparted                                      │
│  → TripDiverted                                          │
│  → TripETAUpdated                                        │
│  → TripPODSubmitted                                      │
│  → TripCompleted                                         │
│  → TripCancelled                                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.3 HOSLog Aggregate (Compliance & Safety Context) — Event Sourced

```
┌─────────────────────────────────────────────────────────┐
│                    HOS LOG AGGREGATE                    │
│              (Aggregate Root - Event Sourced)             │
│                    TAMPER-PROOF                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────────────────────────────────────────────┐ │
│  │ HOSLog                                              │ │
│  │ • hosLogId: HOSLogId (UUID)                        │ │
│  │ • driverId: DriverId                                │ │
│  │ • vehicleId: VehicleId                              │ │
│  │ • tenantId: TenantId                               │ │
│  │ • date: LocalDate                                   │ │
│  │ • dutyStatus: DutyStatus (current)                 │ │
│  │ • drivingMinutesRemaining: int                     │ │
│  │ • dutyMinutesRemaining: int                         │ │
│  │ • cycleMinutesRemaining: int                        │ │
│  │ • restBreakRequired: boolean                        │ │
│  │ • entries: List<HOSLogEntry>                        │ │
│  │ • annotations: List<HOSAnnotation>                  │ │
│  │ • previousLogHash: string (blockchain integrity)    │ │
│  │ • currentLogHash: string (blockchain integrity)    │ │
│  │                                                      │ │
│  │ BEHAVIORS:                                           │ │
│  │ + startDutyShift(status, location, vehicleId)       │ │
│  │ + changeDutyStatus(newStatus, location, reason)     │ │
│  │ + certifyLog(driverSignature)                        │ │
│  │ + annotate(annotation)                               │ │
│  │ + checkCompliance() → ComplianceCheckResult          │ │
│  └───────────────────────────────────────────────────┘ │
│                                                          │
│  DUTY STATUS:                                           │
│  OFF_DUTY, SLEEPER_BERTH, DRIVING, ON_DUTY_NOT_DRIVING  │
│                                                          │
│  HOS RULES (FMCSA Property Carrier):                    │
│  - 11-hour driving limit within 14-hour window            │
│  - 30-minute break required after 8 cumulative hours     │
│  - 60-hour/7-day or 70-hour/8-day cycle limits           │
│  - 34-hour restart available after cycle exhaustion       │
│                                                          │
│  INTEGRITY: Hash chain: each entry hashes the previous   │
│  entry + event data → tamper evidence detection           │
│                                                          │
│  DOMAIN EVENTS:                                          │
│  → HOSLogStarted                                        │
│  → HOSDutyStatusChanged                                 │
│  → HOSLogCertified                                      │
│  → HOSAnnotationAdded                                    │
│  → HOSViolationDetected                                  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.4 Complete Aggregate Inventory

| # | Aggregate Root | Context | Event Sourced? | Persistent Store |
|---|---|---|---|---|
| 1 | Vehicle | Fleet Management | No | PostgreSQL |
| 2 | Fleet | Fleet Management | No | PostgreSQL |
| 3 | VehicleGroup | Fleet Management | No | PostgreSQL |
| 4 | FleetPolicy | Fleet Management | No | PostgreSQL |
| 5 | VehicleTracker | Tracking & Monitoring | Yes | TimescaleDB + Event Store |
| 6 | Geofence | Tracking & Monitoring | No | PostgreSQL (PostGIS) |
| 7 | TrackingSession | Tracking & Monitoring | Yes | TimescaleDB |
| 8 | TelematicsDevice | Telematics & Device Mgmt | No | MongoDB |
| 9 | FirmwarePackage | Telematics & Device Mgmt | No | S3/MinIO |
| 10 | DeviceCommand | Telematics & Device Mgmt | Yes | MongoDB |
| 11 | MaintenanceWorkOrder | Vehicle Maintenance | Yes | PostgreSQL + Event Store |
| 12 | MaintenancePlan | Vehicle Maintenance | No | PostgreSQL |
| 13 | PartsInventory | Vehicle Maintenance | No | PostgreSQL |
| 14 | Vendor | Vehicle Maintenance | No | PostgreSQL |
| 15 | DriverProfile | Driver Management | No | MongoDB |
| 16 | LicenseRecord | Driver Management | No | PostgreSQL |
| 17 | BehaviorAnalysis | Driver Management | No | ClickHouse |
| 18 | Trip | Trip & Route Mgmt | Yes | PostgreSQL + Event Store |
| 19 | Route | Trip & Route Mgmt | No | PostgreSQL (PostGIS) |
| 20 | Dispatch | Trip & Route Mgmt | Yes | PostgreSQL + Event Store |
| 21 | ProofOfDelivery | Trip & Route Mgmt | Yes | MongoDB |
| 22 | HOSLog | Compliance & Safety | Yes | PostgreSQL + Event Store |
| 23 | DVIRInspection | Compliance & Safety | Yes | MongoDB |
| 24 | Incident | Compliance & Safety | Yes | PostgreSQL + Event Store |
| 25 | ComplianceRecord | Compliance & Safety | No | PostgreSQL |
| 26 | FuelCard | Fuel Management | No | PostgreSQL |
| 27 | FuelTransaction | Fuel Management | No | PostgreSQL |
| 28 | FuelStation | Fuel Management | No | PostgreSQL |
| 29 | Dashboard | Analytics & Reporting | No | ClickHouse |
| 30 | ReportDefinition | Analytics & Reporting | No | PostgreSQL |
| 31 | MLModel | Analytics & Reporting | No | S3/MinIO + PostgreSQL |
| 32 | VehicleAsset | Asset Lifecycle | No | PostgreSQL |
| 33 | ProcurementRecord | Asset Lifecycle | No | PostgreSQL |
| 34 | DepreciationSchedule | Asset Lifecycle | No | PostgreSQL |
| 35 | DisposalRecord | Asset Lifecycle | No | PostgreSQL |
| 36 | AlertRule | Notification & Alerting | No | PostgreSQL |
| 37 | Notification | Notification & Alerting | Yes | MongoDB |
| 38 | EscalationPolicy | Notification & Alerting | No | PostgreSQL |
| 39 | Tenant | Billing & Tenant Mgmt | No | PostgreSQL |
| 40 | Subscription | Billing & Tenant Mgmt | No | PostgreSQL |
| 41 | Invoice | Billing & Tenant Mgmt | Yes | PostgreSQL + Event Store |
| 42 | UsageMeter | Billing & Tenant Mgmt | No | Redis + PostgreSQL |
| 43 | AuditEntry | Audit & Compliance Log | Append-Only | ClickHouse |
| 44 | RetentionPolicy | Audit & Compliance Log | No | PostgreSQL |

---

## 4. Domain Events Catalog

### 4.1 Fleet Management Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `fleet.vehicle.registered.v1` | Fleet Mgmt Service | Tracking, Billing, Audit | New vehicle created |
| `fleet.vehicle.assigned.v1` | Fleet Mgmt Service | Tracking, Analytics, Audit | Vehicle assigned to fleet |
| `fleet.vehicle.removed.v1` | Fleet Mgmt Service | Tracking, Analytics, Audit | Vehicle removed from fleet |
| `fleet.vehicle.status-changed.v1` | Fleet Mgmt Service | All (state change), Analytics | Status transition |
| `fleet.vehicle.decommissioned.v1` | Fleet Mgmt Service | Tracking, Billing, Asset Lifecycle | Vehicle decommissioned |
| `fleet.vehicle.retired.v1` | Fleet Mgmt Service | Asset Lifecycle, Audit | Vehicle retired from service |

### 4.2 Tracking Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `tracking.position.updated.v1` | Tracking Service | Analytics, Geofence eval, Compliance | GPS position received |
| `tracking.geofence.entered.v1` | Tracking Service | Notification, Trip, Analytics | Vehicle enters geofence |
| `tracking.geofence.exited.v1` | Tracking Service | Notification, Trip, Analytics | Vehicle exits geofence |
| `tracking.geofence.dwell.v1` | Tracking Service | Notification, Compliance | Vehicle dwells in geofence |
| `tracking.speed.exceeded.v1` | Tracking Service | Notification, Driver Mgmt, Compliance | Speed threshold breach |
| `tracking.ignition.on.v1` | Telemetry Ingestion | Tracking, Compliance, Trip | Ignition detected on |
| `tracking.ignition.off.v1` | Telemetry Ingestion | Tracking, Compliance, Trip | Ignition detected off |
| `tracking.trip.started.v1` | Tracking Service | Trip Mgmt, Compliance | Movement detected |

### 4.3 Telemetry Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `telemetry.device.provisioned.v1` | Device Mgmt Service | Fleet Mgmt, Audit | Device paired to vehicle |
| `telemetry.device.heartbeat.v1` | Telemetry Ingestion | Device Mgmt (health) | Heartbeat received |
| `telemetry.diagnostic.triggered.v1` | Telemetry Ingestion | Vehicle Maintenance, Notification | DTC code received |
| `telemetry.firmware.update.started.v1` | Device Mgmt Service | Device (MQTT), Audit | OTA initiated |
| `telemetry.firmware.update.completed.v1` | Device Mgmt Service | Audit | OTA completed |
| `telemetry.firmware.update.failed.v1` | Device Mgmt Service | Notification, Audit | OTA failed |
| `telemetry.sensor-data.received.v1` | Telemetry Ingestion | Analytics, Maintenance | Sensor data batch |

### 4.4 Maintenance Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `maintenance.workorder.created.v1` | Maintenance Service | Notification, Analytics, Audit | Work order created |
| `maintenance.workorder.assigned.v1` | Maintenance Service | Notification | Technician assigned |
| `maintenance.workorder.status-changed.v1` | Maintenance Service | Fleet Mgmt, Analytics, Notification | Status update |
| `maintenance.workorder.completed.v1` | Maintenance Service | Fleet Mgmt (vehicle status), Billing | Work completed |
| `maintenance.plan.triggered.v1` | Maintenance Service (scheduler) | Maintenance Service | Plan threshold met |

### 4.5 Driver Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `driver.profile.created.v1` | Driver Mgmt Service | Identity, Audit | Driver onboarded |
| `driver.profile.deactivated.v1` | Driver Mgmt Service | Trip Mgmt, Compliance, Notification | Driver deactivated |
| `driver.license.expiring.v1` | Driver Mgmt Service (scheduler) | Notification, Compliance | License near expiry |
| `driver.license.expired.v1` | Driver Mgmt Service (scheduler) | Compliance, Notification, Fleet Mgmt | License expired |
| `driver.behavior-score.updated.v1` | Analytics Engine | Driver Mgmt, Notification, Compliance | Score recomputed |
| `driver.fatigue.detected.v1` | Telemetry Ingestion / Analytics | Notification, Compliance, Driver Mgmt | Fatigue indicator detected |

### 4.6 Trip Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `trip.planned.v1` | Trip Mgmt Service | Dispatch, Fleet Mgmt | Trip planned |
| `trip.dispatched.v1` | Trip Mgmt Service | Tracking, Compliance, Notification | Trip dispatched |
| `trip.started.v1` | Trip Mgmt Service | Tracking, Compliance | Trip begun |
| `trip.stop.arrived.v1` | Trip Mgmt Service | Notification | Stop reached |
| `trip.stop.departed.v1` | Trip Mgmt Service | Tracking | Stop departed |
| `trip.eta.updated.v1` | Trip Mgmt Service | Notification, Analytics | ETA changed |
| `trip.pod.submitted.v1` | Trip Mgmt Service | Notification, Analytics | POD recorded |
| `trip.completed.v1` | Trip Mgmt Service | Billing, Analytics, Compliance, Fleet Mgmt | Trip ended |
| `trip.cancelled.v1` | Trip Mgmt Service | Notification, Billing | Trip cancelled |

### 4.7 Compliance Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `compliance.hos.violation.v1` | Compliance Service | Notification, Driver Mgmt, Analytics | HOS rule breach |
| `compliance.dvir.completed.v1` | Compliance Service | Maintenance, Notification | Inspection completed |
| `compliance.dvir.defect-found.v1` | Compliance Service | Maintenance, Notification | Defect identified |
| `compliance.incident.reported.v1` | Compliance Service | Notification, Billing, Analytics | Incident reported |
| `compliance.eld.malfunction.v1` | Telemetry Ingestion | Notification, Compliance | ELD device failure |

### 4.8 Fuel Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `fuel.card.issued.v1` | Fuel Mgmt Service | Driver Mgmt, Audit | Card issued |
| `fuel.card.suspended.v1` | Fuel Mgmt Service | Driver Mgmt, Notification | Card suspended |
| `fuel.transaction.completed.v1` | Fuel Mgmt Service | Billing, Analytics, Audit | Transaction processed |
| `fuel.fraud.detected.v1` | Fuel Mgmt Service | Notification, Billing, Audit | Fraud pattern detected |

### 4.9 Billing Events

| Event | Producer | Consumer(s) | Trigger |
|---|---|---|---|
| `billing.tenant.provisioned.v1` | Billing Service | All (tenant setup), Audit | New tenant created |
| `billing.subscription.activated.v1` | Billing Service | All (feature unlock), Notification | Subscription starts |
| `billing.invoice.generated.v1` | Billing Service | Notification, Audit | Invoice issued |
| `billing.invoice.overdue.v1` | Billing Service (scheduler) | Notification | Invoice past due |
| `billing.quota.exceeded.v1` | Usage Meter | Notification, API Gateway (rate limit) | Quota breach |

---

## 5. Context Mapping

### 5.1 Context Relationship Map

```
                    ┌───────────────────┐
                    │   IDENTITY (IAM)  │
                    │   Shared Kernel   │
                    └─────────┬─────────┘
                              │
                    U/D ──────┤
                              │
         ┌────────────────────┼──────────────────────┐
         │                    │                       │
         ▼                    ▼                       ▼
┌─────────────────┐ ┌─────────────────┐    ┌─────────────────┐
│  FLEET MGMT     │ │  TRACKING       │    │  TELEMETRY      │
│  Core            │ │  Core            │    │  Core            │
└────────┬────────┘ └────────┬────────┘    └────────┬────────┘
         │                   │                       │
         │  U/D             O-H                     │
         │                   │                       │
         ▼                   ▼                       ▼
┌─────────────────┐ ┌─────────────────┐    ┌─────────────────┐
│  TRIP & ROUTE   │◄┤  COMPLIANCE     │    │  MAINTENANCE     │
│  Core            │ │  Core            │    │  Core            │
└────────┬────────┘ └────────┬────────┘    └─────────────────┘
         │                   │
         ▼                   ▼
┌─────────────────┐ ┌─────────────────┐    ┌─────────────────┐
│  DRIVER MGMT    │ │  NOTIFICATION   │◄───│  ANALYTICS       │
│  Core            │ │  Infrastructure │    │  Generic         │
└────────┬────────┘ └─────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  FUEL MGMT      │    │  BILLING         │    │  ASSET LIFECYCLE │
│  Generic         │    │  Core (Revenue)  │    │  Generic         │
└─────────────────┘    └────────┬────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  AUDIT LOG      │
                       │  Infrastructure │
                       └─────────────────┘
```

### 5.2 Context Mapping Patterns Used

| Relationship | From | To | Pattern | Description |
|---|---|---|---|---|
| Shared Kernel | Identity | All Contexts | **Shared Kernel** | Tenant ID, User ID, Organization ID are shared primitives |
| Upstream-Downstream | Fleet Mgmt | Tracking | **U/D** | Fleet Mgmt publishes vehicle/fleet data; Tracking consumes |
| Upstream-Downstream | Identity | All Contexts | **U/D** | Identity publishes user/role changes; all services consume |
| Open Host Service | Analytics | All Contexts | **OHS** | Analytics publishes standardized KPI/events to all |
| Anti-Corruption Layer | External Integrations | All Contexts | **ACL** | External data translated via adapters |
| Conformist | Compliance | Regulatory Bodies | **Conformist** | Compliance conforms to FMCSA/DOT data formats |
| Customer-Supplier | Billing | All Services | **C/S** | Billing provides usage metering API; services must conform |
| Published Language | All Services | All Services | **PL** | Kafka event schemas are the published language |

---

## 6. Value Objects

### 6.1 Cross-Context Value Objects (Shared Kernel)

| Value Object | Fields | Used In |
|---|---|---|
| `TenantId` | `value: UUID` | All contexts |
| `OrganizationId` | `value: UUID` | Identity, Fleet Mgmt, Billing |
| `UserId` | `value: UUID` | Identity, Audit, Notification |
| `Money` | `amount: BigDecimal, currency: Currency` | Billing, Fuel Mgmt, Asset Lifecycle, Maintenance |
| `GeoCoordinate` | `latitude: BigDecimal, longitude: BigDecimal` | Tracking, Trip, Compliance |
| `Address` | `street, city, state, postalCode, country` | Fleet Mgmt, Billing, Maintenance |
| `EmailAddress` | `value: String (validated)` | Identity, Driver Mgmt, Notification |
| `PhoneNumber` | `value: String (E.164 format)` | Identity, Driver Mgmt, Notification |
| `TimeRange` | `start: Instant, end: Instant` | Trip, Compliance, Analytics |
| `Percentage` | `value: BigDecimal (0-100)` | Analytics, Driver Mgmt |

### 6.2 Context-Specific Value Objects

**Fleet Management:**
| Value Object | Description |
|---|---|
| `VIN` | Vehicle Identification Number (17-char, validated, checksum) |
| `LicensePlate` | State + plate number + country |
| `OdometerReading` | Value + unit (km/miles) + timestamp |
| `VehicleSpecs` | Engine HP, tare weight, GVWR, fuel tank capacity, seats, axles |

**Tracking & Monitoring:**
| Value Object | Description |
|---|---|
| `Position` | Latitude, longitude, altitude, heading, speed, accuracy, timestamp |
| `GeofenceBoundary` | Polygon (list of coordinates) or Circle (center + radius) or Corridor (line + width) |
| `SpeedThreshold` | Absolute speed (km/h) or percentage over limit |

**Compliance & Safety:**
| Value Object | Description |
|---|---|
| `DutyStatus` | OFF_DUTY, SLEEPER_BERTH, DRIVING, ON_DUTY_NOT_DRIVING |
| `HOSRuleSet` | FMCSA Property Carrier, FMCSA Passenger Carrier, Custom |
| `InspectionType` | PRE_TRIP, POST_TRIP, INTERMITTENT |
| `DefectSeverity` | CRITICAL, MAJOR, MINOR |

---

## 7. Domain Services

### 7.1 Domain Service Inventory

| Service | Context | Responsibility |
|---|---|---|
| `FleetAssignmentService` | Fleet Mgmt | Orchestrates vehicle-to-fleet assignment with capacity validation |
| `GeofenceEvaluationService` | Tracking | Evaluates position against all active geofences (high-performance) |
| `RouteOptimizationService` | Trip & Route | Computes optimal routes using external mapping API |
| `HOSComplianceChecker` | Compliance | Real-time HOS rule evaluation against driver logs |
| `BehaviorScoringEngine` | Driver Mgmt | Computes behavior scores from aggregated driving events |
| `FuelFraudDetector` | Fuel Mgmt | ML-based anomaly detection on fuel transactions |
| `MaintenanceScheduler` | Maintenance | Generates work orders from maintenance plans based on vehicle mileage/time |
| `PredictiveMaintenanceEngine` | Maintenance | ML model inference for failure prediction |
| `TCOCalculator` | Asset Lifecycle | Computes total cost of ownership from all cost dimensions |
| `QuotaEnforcementService` | Billing | Real-time enforcement of tenant resource quotas |
| `TenantProvisioningService` | Billing | Orchestrates new tenant setup across all bounded contexts |
| `ComplianceReportGenerator` | Compliance | Generates regulatory reports in required formats |
| `AlertRoutingService` | Notification | Routes alerts to appropriate channels and escalation chains |
| `DriverEligibilityChecker` | Driver Mgmt | Determines if a driver is eligible for trip assignment |
| `IncidentWorkflowService` | Compliance | Orchestrates incident reporting, investigation, and resolution |

---

## 8. Domain Rules & Invariants

### 8.1 Invariant Catalog

| ID | Invariant | Context | Enforcement | Severity |
|---|---|---|---|---|
| INV-F01 | VIN must be unique within tenant scope | Fleet Mgmt | Database unique constraint + application validation | Error |
| INV-F02 | Vehicle status follows strict state machine transitions | Fleet Mgmt | Aggregate root enforcement | Error |
| INV-F03 | Vehicle cannot be deleted with active trips or open work orders | Fleet Mgmt | Aggregate root check + event subscription | Error |
| INV-T01 | GPS positions processed within 10 seconds | Tracking | SLI monitoring + KEDA autoscaling | SLA breach |
| INV-T02 | Geofence evaluation completes within 20ms | Tracking | Performance budget + circuit breaker | SLA breach |
| INV-C01 | HOS logs are cryptographically tamper-proof | Compliance | Hash chain on every append | Critical |
| INV-C02 | DVIR must be completed before trip start | Compliance | Trip aggregate validation | Error |
| INV-C03 | HOS violations cannot be retroactively removed | Compliance | Event sourcing + append-only | Critical |
| INV-D01 | Inactive/expired license prevents driver assignment | Driver Mgmt | Eligibility check before dispatch | Error |
| INV-TR01 | A vehicle cannot have overlapping active trips | Trip & Route | Aggregate root validation | Error |
| INV-TR02 | Trip dispatch requires HOS-eligible driver | Trip & Route | Saga orchestration + eligibility check | Error |
| INV-M01 | Parts consumption cannot exceed available inventory | Maintenance | Aggregate root + optimistic locking | Error |
| INV-M02 | Completed work orders are immutable | Maintenance | Event sourcing | Error |
| INV-FC01 | Fuel card limits enforced at authorization | Fuel Mgmt | Pre-authorization check | Error |
| INV-FC02 | Suspended fuel card blocks transactions | Fuel Mgmt | Card status check | Error |
| INV-B01 | Invoices are immutable once generated | Billing | Event sourcing | Critical |
| INV-B02 | Usage meters increment atomically | Billing | Redis INCR + PostgreSQL idempotency | Error |
| INV-A01 | Audit entries are append-only, never modified | Audit | Event sourcing + write-only access | Critical |
| INV-A02 | All cross-service operations produce audit entries | Audit | Kafka consumer on all event topics | Critical |
| INV-I01 | Tenant data isolation enforced at all layers | Billing/Identity | RLS + service mesh + API gateway | Critical |
