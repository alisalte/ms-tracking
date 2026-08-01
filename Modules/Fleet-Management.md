# Fleet Management Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Fleet Management
**Service:** `fleet-management-service`
**Data Store:** PostgreSQL 16
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

The Fleet Management context is the central organizational hub for managing vehicle fleets. It handles fleet creation, vehicle group management, vehicle-to-fleet assignment, fleet policies, and fleet-level configuration. It serves as the primary entry point for vehicle onboarding and organizational grouping, enabling tenants to structure their mobile assets according to operational divisions, regions, or vehicle types.

### 1.2 Context Map

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  IDENTITY & ACCESS MGMT       │     │  TRACKING & MONITORING       │
│  ACL: Fleet user permissions  │     │  Subscribes: Vehicle events  │
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │                                    │
┌───────────────┴───────────────┐     ┌───────────────┴───────────────┐
│  VEHICLE MAINTENANCE         │◄────│  FLEET MANAGEMENT              │
│  ACL: Vehicle work orders   │     │  (This Context)                │
└───────────────┬───────────────┘     └───────┬───────────┬───────────┘
                │                             │           │
┌───────────────┴───────────────┐     ┌───────┴───┐ ┌───┴───────────┐
│  TRIP & ROUTE MGMT            │     │ ASSET     │ │ BILLING &     │
│  ACL: Vehicle dispatch        │     │ LIFECYCLE │ │ TENANT MGMT   │
└───────────────┬───────────────┘     │ ACL:      │ │ ACL: Fleet    │
                │                     │ Procure,  │ │ billing sync  │
┌───────────────┴───────────────┐     │ Dispose   │ └───────────────┘
│  DRIVER MANAGEMENT            │     └───────────┘
│  ACL: Vehicle assignment      │
└───────────────────────────────┘
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **Fleet** | A named collection of vehicles under a single organizational unit with shared policies and reporting |
| **Vehicle** | A tracked mobile asset identified by VIN, with a telematics device assignment and lifecycle metadata |
| **VehicleGroup** | A logical subset within a fleet used for organizational or operational grouping (e.g., "Northeast Trucks") |
| **FleetPolicy** | A set of configurable rules applied to all vehicles in a fleet (speed limits, idle time, geofence defaults) |
| **VehicleAssignment** | The binding of a vehicle to a fleet and optionally to a vehicle group within that fleet |
| **VehicleStatus** | Lifecycle state of a vehicle: `ACTIVE`, `INACTIVE`, `MAINTENANCE`, `DECOMMISSIONED`, `SOLD` |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLEET-MANAGEMENT-SERVICE (Spring Boot 3.3 + Kotlin)      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ PostgreSQL   │ │ Kafka        │ │ Redis        │ │ Elasticsearch│ │  │
│  │  │ Adapter     │ │ Producer     │ │ Fleet Cache  │ │ Fleet Search│ │  │
│  │  │ (JPA)       │ │ Adapter      │ │ Adapter      │ │ Adapter     │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                  │  │
│  │  │ Asset        │ │ IAM          │                                  │  │
│  │  │ Lifecycle    │ │ gRPC Client  │                                  │  │
│  │  │ gRPC Client  │ │ (auth check) │                                  │  │
│  │  └──────────────┘ └──────────────┘                                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ REST Controllers │  │ gRPC Server      │  │ Event Listeners  │   │  │
│  │  │ (FleetController,│  │ (FleetMgmtGrpcSvc)│  │ (Kafka Consumer) │   │  │
│  │  │  VehicleCtrl,   │  │                   │  │                   │   │  │
│  │  │  VehicleGroupCtrl│ │                   │  │                   │   │  │
│  │  │  FleetPolicyCtrl)│ │                   │  │                   │   │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘   │  │
│  │           │                     │                      │             │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴─────────┐   │  │
│  │  │ DTOs / Request Validators / Response Assemblers                │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ CreateFleet      │ │ AddVehicleToFleet │ │ CreateVehicleGroup│     │  │
│  │  │ UseCase          │ │ UseCase           │ │ UseCase           │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ RemoveVehicleFrom│ │ UpdateFleetPolicy│ │ DecommissionVehicle│     │  │
│  │  │ FleetUseCase     │ │ UseCase          │ │ UseCase           │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                          │  │
│  │  │ TransferVehicle  │ │ GetFleetSummary  │                          │  │
│  │  │ UseCase          │ │ UseCase          │                          │  │
│  │  └──────────────────┘ └──────────────────┘                          │  │
│  │  Ports: IFleetRepository, IVehicleRepository, IVehicleGroupRepo    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ Fleet         │ │ Vehicle      │ │ VehicleGroup │ │ FleetPolicy│ │  │
│  │  │ (Aggregate)   │ │ (Aggregate)  │ │ (Aggregate)  │ │ (Entity)   │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  Domain Services: VehicleTransferService, FleetQuotaService          │  │
│  │  Domain Events: FleetCreated, VehicleAdded, VehicleRemoved, etc.     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design

### 3.1 Fleet Aggregate Root

**AggregateId:** `FleetId` (UUID)
**Consistency Scope:** Fleet metadata, vehicle assignments count, and fleet policies within a single tenant.

```kotlin
data class FleetId(val value: UUID)

enum class FleetStatus { ACTIVE, INACTIVE, ARCHIVED }

data class Fleet(
    val id: FleetId,
    val tenantId: UUID,
    val name: String,
    val description: String,
    val orgId: UUID,                     // owning organization
    val status: FleetStatus,
    val vehicleCount: Int,               // materialized count (updated on add/remove)
    val maxVehicleCapacity: Int,         // plan-based capacity limit
    val policies: FleetPolicy,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    // --- Behaviors ---

    fun addVehicle(vin: String, currentCount: Int): Fleet {
        require(status == FleetStatus.ACTIVE) { "Cannot add vehicles to $status fleet" }
        require(currentCount < maxVehicleCapacity) {
            "Fleet capacity reached ($currentCount/$maxVehicleCapacity)"
        }
        require(vin.isNotBlank() && vin.length in 17..17) { "VIN must be exactly 17 characters" }
        return copy(
            vehicleCount = vehicleCount + 1,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(VehicleAddedToFleetEvent(it, vin)) }
    }

    fun removeVehicle(vin: String): Fleet {
        require(vehicleCount > 0) { "Fleet has no vehicles to remove" }
        return copy(
            vehicleCount = vehicleCount - 1,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(VehicleRemovedFromFleetEvent(it, vin)) }
    }

    fun updatePolicies(newPolicies: FleetPolicy): Fleet {
        require(status == FleetStatus.ACTIVE) { "Cannot update policies on inactive fleet" }
        return copy(policies = newPolicies, updatedAt = Instant.now())
            .also { raiseDomainEvent(FleetPolicyUpdatedEvent(it, newPolicies)) }
    }

    fun deactivate(): Fleet {
        require(status == FleetStatus.ACTIVE) { "Only active fleets can be deactivated" }
        return copy(status = FleetStatus.INACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(FleetDeactivatedEvent(it)) }
    }

    fun archive(): Fleet {
        require(status == FleetStatus.INACTIVE) { "Only inactive fleets can be archived" }
        return copy(status = FleetStatus.ARCHIVED, updatedAt = Instant.now())
            .also { raiseDomainEvent(FleetArchivedEvent(it)) }
    }

    // --- Invariants ---
    // INV-01: name must be unique within tenant
    // INV-02: orgId must reference an active organization in the same tenant
    // INV-03: vehicleCount must not exceed maxVehicleCapacity
    // INV-04: status transitions: ACTIVE -> INACTIVE -> ARCHIVED
}

data class FleetPolicy(
    val maxSpeedKmh: Int = 120,
    val maxIdleMinutes: Int = 15,
    val defaultGeofenceId: UUID? = null,
    val maintenanceReminderKm: Int = 15_000,
    val inspectionReminderDays: Int = 30,
    val curfewHours: CurfewConfig? = null,
    val driverBehaviorScoreThreshold: Int = 60
)

data class CurfewConfig(
    val startTime: LocalTime,
    val endTime: LocalTime,
    val timezone: ZoneId,
    val allowExceptions: Boolean = false
)
```

### 3.2 Vehicle Aggregate Root

**AggregateId:** `VehicleId` (UUID)
**Consistency Scope:** Vehicle identity, lifecycle status, basic attributes, and device binding within a fleet.

```kotlin
data class VehicleId(val value: UUID)

enum class VehicleStatus { ACTIVE, INACTIVE, MAINTENANCE, DECOMMISSIONED, SOLD }

enum class FuelType { DIESEL, GASOLINE, ELECTRIC, HYBRID, CNG, LPG }

data class Vehicle(
    val id: VehicleId,
    val tenantId: UUID,
    val vin: String,                      // Vehicle Identification Number (17 chars)
    val fleetId: UUID,
    val groupId: UUID?,                   // optional vehicle group
    val make: String,
    val model: String,
    val year: Int,
    val licensePlate: String,
    val color: String,
    val fuelType: FuelType,
    val status: VehicleStatus,
    val telematicsDeviceId: UUID?,
    val odometerKm: Long,
    val purchaseDate: LocalDate?,
    val purchasePriceCents: Long?,
    val warrantyExpiryDate: LocalDate?,
    val insurancePolicyNumber: String?,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    // --- Behaviors ---

    fun assignToFleet(newFleetId: UUID): Vehicle {
        require(status != VehicleStatus.DECOMMISSIONED && status != VehicleStatus.SOLD) {
            "Cannot reassign $status vehicle"
        }
        require(newFleetId != fleetId) { "Vehicle is already in this fleet" }
        return copy(fleetId = newFleetId, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleTransferredEvent(it, fleetId, newFleetId)) }
    }

    fun assignToGroup(groupId: UUID): Vehicle {
        require(status == VehicleStatus.ACTIVE) { "Only active vehicles can be assigned to groups" }
        return copy(groupId = groupId, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleGroupAssignedEvent(it, groupId)) }
    }

    fun removeFromGroup(): Vehicle {
        return copy(groupId = null, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleGroupRemovedEvent(it)) }
    }

    fun bindTelematicsDevice(deviceId: UUID): Vehicle {
        require(status == VehicleStatus.ACTIVE || status == VehicleStatus.INACTIVE) {
            "Cannot bind device to $status vehicle"
        }
        return copy(telematicsDeviceId = deviceId, updatedAt = Instant.now())
            .also { raiseDomainEvent(TelematicsDeviceBoundEvent(it, deviceId)) }
    }

    fun unbindTelematicsDevice(): Vehicle {
        require(telematicsDeviceId != null) { "No device bound to this vehicle" }
        return copy(telematicsDeviceId = null, updatedAt = Instant.now())
            .also { raiseDomainEvent(TelematicsDeviceUnboundEvent(it, telematicsDeviceId!!)) }
    }

    fun updateOdometer(newKm: Long): Vehicle {
        require(newKm >= odometerKm) { "Odometer cannot decrease (was $odometerKm, got $newKm)" }
        return copy(odometerKm = newKm, updatedAt = Instant.now())
            .also { raiseDomainEvent(OdometerUpdatedEvent(it, odometerKm, newKm)) }
    }

    fun placeInMaintenance(reason: String): Vehicle {
        require(status == VehicleStatus.ACTIVE) { "Only active vehicles can enter maintenance" }
        return copy(status = VehicleStatus.MAINTENANCE, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleMaintenanceStartedEvent(it, reason)) }
    }

    fun returnFromMaintenance(): Vehicle {
        require(status == VehicleStatus.MAINTENANCE) { "Vehicle is not in maintenance" }
        return copy(status = VehicleStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleMaintenanceCompletedEvent(it)) }
    }

    fun deactivate(): Vehicle {
        require(status == VehicleStatus.ACTIVE) { "Only active vehicles can be deactivated" }
        return copy(status = VehicleStatus.INACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleDeactivatedEvent(it)) }
    }

    fun decommission(reason: String): Vehicle {
        require(status in listOf(VehicleStatus.ACTIVE, VehicleStatus.INACTIVE, VehicleStatus.MAINTENANCE)) {
            "Cannot decommission a $status vehicle"
        }
        return copy(status = VehicleStatus.DECOMMISSIONED, updatedAt = Instant.now())
            .also { raiseDomainEvent(VehicleDecommissionedEvent(it, reason)) }
    }

    fun markAsSold(salePriceCents: Long, saleDate: LocalDate): Vehicle {
        require(status == VehicleStatus.DECOMMISSIONED) { "Vehicle must be decommissioned before sale" }
        return copy(
            status = VehicleStatus.SOLD,
            metadata = metadata + ("sale_price_cents" to salePriceCents.toString()) + ("sale_date" to saleDate.toString()),
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(VehicleSoldEvent(it, salePriceCents, saleDate)) }
    }

    // --- Invariants ---
    // INV-01: VIN must be exactly 17 characters and unique across platform
    // INV-02: licensePlate must be unique within tenant (same state/jurisdiction)
    // INV-03: fleetId must reference an active fleet in the same tenant
    // INV-04: groupId must reference a group within the same fleet
    // INV-05: telematicsDeviceId must reference a registered device (checked at application layer)
    // INV-06: odometer is monotonically increasing
    // INV-07: year must be between 1990 and current year + 1
}
```

### 3.3 VehicleGroup Aggregate Root

**AggregateId:** `GroupId` (UUID)
**Consistency Scope:** Group metadata, member count, and group-level settings within a fleet.

```kotlin
data class GroupId(val value: UUID)

data class VehicleGroup(
    val id: GroupId,
    val tenantId: UUID,
    val fleetId: UUID,
    val name: String,
    val description: String,
    val memberCount: Int,
    val vehicleTypeFilter: VehicleTypeFilter? = null,
    val status: GroupStatus,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun addMember(): VehicleGroup =
        copy(memberCount = memberCount + 1, updatedAt = Instant.now())
            .also { raiseDomainEvent(GroupMemberAddedEvent(it)) }

    fun removeMember(): VehicleGroup {
        require(memberCount > 0) { "Group has no members to remove" }
        return copy(memberCount = memberCount - 1, updatedAt = Instant.now())
            .also { raiseDomainEvent(GroupMemberRemovedEvent(it)) }
    }

    fun rename(newName: String): VehicleGroup {
        require(newName.isNotBlank()) { "Group name cannot be blank" }
        return copy(name = newName, updatedAt = Instant.now())
            .also { raiseDomainEvent(GroupRenamedEvent(it, newName)) }
    }

    fun deactivate(): VehicleGroup =
        copy(status = GroupStatus.INACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(GroupDeactivatedEvent(it)) }

    // INV-01: name must be unique within fleet
    // INV-02: fleetId must reference an active fleet
    // INV-03: memberCount must be non-negative
}

data class VehicleTypeFilter(
    val makes: List<String>? = null,
    val fuelTypes: List<FuelType>? = null,
    val yearRange: IntRange? = null
)
```

### 3.4 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `fleet.fleet.created.v1` | New fleet created | fleetId, tenantId, orgId, name |
| `fleet.fleet.deactivated.v1` | Fleet deactivated | fleetId, tenantId |
| `fleet.fleet.policy.updated.v1` | Fleet policy changed | fleetId, tenantId, policies |
| `fleet.vehicle.added.v1` | Vehicle added to fleet | vehicleId, fleetId, tenantId, vin |
| `fleet.vehicle.removed.v1` | Vehicle removed from fleet | vehicleId, fleetId, tenantId, vin |
| `fleet.vehicle.transferred.v1` | Vehicle moved between fleets | vehicleId, fromFleetId, toFleetId, tenantId |
| `fleet.vehicle.group.assigned.v1` | Vehicle assigned to group | vehicleId, groupId, fleetId, tenantId |
| `fleet.vehicle.decommissioned.v1` | Vehicle decommissioned | vehicleId, tenantId, vin, reason |
| `fleet.vehicle.sold.v1` | Vehicle sold | vehicleId, tenantId, vin, salePrice, saleDate |
| `fleet.vehicle.maintenance.started.v1` | Vehicle enters maintenance | vehicleId, tenantId, vin, reason |
| `fleet.vehicle.maintenance.completed.v1` | Vehicle exits maintenance | vehicleId, tenantId, vin |
| `fleet.vehicle.odometer.updated.v1` | Odometer reading updated | vehicleId, tenantId, oldKm, newKm |
| `fleet.vehicle.device.bound.v1` | Telematics device bound | vehicleId, tenantId, deviceId |
| `fleet.vehicle.device.unbound.v1` | Telematics device unbound | vehicleId, tenantId, deviceId |
| `fleet.group.created.v1` | Vehicle group created | groupId, fleetId, tenantId, name |

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.fleet.domain.port.out

import com.fleetvision.fleet.domain.model.*
import java.util.UUID

interface FleetRepository {
    fun save(fleet: Fleet): Fleet
    fun findById(fleetId: UUID, tenantId: UUID): Fleet?
    fun findByName(name: String, tenantId: UUID): Fleet?
    fun findByTenant(tenantId: UUID, page: Int, size: Int): List<Fleet>
    fun findByOrgId(orgId: UUID, tenantId: UUID): List<Fleet>
    fun existsByName(name: String, tenantId: UUID): Boolean
    fun countByTenant(tenantId: UUID): Long
    fun delete(fleetId: UUID, tenantId: UUID)
}

interface VehicleRepository {
    fun save(vehicle: Vehicle): Vehicle
    fun findById(vehicleId: UUID, tenantId: UUID): Vehicle?
    fun findByVin(vin: String, tenantId: UUID): Vehicle?
    fun existsByVin(vin: String): Boolean            // cross-tenant uniqueness
    fun findByFleetId(fleetId: UUID, tenantId: UUID, page: Int, size: Int): List<Vehicle>
    fun findByGroupId(groupId: UUID, tenantId: UUID, page: Int, size: Int): List<Vehicle>
    fun findByStatus(status: VehicleStatus, tenantId: UUID, page: Int, size: Int): List<Vehicle>
    fun findByLicensePlate(plate: String, tenantId: UUID): Vehicle?
    fun findByDeviceId(deviceId: UUID): Vehicle?
    fun countByFleetId(fleetId: UUID): Long
    fun countByGroupId(groupId: UUID): Long
    fun countByStatus(status: VehicleStatus, tenantId: UUID): Long
    fun search(query: String, tenantId: UUID, page: Int, size: Int): List<Vehicle>
    fun delete(vehicleId: UUID, tenantId: UUID)
}

interface VehicleGroupRepository {
    fun save(group: VehicleGroup): VehicleGroup
    fun findById(groupId: UUID, tenantId: UUID): VehicleGroup?
    fun findByFleetId(fleetId: UUID, tenantId: UUID): List<VehicleGroup>
    fun findByName(name: String, fleetId: UUID, tenantId: UUID): VehicleGroup?
    fun existsByName(name: String, fleetId: UUID, tenantId: UUID): Boolean
    fun delete(groupId: UUID, tenantId: UUID)
}

// Port — inbound (use case ports)
interface EventPublisher {
    fun publish(event: DomainEvent)
}

// Port — external service calls
interface AssetLifecycleClient {
    fun notifyVehicleDecommissioned(vehicleId: UUID, reason: String)
    fun notifyVehicleSold(vehicleId: UUID, salePriceCents: Long)
}

interface IAMClient {
    fun checkPermission(userId: UUID, permission: String, tenantId: UUID): Boolean
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/fleet`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/fleets` | List fleets (paginated, filtered by org/status) | `fleet.fleet.read` |
| `GET` | `/fleets/{fleetId}` | Get fleet detail with summary stats | `fleet.fleet.read` |
| `POST` | `/fleets` | Create a new fleet | `fleet.fleet.create` |
| `PUT` | `/fleets/{fleetId}` | Update fleet name/description | `fleet.fleet.update` |
| `PATCH` | `/fleets/{fleetId}/status` | Activate/deactivate/archive fleet | `fleet.fleet.manage` |
| `PUT` | `/fleets/{fleetId}/policies` | Update fleet policies | `fleet.fleet.policy.update` |
| `GET` | `/fleets/{fleetId}/summary` | Fleet statistics dashboard data | `fleet.fleet.read` |
| `GET` | `/vehicles` | List vehicles (paginated, filterable) | `fleet.vehicle.read` |
| `GET` | `/vehicles/{vehicleId}` | Get vehicle detail | `fleet.vehicle.read` |
| `POST` | `/vehicles` | Register a new vehicle in a fleet | `fleet.vehicle.create` |
| `PUT` | `/vehicles/{vehicleId}` | Update vehicle metadata | `fleet.vehicle.update` |
| `PATCH` | `/vehicles/{vehicleId}/status` | Change vehicle status | `fleet.vehicle.manage` |
| `POST` | `/vehicles/{vehicleId}/transfer` | Transfer vehicle to another fleet | `fleet.vehicle.transfer` |
| `PATCH` | `/vehicles/{vehicleId}/odometer` | Update odometer reading | `fleet.vehicle.update` |
| `POST` | `/vehicles/{vehicleId}/maintenance` | Place vehicle in maintenance | `fleet.vehicle.manage` |
| `DELETE` | `/vehicles/{vehicleId}/maintenance` | Return vehicle from maintenance | `fleet.vehicle.manage` |
| `GET` | `/vehicles/search` | Full-text vehicle search | `fleet.vehicle.read` |
| `GET` | `/groups` | List vehicle groups in a fleet | `fleet.group.read` |
| `POST` | `/groups` | Create a vehicle group | `fleet.group.create` |
| `PUT` | `/groups/{groupId}` | Update group metadata | `fleet.group.update` |
| `DELETE` | `/groups/{groupId}` | Delete a vehicle group | `fleet.group.delete` |
| `POST` | `/groups/{groupId}/vehicles` | Add vehicle to group | `fleet.group.manage` |
| `DELETE` | `/groups/{groupId}/vehicles/{vehicleId}` | Remove vehicle from group | `fleet.group.manage` |

### 5.2 gRPC Service

```protobuf
service FleetManagementService {
  // Get fleet details (internal cross-service call)
  rpc GetFleet (GetFleetRequest) returns (FleetResponse);
  // Get vehicle details (used by Trip, Maintenance, Tracking services)
  rpc GetVehicle (GetVehicleRequest) returns (VehicleResponse);
  // Batch vehicle lookup
  rpc LookupVehicles (LookupVehiclesRequest) returns (LookupVehiclesResponse);
  // Check if vehicle belongs to fleet (authorization)
  rpc ValidateVehicleFleet (ValidateVehicleFleetRequest) returns (ValidateVehicleFleetResponse);
  // Get fleet policy
  rpc GetFleetPolicy (GetFleetPolicyRequest) returns (FleetPolicyResponse);
}

message GetFleetRequest {
  string fleet_id = 1;
  string tenant_id = 2;
}

message FleetResponse {
  string id = 1;
  string tenant_id = 2;
  string name = 3;
  string org_id = 4;
  string status = 5;
  int32 vehicle_count = 6;
  FleetPolicy policy = 7;
}

message GetVehicleRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
}

message VehicleResponse {
  string id = 1;
  string vin = 2;
  string fleet_id = 3;
  string group_id = 4;
  string make = 5;
  string model = 6;
  int32 year = 7;
  string status = 8;
  int64 odometer_km = 9;
  optional string telematics_device_id = 10;
}

message LookupVehiclesRequest {
  repeated string vehicle_ids = 1;
  string tenant_id = 2;
}

message LookupVehiclesResponse {
  repeated VehicleResponse vehicles = 1;
}

message ValidateVehicleFleetRequest {
  string vehicle_id = 1;
  string fleet_id = 2;
  string tenant_id = 3;
}

message ValidateVehicleFleetResponse {
  bool belongs = 1;
}

message GetFleetPolicyRequest {
  string fleet_id = 1;
  string tenant_id = 2;
}

message FleetPolicyResponse {
  int32 max_speed_kmh = 1;
  int32 max_idle_minutes = 2;
  optional string default_geofence_id = 3;
  int32 maintenance_reminder_km = 4;
  int32 inspection_reminder_days = 5;
  int32 driver_behavior_score_threshold = 6;
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.fleet.events` | `fleetId` | 7 days | fleet-management-service |
| `fleetvision.fleet.vehicle.events` | `vehicleId` | 7 days | fleet-management-service |
| `fleetvision.fleet.group.events` | `groupId` | 7 days | fleet-management-service |

### 6.2 Published Events (Producer)

```json
// fleet.vehicle.added.v1
{
  "specversion": "1.0",
  "type": "fleet.vehicle.added.v1",
  "source": "/fleet-management-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "vehicle_id": "550e8400-e29b-41d4-a716-446655440000",
    "fleet_id": "660e8400-e29b-41d4-a716-446655440001",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "vin": "1HGBH41JXMN109186",
    "make": "Toyota",
    "model": "Corolla",
    "year": 2024
  },
  "fleetvision": {
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "correlation_id": "uuid-v4",
    "causation_id": "uuid-v4",
    "aggregate_id": "660e8400-e29b-41d4-a716-446655440001",
    "aggregate_version": 1
  }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.maintenance.workorder.events` | `maintenance.workorder.completed.v1` | Return vehicle from maintenance status if all WOs complete |
| `fleetvision.telemetry.device.events` | `telemetry.device.activated.v1` | Auto-bind activated device to awaiting vehicles (if configured) |
| `fleetvision.iam.org.events` | `iam.org.deactivated.v1` | Deactivate all fleets under that organization |
| `fleetvision.billing.tenant.events` | `billing.tenant.suspended.v1` | Freeze fleet modifications, mark as read-only |
| `fleetvision.trip.events` | `trip.started.v1` | Validate vehicle is ACTIVE before trip start |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| Identity & Access Mgmt | gRPC (outbound) | Permission checks, user validation |
| Tracking & Monitoring | Kafka (outbound) | Publish vehicle status changes |
| Vehicle Maintenance | Kafka (inbound) | Listen for work order completion events |
| Telemetry & Device Mgmt | Kafka (inbound) | Listen for device activation events |
| Asset Lifecycle | gRPC (outbound) | Notify vehicle decommission/sale |
| Billing & Tenant Mgmt | Kafka (inbound) | Listen for tenant suspension events |
| Notification Service | Kafka (outbound) | Fleet policy violation alerts |
| Audit Log Service | Kafka (outbound) | All fleet/vehicle change audit trails |
| Analytics Engine | Kafka (outbound) | Fleet statistics events |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **VIN Decoder API (NHTSA)** | REST API | Outbound | VIN validation, vehicle spec lookup on registration |
| **Fleet Management Software** | REST API (inbound) | Inbound | ACL adapter for legacy system synchronization |
| **Government Registries** | REST/SOAP | Outbound | License plate validation per jurisdiction |

---

## 8. Configuration Properties

```yaml
# application-fleet.yaml (fleet-management-service)
fleetvision:
  fleet:
    service-name: fleet-management-service

    vehicle:
      vin-validation:
        enabled: true
        provider: NHTSA
        url: https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/
        timeout: 5s
      year-range:
        min: 1990
        max: 2027

    fleet:
      max-name-length: 100
      max-description-length: 500
      default-max-vehicles: 10000
      archive-after-inactive-days: 365

    group:
      max-name-length: 100
      max-vehicles-per-group: 5000

    policy:
      default-max-speed: 120
      default-max-idle-minutes: 15
      default-maintenance-reminder-km: 15000
      default-inspection-reminder-days: 30

    cache:
      fleet-summary-ttl: 5m
      vehicle-detail-ttl: 2m
      policy-ttl: 10m

  database:
    jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_fleet
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    pool:
      maximum-pool-size: 25
      minimum-idle: 5
    migration:
      locations: classpath:db/migration/fleet

  redis:
    host: ${REDIS_HOST}
    port: 6379
    password: ${REDIS_PASSWORD}
    database-index: 1
    ttl:
      fleet-summary: 300
      vehicle-detail: 120

  elasticsearch:
    hosts: ${ES_HOSTS}
    index-prefix: fleetvision-fleet
    bulk-size: 100
    flush-interval: 5s

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: fleet-mgmt-producer
      acks: all
      retries: 3
      compression-type: lz4
    consumer:
      group-id: fleet-mgmt-consumer
      auto-offset-reset: earliest
      enable-auto-commit: false
    topics:
      fleet-events: fleetvision.fleet.events
      vehicle-events: fleetvision.fleet.vehicle.events
      group-events: fleetvision.fleet.group.events
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| IAM gRPC (permission check) | 10 failures in 30s | 10s | 5 | Deny operation (secure default) |
| Asset Lifecycle gRPC | 3 failures in 60s | 60s | 2 | Queue notification for later retry |
| VIN Decoder API | 5 failures in 60s | 120s | 3 | Allow vehicle creation with VIN validation deferred |
| Elasticsearch (search) | 5 failures in 30s | 30s | 5 | Fall back to database LIKE query |
| Redis (cache) | 3 failures in 10s | 10s | 3 | Skip cache, query DB directly |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| IAM permission check | 2 | Fixed 100ms | +/- 25ms |
| VIN decode | 2 | Fixed 500ms | +/- 20% |
| Asset Lifecycle notification | 5 | Exponential (1s, 2s, 4s, 8s, 16s) | Full jitter |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |
| Database write | 3 | Exponential (50ms, 100ms, 200ms) | +/- 25% |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| gRPC requests | 3s | 5s | 8s |
| VIN Decoder API | 3s | 5s | 8s |
| Elasticsearch queries | 2s | 5s | 7s |
| Kafka produce | 5s | — | 30s (including retries) |

### 9.4 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Fleet creation | 10/min per tenant | 20 | Token bucket |
| Vehicle registration | 100/min per tenant | 200 | Token bucket |
| Vehicle search | 200/min per user | 400 | Sliding window |
| Fleet policy updates | 20/min per tenant | 40 | Token bucket |
| Bulk vehicle import | 5/min per tenant | 10 | Fixed window |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | Domain entities, use cases, invariants | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | Repository, Kafka, Redis, ES | Testcontainers (PG, Kafka, Redis, ES) | 80% |
| **Contract Tests** | gRPC/REST API contracts | Spring Cloud Contract, Pact | 100% |
| **Component Tests** | Full service with testcontainers | SpringBootTest, WireMock | Key flows |
| **End-to-End Tests** | Multi-service scenarios | Testcontainers Compose | Critical paths |

### 10.2 Domain Test Scenarios

**Fleet Aggregate:**
- Create fleet with valid data succeeds
- Create fleet with duplicate name fails
- Add vehicle to active fleet succeeds, increments count
- Add vehicle to full fleet (capacity reached) fails
- Deactivate fleet prevents vehicle additions
- Archive inactive fleet succeeds
- Update policies on active fleet succeeds

**Vehicle Aggregate:**
- Register vehicle with valid 17-char VIN succeeds
- Register vehicle with invalid VIN (not 17 chars) fails
- Transfer vehicle between fleets succeeds
- Transfer decommissioned vehicle fails
- Odometer update with decreasing value fails
- Decommission active vehicle succeeds
- Sell non-decommissioned vehicle fails

**VehicleGroup Aggregate:**
- Create group in fleet succeeds
- Add member increments count
- Remove member from empty group fails

### 10.3 Integration Test Scenarios

- Fleet creation persists to PostgreSQL and publishes Kafka event
- Vehicle registration triggers VIN validation via NHTSA API (WireMock)
- Fleet cache (Redis) populated on read, invalidated on write
- Elasticsearch index updated on vehicle create/update
- Bulk vehicle import handles partial failures gracefully

### 10.4 Contract Test Scenarios
- `GetVehicle` gRPC returns correct vehicle data
- `ValidateVehicleFleet` gRPC returns correct membership status
- `POST /fleets` REST returns 201 with location header
- `POST /vehicles` REST validates VIN format; returns 400 for invalid
- `POST /vehicles/{id}/transfer` REST validates vehicle status; returns 409

### 10.5 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| Fleet list (paginated) | < 50ms p99 for 10K fleets | k6 |
| Vehicle search (Elasticsearch) | < 100ms p99 for 100K vehicles | k6 |
| Vehicle registration throughput | 200 TPS sustained | Gatling |
| Concurrent fleet modifications | 50 concurrent without deadlock | JMeter |

---

## Appendix A: Package Structure

```
com.fleetvision.fleet/
├── domain/
│   ├── model/
│   │   ├── Fleet.kt
│   │   ├── Vehicle.kt
│   │   ├── VehicleGroup.kt
│   │   ├── FleetPolicy.kt
│   │   └── valueobjects/
│   │       ├── FleetId.kt
│   │       ├── VehicleId.kt
│   │       ├── GroupId.kt
│   │       └── VehicleTypeFilter.kt
│   ├── event/
│   │   ├── FleetCreatedEvent.kt
│   │   ├── VehicleAddedToFleetEvent.kt
│   │   ├── VehicleTransferredEvent.kt
│   │   └── ...
│   ├── service/
│   │   ├── VehicleTransferService.kt
│   │   └── FleetQuotaService.kt
│   └── port/
│       ├── out/
│       │   ├── FleetRepository.kt
│       │   ├── VehicleRepository.kt
│       │   ├── VehicleGroupRepository.kt
│       │   ├── EventPublisher.kt
│       │   ├── AssetLifecycleClient.kt
│       │   └── IAMClient.kt
│       └── in/
│           └── FleetUseCasePort.kt
├── application/
│   ├── usecase/
│   │   ├── CreateFleetUseCase.kt
│   │   ├── RegisterVehicleUseCase.kt
│   │   ├── TransferVehicleUseCase.kt
│   │   ├── UpdateFleetPolicyUseCase.kt
│   │   └── ...
│   └── dto/
│       ├── FleetRequest.kt
│       ├── VehicleRequest.kt
│       ├── FleetResponse.kt
│       └── ...
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── FleetController.kt
│   │   │   ├── VehicleController.kt
│   │   │   └── VehicleGroupController.kt
│   │   ├── grpc/
│   │   │   └── FleetManagementGrpcService.kt
│   │   └── event/
│   │       └── FleetEventConsumer.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── jpa/
│       │   │   ├── FleetJpaRepository.kt
│       │   │   ├── VehicleJpaRepository.kt
│       │   │   └── ...
│       │   └── FleetRepositoryAdapter.kt
│       ├── redis/
│       │   └── FleetCacheAdapter.kt
│       ├── elasticsearch/
│       │   └── VehicleSearchAdapter.kt
│       ├── iam/
│       │   └── IAMGrpcClient.kt
│       ├── asset/
│       │   └── AssetLifecycleGrpcClient.kt
│       └── kafka/
│           └── FleetEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── PersistenceConfig.kt
│   │   ├── KafkaConfig.kt
│   │   ├── ElasticsearchConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── FleetAlreadyExistsException.kt
│       ├── VehicleAlreadyExistsException.kt
│       ├── FleetCapacityExceededException.kt
│       └── InvalidVinException.kt
└── FleetManagementServiceApplication.kt
```
