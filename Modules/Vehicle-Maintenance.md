# Vehicle Maintenance Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Vehicle Maintenance
**Service:** `vehicle-maintenance-service`
**Data Store:** PostgreSQL 16 (event store, read models)
**Messaging:** Kafka (domain events)
**Pattern:** CQRS + Event Sourcing (WorkOrder aggregate)

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Design — Event Sourced WorkOrder](#3-aggregate-root-design--event-sourced-workorder)
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

The Vehicle Maintenance context manages the complete lifecycle of maintenance operations for fleet vehicles. It handles maintenance scheduling (preventive, predictive, and corrective), work order creation and tracking, parts inventory management, vendor coordination, and cost tracking. The WorkOrder aggregate is event-sourced to maintain a full audit trail of maintenance activities, which is critical for regulatory compliance, warranty claims, and cost analysis.

### 1.2 Context Map

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  TELEMETRICS & DEVICE MGMT   │     │  FLEET MANAGEMENT              │
│  Produces: DiagnosticCodes,   │     │  Consumes: MaintenanceStarted,│
│  DeviceHealth alerts          │     │  MaintenanceCompleted events   │
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │                                    │
┌───────────────┴───────────────┐     ┌───────────────┴───────────────┐
│  TRACKING & MONITORING       │     │  VEHICLE MAINTENANCE           │
│  Produces: Odometer updates   │────►│  (This Context)               │
│  Consumes: Maintenance alerts│     │                               │
└───────────────┬───────────────┘     └───────┬───────────┬───────────┘
                │                             │           │
┌───────────────┴───────────────┐     ┌───────┴───┐ ┌───┴───────────┐
│  ANALYTICS ENGINE             │     │ NOTIFICA- │ │ BILLING &      │
│  Consumes: All WO events      │     │ TION      │ │ TENANT MGMT    │
│  for predictive models        │     │ SERVICE   │ │ (cost tracking)│
└───────────────────────────────┘     └───────────┘ └───────────────┘
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **WorkOrder** | The central aggregate representing a maintenance task from creation through completion and cost settlement |
| **MaintenanceType** | Classification: `PREVENTIVE` (scheduled), `CORRECTIVE` (reactive), `PREDICTIVE` (ML-triggered), `INSPECTION` (regulatory) |
| **MaintenanceTask** | An individual line item within a work order (e.g., "Replace brake pads", "Oil change") |
| **PartsRequisition** | A request to reserve or order parts needed for a maintenance task |
| **Vendor** | An external service provider authorized to perform maintenance work |
| **MaintenancePlan** | A scheduled template defining recurring maintenance intervals for a vehicle type |
| **RepairOrder** | A specific repair task dispatched to a vendor or internal technician |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   VEHICLE-MAINTENANCE-SERVICE (Spring Boot 3.3 + Kotlin)    │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ PostgreSQL   │ │ Kafka        │ │ Redis        │ │ Elasticsearch│ │  │
│  │  │ Event Store  │ │ Producer     │ │ WO Cache     │ │ WO Search   │ │  │
│  │  │ + Read Model │ │ Adapter      │ │ Adapter      │ │ Adapter     │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                  │  │
│  │  │ Fleet Mgmt   │ │ IAM          │                                  │  │
│  │  │ gRPC Client  │ │ gRPC Client  │                                  │  │
│  │  └──────────────┘ └──────────────┘                                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ REST Controllers │  │ gRPC Server      │  │ Event Listeners  │   │  │
│  │  │ (WorkOrderCtrl,  │  │ (MaintenanceGrpcSvc)│ │ (Kafka Consumer) │   │  │
│  │  │  MaintenancePlan, │  │                   │  │                   │   │  │
│  │  │  PartsCtrl,      │  │                   │  │                   │   │  │
│  │  │  VendorCtrl)     │  │                   │  │                   │   │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘   │  │
│  │           │                     │                      │             │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴─────────┐   │  │
│  │  │ DTOs / WorkOrder Mappers / Task Mappers / Cost Calculators    │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ CreateWorkOrder   │ │ SchedulePreventive│ │ CompleteWorkOrder │     │  │
│  │  │ UseCase           │ │ MaintenanceUseCase│ │ UseCase           │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ AssignTechnician │ │ AddPartsToWO     │ │ CreateVendor     │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                          │  │
│  │  │ GeneratePredictive│ │ GetMaintenance   │                          │  │
│  │  │ MaintenanceUseCase│ │ DashboardUseCase │                          │  │
│  │  └──────────────────┘ └──────────────────┘                          │  │
│  │  Ports: IWorkOrderEventStore, IWorkOrderReadRepo, IMaintenancePlan │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ WorkOrder    │ │ Maintenance  │ │ Vendor       │ │ Parts      │ │  │
│  │  │ (Event-     │ │ Task         │ │ (Aggregate)  │ │ (Entity)   │ │  │
│  │  │  Sourced AR) │ │ (Entity)     │ │              │ │            │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                   │  │
│  │  │ Maintenance  │ │ Parts        │                                   │  │
│  │  │ Plan         │ │ Requisition  │                                   │  │
│  │  │ (Aggregate)  │ │ (Entity)     │                                   │  │
│  │  └──────────────┘ └──────────────┘                                   │  │
│  │  Domain Services: MaintenanceCostService, PredictiveEngine          │  │
│  │  Domain Events: WorkOrderCreated, TaskCompleted, WOClosed, etc.    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design — Event Sourced WorkOrder

### 3.1 Architecture Decision: Event Sourcing for WorkOrder

The WorkOrder is event-sourced because:
1. **Regulatory audit**: Full maintenance history must be reconstructable for FMCSA, insurance, and warranty claims.
2. **Cost tracking**: Every labor, parts, and expense change must be tracked with timestamps and actors.
3. **Dispute resolution**: "When was this repair done, by whom, with what parts, and at what cost?" must be answerable.
4. **Predictive analytics**: Event history feeds ML models for predicting future maintenance needs.

### 3.2 WorkOrder Event-Sourced Aggregate

**AggregateId:** `WorkOrderId` (UUID)
**Event Store:** PostgreSQL with `maintenance_events` table (append-only)

```kotlin
data class WorkOrderId(val value: UUID)

enum class WorkOrderStatus {
    DRAFT, PENDING_APPROVAL, APPROVED, ASSIGNED, IN_PROGRESS,
    PARTS_ORDERED, ON_HOLD, COMPLETED, CLOSED, CANCELLED
}

enum class Priority { LOW, MEDIUM, HIGH, CRITICAL, EMERGENCY }

enum class MaintenanceType { PREVENTIVE, CORRECTIVE, PREDICTIVE, INSPECTION }

data class WorkOrder(
    val id: WorkOrderId,
    val tenantId: UUID,
    val vehicleId: UUID,
    val fleetId: UUID,
    val type: MaintenanceType,
    val priority: Priority,
    val title: String,
    val description: String,
    val status: WorkOrderStatus,
    // Reconstructed state
    val assignedTechnicianId: UUID?,
    val assignedVendorId: UUID?,
    val tasks: List<MaintenanceTask>,
    val partsRequisitions: List<PartsRequisition>,
    val laborHours: Double,
    val laborRateCentsPerHour: Long,
    val partsCostCents: Long,
    val totalCostCents: Long,
    val externalCostCents: Long,
    val odometerAtCreationKm: Long,
    val estimatedCompletionDate: LocalDate?,
    val actualCompletionDate: LocalDate?,
    val scheduledDate: LocalDate?,
    val approvalReason: String?,
    val cancelReason: String?,
    val holdReason: String?,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    companion object {
        fun create(
            tenantId: UUID,
            vehicleId: UUID,
            fleetId: UUID,
            type: MaintenanceType,
            priority: Priority,
            title: String,
            description: String,
            odometerKm: Long
        ): Pair<WorkOrder, WorkOrderCreatedEvent> {
            require(title.isNotBlank()) { "Title is required" }
            require(description.isNotBlank()) { "Description is required" }
            val now = Instant.now()
            val wo = WorkOrder(
                id = WorkOrderId(UUID.randomUUID()),
                tenantId = tenantId,
                vehicleId = vehicleId,
                fleetId = fleetId,
                type = type,
                priority = priority,
                title = title,
                description = description,
                status = WorkOrderStatus.DRAFT,
                assignedTechnicianId = null,
                assignedVendorId = null,
                tasks = emptyList(),
                partsRequisitions = emptyList(),
                laborHours = 0.0,
                laborRateCentsPerHour = 0,
                partsCostCents = 0,
                totalCostCents = 0,
                externalCostCents = 0,
                odometerAtCreationKm = odometerKm,
                estimatedCompletionDate = null,
                actualCompletionDate = null,
                scheduledDate = null,
                approvalReason = null,
                cancelReason = null,
                holdReason = null,
                metadata = emptyMap(),
                version = 1,
                createdAt = now,
                updatedAt = now
            )
            val event = WorkOrderCreatedEvent(
                workOrderId = wo.id.value,
                tenantId = tenantId,
                vehicleId = vehicleId,
                fleetId = fleetId,
                type = type.name,
                priority = priority.name,
                title = title,
                odometerKm = odometerKm,
                timestamp = now
            )
            return wo to event
        }
    }

    // --- Event Application (State Reconstruction) ---

    fun apply(event: WorkOrderSubmittedEvent): WorkOrder = copy(
        status = WorkOrderStatus.PENDING_APPROVAL, version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderApprovedEvent): WorkOrder = copy(
        status = WorkOrderStatus.APPROVED,
        approvalReason = event.reason,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderRejectedEvent): WorkOrder = copy(
        status = WorkOrderStatus.CANCELLED,
        cancelReason = event.reason,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: TechnicianAssignedEvent): WorkOrder = copy(
        assignedTechnicianId = event.technicianId,
        status = WorkOrderStatus.ASSIGNED,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: VendorAssignedEvent): WorkOrder = copy(
        assignedVendorId = event.vendorId,
        status = WorkOrderStatus.ASSIGNED,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkStartedEvent): WorkOrder = copy(
        status = WorkOrderStatus.IN_PROGRESS,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: TaskAddedEvent): WorkOrder = copy(
        tasks = tasks + event.task,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: TaskCompletedEvent): WorkOrder {
        val updatedTasks = tasks.map { if (it.id == event.taskId) it.copy(status = TaskStatus.COMPLETED) else it }
        return copy(tasks = updatedTasks, version = version + 1, updatedAt = Instant.now())
    }

    fun apply(event: PartsAddedEvent): WorkOrder = copy(
        partsRequisitions = partsRequisitions + event.requisition,
        partsCostCents = partsCostCents + event.requisition.totalCostCents,
        totalCostCents = recalculateTotalCost(laborHours, laborRateCentsPerHour, partsCostCents + event.requisition.totalCostCents, externalCostCents),
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: LaborRecordedEvent): WorkOrder = copy(
        laborHours = laborHours + event.hours,
        totalCostCents = recalculateTotalCost(laborHours + event.hours, laborRateCentsPerHour, partsCostCents, externalCostCents),
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderCompletedEvent): WorkOrder = copy(
        status = WorkOrderStatus.COMPLETED,
        actualCompletionDate = event.completionDate,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderClosedEvent): WorkOrder = copy(
        status = WorkOrderStatus.CLOSED,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderCancelledEvent): WorkOrder = copy(
        status = WorkOrderStatus.CANCELLED,
        cancelReason = event.reason,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderHoldEvent): WorkOrder = copy(
        status = WorkOrderStatus.ON_HOLD,
        holdReason = event.reason,
        version = version + 1, updatedAt = Instant.now()
    )

    fun apply(event: WorkOrderResumedEvent): WorkOrder = copy(
        status = WorkOrderStatus.IN_PROGRESS,
        holdReason = null,
        version = version + 1, updatedAt = Instant.now()
    )

    private fun recalculateTotalCost(laborHrs: Double, rate: Long, parts: Long, external: Long): Long =
        (laborHrs * rate).toLong() + parts + external

    // --- Invariants ---
    // INV-01: version is monotonically increasing (enforced by event store)
    // INV-02: Status transitions follow a valid state machine (DRAFT -> PENDING_APPROVAL -> APPROVED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> CLOSED)
    // INV-03: totalCostCents = (laborHours * laborRateCentsPerHour) + partsCostCents + externalCostCents
    // INV-04: Cannot add tasks/Parts/Labor when status is COMPLETED, CLOSED, or CANCELLED
    // INV-05: At least one task required before IN_PROGRESS
}
```

### 3.3 WorkOrder State Machine

```
                    ┌───────────┐
                    │   DRAFT   │
                    └─────┬─────┘
                          │ submit()
                    ┌─────┴─────────┐
                    ▼               ▼
            ┌──────────────┐ ┌───────────┐
            │PENDING_APPROVAL│ │ CANCELLED │
            └──────┬───────┘ └───────────┘
                   │ approve()
            ┌──────┴───────┐
            ▼              ▼
     ┌──────────┐  ┌───────────┐
     │ APPROVED  │  │ CANCELLED │
     └────┬─────┘  └───────────┘
          │ assign()
     ┌────┴─────┐
     ▼          ▼
┌──────────┐ ┌──────────┐
│ ASSIGNED │ │ CANCELLED│
└────┬─────┘ └──────────┘
     │ startWork()
┌────┴──────────────────────────────┐
│                                  │
▼            IN_PROGRESS    ┌──────┴──┐
│          ↕  hold/resume  │ON_HOLD  │
│                        └──────┬──┘
│                              │ resume()
│                                  │
└──────────────────────────────────┘
     │ completeWork()
     ▼
┌───────────┐
│ COMPLETED │
└─────┬─────┘
      │ close()
      ▼
┌───────────┐
│  CLOSED   │
└───────────┘
```

### 3.4 Supporting Entities

```kotlin
data class MaintenanceTask(
    val id: UUID,
    val description: String,
    val category: TaskCategory,
    val status: TaskStatus,
    val estimatedHours: Double,
    val actualHours: Double,
    val notes: String?
)

enum class TaskCategory {
    MECHANICAL, ELECTRICAL, BODYWORK, TIRE, FLUID, DIAGNOSTIC, SOFTWARE, OTHER
}

enum class TaskStatus { PENDING, IN_PROGRESS, COMPLETED, SKIPPED }

data class PartsRequisition(
    val id: UUID,
    val partNumber: String,
    val partName: String,
    val quantity: Int,
    val unitCostCents: Long,
    val totalCostCents: Long,
    val supplierName: String,
    val status: RequisitionStatus
)

enum class RequisitionStatus { REQUESTED, ORDERED, RECEIVED, CANCELLED }
```

### 3.5 MaintenancePlan Aggregate

```kotlin
data class MaintenancePlanId(val value: UUID)

data class MaintenancePlan(
    val id: MaintenancePlanId,
    val tenantId: UUID,
    val name: String,
    val vehicleTypeId: String,              // e.g., "sedan_diesel", "truck_gasoline"
    val scheduleRules: List<ScheduleRule>,
    val isActive: Boolean,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun addRule(rule: ScheduleRule): MaintenancePlan {
        require(scheduleRules.none { it.id == rule.id }) { "Rule already exists" }
        return copy(scheduleRules = scheduleRules + rule, updatedAt = Instant.now())
    }

    fun deactivate(): MaintenancePlan =
        copy(isActive = false, updatedAt = Instant.now())
}

data class ScheduleRule(
    val id: UUID,
    val taskDescription: String,
    val category: TaskCategory,
    val intervalType: IntervalType,
    val intervalValue: Int,              // km or days depending on type
    val estimatedHours: Double,
    val priority: Priority
)

enum class IntervalType { ODOMETER_KM, CALENDAR_DAYS, ENGINE_HOURS }
```

### 3.6 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `maintenance.workorder.created.v1` | New work order created | workOrderId, tenantId, vehicleId, fleetId, type, priority, title, odometerKm |
| `maintenance.workorder.submitted.v1` | Work order submitted for approval | workOrderId, tenantId |
| `maintenance.workorder.approved.v1` | Work order approved | workOrderId, tenantId, reason |
| `maintenance.workorder.rejected.v1` | Work order rejected | workOrderId, tenantId, reason |
| `maintenance.workorder.assigned.v1` | Technician/vendor assigned | workOrderId, tenantId, assigneeId, assigneeType |
| `maintenance.workorder.started.v1` | Work started | workOrderId, tenantId, startDate |
| `maintenance.workorder.task.added.v1` | Task added to work order | workOrderId, tenantId, taskId, description |
| `maintenance.workorder.task.completed.v1` | Task completed | workOrderId, tenantId, taskId |
| `maintenance.workorder.parts.added.v1` | Parts requisition added | workOrderId, tenantId, partNumber, costCents |
| `maintenance.workorder.labor.recorded.v1` | Labor hours recorded | workOrderId, tenantId, hours, rateCentsPerHour |
| `maintenance.workorder.completed.v1` | Work order completed | workOrderId, tenantId, completionDate, totalCostCents |
| `maintenance.workorder.closed.v1` | Work order closed | workOrderId, tenantId |
| `maintenance.workorder.cancelled.v1` | Work order cancelled | workOrderId, tenantId, reason |
| `maintenance.workorder.hold.v1` | Work order placed on hold | workOrderId, tenantId, reason |
| `maintenance.workorder.resumed.v1` | Work order resumed from hold | workOrderId, tenantId |
| `maintenance.plan.triggered.v1` | Maintenance plan schedule triggered | planId, tenantId, vehicleId, taskDescription |

### 3.7 Event Store Schema

```sql
CREATE TABLE maintenance_events (
    event_id          UUID PRIMARY KEY,
    aggregate_id      UUID NOT NULL,
    event_type        VARCHAR(255) NOT NULL,
    event_data        JSONB NOT NULL,
    tenant_id         UUID NOT NULL,
    vehicle_id        UUID NOT NULL,
    timestamp         TIMESTAMPTZ NOT NULL,
    aggregate_version BIGINT NOT NULL,
    metadata          JSONB DEFAULT '{}'
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_maintenance_events_aggregate ON maintenance_events (aggregate_id, aggregate_version);
CREATE INDEX idx_maintenance_events_vehicle ON maintenance_events (vehicle_id, timestamp);
CREATE INDEX idx_maintenance_events_tenant_status ON maintenance_events (tenant_id, event_type);

-- Read model projection
CREATE TABLE work_order_read_model (
    work_order_id     UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    vehicle_id        UUID NOT NULL,
    fleet_id          UUID NOT NULL,
    type              VARCHAR(50) NOT NULL,
    priority          VARCHAR(20) NOT NULL,
    title             VARCHAR(500) NOT NULL,
    status            VARCHAR(50) NOT NULL,
    assigned_technician_id UUID,
    assigned_vendor_id UUID,
    total_cost_cents  BIGINT NOT NULL DEFAULT 0,
    scheduled_date    DATE,
    actual_completion_date DATE,
    created_at        TIMESTAMPTZ NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL,
    aggregate_version BIGINT NOT NULL
);
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.maintenance.domain.port.out

import com.fleetvision.maintenance.domain.model.*
import java.time.Instant
import java.util.UUID

/**
 * Event Store interface for WorkOrder event sourcing.
 */
interface WorkOrderEventStore {
    /** Append new events. Fails if version conflict (optimistic locking). */
    fun append(events: List<DomainEvent>, expectedVersion: Long)
    /** Load all events for a work order, ordered by version. */
    fun loadEvents(workOrderId: UUID): List<DomainEvent>
    /** Load events for a vehicle. */
    fun loadEventsByVehicle(vehicleId: UUID, from: Instant?, to: Instant?): List<DomainEvent>
}

/**
 * Read-model repository for WorkOrder queries.
 */
interface WorkOrderReadRepository {
    fun save(workOrder: WorkOrderReadModel): WorkOrderReadModel
    fun findById(workOrderId: UUID, tenantId: UUID): WorkOrderReadModel?
    fun findByVehicleId(vehicleId: UUID, tenantId: UUID, page: Int, size: Int): List<WorkOrderReadModel>
    fun findByStatus(status: WorkOrderStatus, tenantId: UUID, page: Int, size: Int): List<WorkOrderReadModel>
    fun findByFleetId(fleetId: UUID, tenantId: UUID, page: Int, size: Int): List<WorkOrderReadModel>
    fun findOverdue(tenantId: UUID): List<WorkOrderReadModel>
    fun findActiveByTechnician(technicianId: UUID, tenantId: UUID): List<WorkOrderReadModel>
    fun countByStatus(tenantId: UUID): Map<WorkOrderStatus, Long>
    fun search(query: String, tenantId: UUID, page: Int, size: Int): List<WorkOrderReadModel>
}

interface MaintenancePlanRepository {
    fun save(plan: MaintenancePlan): MaintenancePlan
    fun findById(planId: UUID, tenantId: UUID): MaintenancePlan?
    fun findByVehicleType(vehicleTypeId: String, tenantId: UUID): List<MaintenancePlan>
    fun findActive(tenantId: UUID): List<MaintenancePlan>
    fun delete(planId: UUID, tenantId: UUID)
}

interface VendorRepository {
    fun save(vendor: Vendor): Vendor
    fun findById(vendorId: UUID, tenantId: UUID): Vendor?
    fun findByTenant(tenantId: UUID, page: Int, size: Int): List<Vendor>
    fun findByName(name: String, tenantId: UUID): Vendor?
    fun delete(vendorId: UUID, tenantId: UUID)
}

interface PartsInventoryRepository {
    fun reserveParts(partNumber: String, quantity: Int, tenantId: UUID): Boolean
    fun releaseParts(partNumber: String, quantity: Int, tenantId: UUID)
    fun getCurrentStock(partNumber: String, tenantId: UUID): Int
    fun searchParts(query: String, tenantId: UUID, page: Int, size: Int): List<Part>
}

interface EventPublisher {
    fun publish(event: DomainEvent)
}

interface FleetManagementClient {
    fun getVehicle(vehicleId: UUID, tenantId: UUID): VehicleInfo?
    fun returnVehicleFromMaintenance(vehicleId: UUID, tenantId: UUID)
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/maintenance`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/work-orders` | List work orders (paginated, filterable) | `maintenance.wo.read` |
| `GET` | `/work-orders/{woId}` | Get work order detail with full event history | `maintenance.wo.read` |
| `POST` | `/work-orders` | Create a new work order (DRAFT) | `maintenance.wo.create` |
| `PUT` | `/work-orders/{woId}` | Update work order metadata (DRAFT only) | `maintenance.wo.update` |
| `POST` | `/work-orders/{woId}/submit` | Submit for approval | `maintenance.wo.submit` |
| `POST` | `/work-orders/{woId}/approve` | Approve work order | `maintenance.wo.approve` |
| `POST` | `/work-orders/{woId}/reject` | Reject work order | `maintenance.wo.approve` |
| `POST` | `/work-orders/{woId}/assign` | Assign technician or vendor | `maintenance.wo.assign` |
| `POST` | `/work-orders/{woId}/start` | Mark work started | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/tasks` | Add a task to work order | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/tasks/{taskId}/complete` | Complete a task | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/parts` | Add parts requisition | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/labor` | Record labor hours | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/complete` | Mark work order completed | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/close` | Close work order (final) | `maintenance.wo.close` |
| `POST` | `/work-orders/{woId}/cancel` | Cancel work order | `maintenance.wo.cancel` |
| `POST` | `/work-orders/{woId}/hold` | Place work order on hold | `maintenance.wo.execute` |
| `POST` | `/work-orders/{woId}/resume` | Resume held work order | `maintenance.wo.execute` |
| `GET` | `/work-orders/{woId}/history` | Get event history for work order | `maintenance.wo.read` |
| `GET` | `/work-orders/overdue` | List overdue work orders | `maintenance.wo.read` |
| `GET` | `/work-orders/dashboard` | Maintenance dashboard summary | `maintenance.dashboard.read` |
| `GET` | `/maintenance-plans` | List maintenance plans | `maintenance.plan.read` |
| `POST` | `/maintenance-plans` | Create maintenance plan | `maintenance.plan.create` |
| `PUT` | `/maintenance-plans/{planId}` | Update plan | `maintenance.plan.update` |
| `GET` | `/vendors` | List vendors | `maintenance.vendor.read` |
| `POST` | `/vendors` | Create vendor | `maintenance.vendor.create` |
| `PUT` | `/vendors/{vendorId}` | Update vendor | `maintenance.vendor.update` |
| `GET` | `/parts` | Search parts inventory | `maintenance.parts.read` |
| `GET` | `/parts/{partNumber}/stock` | Get current stock for part | `maintenance.parts.read` |

### 5.2 gRPC Service

```protobuf
service VehicleMaintenanceService {
  rpc GetWorkOrder (GetWorkOrderRequest) returns (WorkOrderResponse);
  rpc GetActiveWorkOrdersForVehicle (GetActiveWorkOrdersRequest) returns (GetWorkOrdersResponse);
  rpc GetMaintenanceHistory (GetMaintenanceHistoryRequest) returns (GetMaintenanceHistoryResponse);
}

message GetWorkOrderRequest {
  string work_order_id = 1;
  string tenant_id = 2;
}

message WorkOrderResponse {
  string id = 1;
  string vehicle_id = 2;
  string fleet_id = 3;
  string type = 4;
  string priority = 5;
  string title = 6;
  string status = 7;
  int64 total_cost_cents = 8;
  optional string assigned_technician_id = 9;
  optional string scheduled_date = 10;
}

message GetActiveWorkOrdersRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
}

message GetWorkOrdersResponse {
  repeated WorkOrderResponse work_orders = 1;
}

message GetMaintenanceHistoryRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
  int64 from_timestamp = 3;
  int64 to_timestamp = 4;
  int32 limit = 5;
}

message GetMaintenanceHistoryResponse {
  repeated MaintenanceSummary summaries = 1;
}

message MaintenanceSummary {
  string work_order_id = 1;
  string type = 2;
  string title = 3;
  int64 total_cost_cents = 4;
  string completion_date = 5;
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.maintenance.workorder.events` | `workOrderId` | 7 days | vehicle-maintenance-service |
| `fleetvision.maintenance.plan.events` | `planId` | 7 days | vehicle-maintenance-service |
| `fleetvision.maintenance.vendor.events` | `vendorId` | 7 days | vehicle-maintenance-service |

### 6.2 Published Events (Producer)

```json
// maintenance.workorder.created.v1
{
  "specversion": "1.0",
  "type": "maintenance.workorder.created.v1",
  "source": "/vehicle-maintenance-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "data": {
    "work_order_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "vehicle_id": "660e8400-e29b-41d4-a716-446655440001",
    "fleet_id": "770e8400-e29b-41d4-a716-446655440003",
    "type": "CORRECTIVE",
    "priority": "HIGH",
    "title": "Brake pad replacement - Front Axle",
    "odometer_km": 85234
  },
  "fleetvision": { ... }
}

// maintenance.workorder.completed.v1
{
  "specversion": "1.0",
  "type": "maintenance.workorder.completed.v1",
  "source": "/vehicle-maintenance-service",
  "id": "uuid-v4",
  "time": "2026-08-02T16:00:00.000Z",
  "data": {
    "work_order_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "vehicle_id": "660e8400-e29b-41d4-a716-446655440001",
    "completion_date": "2026-08-02",
    "total_cost_cents": 45200,
    "labor_hours": 2.5,
    "parts_cost_cents": 28000
  },
  "fleetvision": { ... }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.telemetry.diagnostic.events` | `telemetry.diagnostic.code.received.v1` | Create corrective work order if code matches known fault patterns |
| `fleetvision.tracking.vehicle.events` | `tracking.ignition.off.v1` | Check odometer against maintenance plan schedule, trigger preventive WO if due |
| `fleetvision.fleet.vehicle.events` | `fleet.vehicle.added.v1` | Apply matching maintenance plan to new vehicle |
| `fleetvision.analytics.predictive.events` | `analytics.prediction.maintenance_due.v1` | Create PREDICTIVE work order from ML model output |
| `fleetvision.billing.tenant.events` | `billing.tenant.suspended.v1` | Suspend new work order creation |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| Fleet Management | gRPC (outbound) | Vehicle info, return from maintenance |
| Telemetry & Device Mgmt | Kafka (inbound) | Diagnostic codes, device health |
| Tracking & Monitoring | Kafka (inbound) | Odometer updates, ignition events |
| Analytics Engine | Kafka (bidirectional) | Predictive maintenance triggers, WO data for models |
| Notification Service | Kafka (outbound) | WO status change alerts, overdue reminders |
| Audit Log Service | Kafka (outbound) | All maintenance event audit trails |
| Identity & Access Mgmt | gRPC (outbound) | Permission checks |
| Billing & Tenant Mgmt | Kafka (inbound) | Tenant suspension events |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **Parts Suppliers** | REST/EDI | Outbound | Parts ordering, stock queries |
| **Vendor Portals** | REST API | Bidirectional | Work order dispatch, status updates |

---

## 8. Configuration Properties

```yaml
# application-maintenance.yaml
fleetvision:
  maintenance:
    service-name: vehicle-maintenance-service

    work-order:
      auto-cancel-draft-days: 7
      auto-close-completed-days: 30
      max-open-per-vehicle: 5
      max-tasks-per-wo: 20
      max-parts-requisitions-per-wo: 50

    plan:
      odometer-check-interval-km: 500     # check schedule every N km
      default-reminder-days: 7            # remind before scheduled maintenance
      max-plans-per-tenant: 100

    vendor:
      max-vendors-per-tenant: 500

    cost:
      default-labor-rate-cents-per-hour: 8500    // $85/hr
      currency: USD

    predictive:
      enabled: true
      confidence-threshold: 0.7
      auto-create-wo: false          // require manual approval for predictive WOs

  database:
    jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_maintenance
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    pool:
      maximum-pool-size: 25
      minimum-idle: 5
    migration:
      locations: classpath:db/migration/maintenance

  redis:
    host: ${REDIS_HOST}
    port: 6379
    password: ${REDIS_PASSWORD}
    database-index: 3

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: maintenance-producer
      acks: all
      retries: 3
      compression-type: lz4
    consumer:
      group-id: maintenance-consumer
      auto-offset-reset: earliest
      enable-auto-commit: false
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| PostgreSQL (event store) | 5 failures in 30s | 30s | 3 | Buffer events in Redis, replay later |
| Fleet Mgmt gRPC | 10 failures in 30s | 10s | 5 | Use cached vehicle info |
| IAM gRPC | 10 failures in 30s | 10s | 5 | Deny operation |
| Elasticsearch (search) | 5 failures in 30s | 30s | 5 | Fall back to DB LIKE query |
| Redis (cache) | 3 failures in 10s | 10s | 5 | Skip cache |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| Event store append | 5 | Exponential (50ms base, 2x) | Full jitter |
| Fleet Mgmt gRPC call | 2 | Fixed 200ms | +/- 50ms |
| Parts reservation | 2 | Fixed 500ms | None |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |
| Database write (read model) | 3 | Exponential (50ms, 100ms, 200ms) | +/- 25% |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| gRPC requests | 3s | 5s | 8s |
| Event store write | 1s | 2s | 3s |
| Database operations | 1s | 3s | 4s |
| Kafka produce | 5s | — | 30s |

### 9.4 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Work order creation | 100/min per tenant | 200 | Token bucket |
| Work order updates | 200/min per tenant | 400 | Sliding window |
| Parts search | 150/min per user | 300 | Sliding window |
| Vendor creation | 10/min per tenant | 20 | Token bucket |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | WorkOrder state machine, event sourcing, cost calculations | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | Event store, Kafka, PostgreSQL, Redis | Testcontainers (PG, Kafka, Redis) | 80% |
| **Contract Tests** | REST/gRPC API contracts | Spring Cloud Contract | 100% |
| **Component Tests** | Full WO lifecycle with testcontainers | SpringBootTest | Critical paths |
| **End-to-End Tests** | Multi-service (diagnostic -> WO -> completion -> vehicle return) | Testcontainers Compose | Critical paths |

### 10.2 Domain Test Scenarios

**WorkOrder (Event Sourcing):**
- Create work order in DRAFT status
- Submit DRAFT work order transitions to PENDING_APPROVAL
- Submit non-DRAFT work order fails
- Approve PENDING_APPROVAL transitions to APPROVED
- Reject PENDING_APPROVAL transitions to CANCELLED
- Assign technician to APPROVED transitions to ASSIGNED
- Start work on ASSIGNED transitions to IN_PROGRESS
- Add task to IN_PROGRESS succeeds
- Complete all tasks and complete work order
- Close COMPLETED work order
- Cancel at any valid state
- Hold and resume IN_PROGRESS
- Add parts increases partsCostCents and totalCostCents
- Record labor increases laborHours and totalCostCents
- Cost calculation correctness: totalCostCents = (laborHours * rate) + parts + external
- Version conflict on concurrent append fails

**MaintenancePlan:**
- Create plan with valid schedule rules
- Trigger plan based on odometer threshold
- Add duplicate rule fails

### 10.3 Integration Test Scenarios
- WO creation persists events to event store and updates read model
- WO completion publishes Kafka event consumed by Fleet Mgmt to return vehicle
- Diagnostic code from Telemetry triggers corrective WO creation
- Predictive maintenance event creates PREDICTIVE WO

### 10.4 Contract Test Scenarios
- `POST /work-orders` returns 201 with DRAFT status
- `POST /work-orders/{id}/approve` on DRAFT returns 409
- `GetActiveWorkOrdersForVehicle` gRPC returns only non-closed WOs

### 10.5 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| WO creation throughput | 100 TPS sustained | Gatling |
| WO read (by ID) latency | < 50ms p99 | k6 |
| Event replay (10K events) | < 3 seconds total | JUnit benchmark |
| Dashboard aggregation query | < 2s p99 | k6 |

---

## Appendix A: Package Structure

```
com.fleetvision.maintenance/
├── domain/
│   ├── model/
│   │   ├── WorkOrder.kt
│   │   ├── MaintenanceTask.kt
│   │   ├── PartsRequisition.kt
│   │   ├── MaintenancePlan.kt
│   │   ├── Vendor.kt
│   │   └── valueobjects/
│   │       ├── WorkOrderId.kt
│   │       └── MaintenancePlanId.kt
│   ├── event/
│   │   ├── WorkOrderCreatedEvent.kt
│   │   ├── WorkOrderSubmittedEvent.kt
│   │   ├── TaskCompletedEvent.kt
│   │   ├── PartsAddedEvent.kt
│   │   ├── WorkOrderCompletedEvent.kt
│   │   └── ...
│   ├── service/
│   │   ├── MaintenanceCostService.kt
│   │   └── PredictiveEngineIntegration.kt
│   └── port/
│       └── out/
│           ├── WorkOrderEventStore.kt
│           ├── WorkOrderReadRepository.kt
│           ├── MaintenancePlanRepository.kt
│           ├── VendorRepository.kt
│           ├── PartsInventoryRepository.kt
│           ├── EventPublisher.kt
│           └── FleetManagementClient.kt
├── application/
│   ├── usecase/
│   │   ├── CreateWorkOrderUseCase.kt
│   │   ├── SubmitWorkOrderUseCase.kt
│   │   ├── ApproveWorkOrderUseCase.kt
│   │   ├── AssignTechnicianUseCase.kt
│   │   ├── CompleteWorkOrderUseCase.kt
│   │   ├── CloseWorkOrderUseCase.kt
│   │   ├── GeneratePredictiveMaintenanceUseCase.kt
│   │   └── GetMaintenanceDashboardUseCase.kt
│   └── dto/
│       ├── WorkOrderRequest.kt
│       ├── WorkOrderResponse.kt
│       ├── TaskRequest.kt
│       └── PartsRequisitionRequest.kt
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── WorkOrderController.kt
│   │   │   ├── MaintenancePlanController.kt
│   │   │   ├── VendorController.kt
│   │   │   └── PartsController.kt
│   │   ├── grpc/
│   │   │   └── VehicleMaintenanceGrpcService.kt
│   │   └── event/
│   │       ├── DiagnosticEventListener.kt
│   │       └── OdometerEventListener.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── eventsourcing/
│       │   │   ├── WorkOrderEventStoreAdapter.kt
│       │   │   └── WorkOrderProjection.kt
│       │   └── jpa/
│       │       ├── WorkOrderReadJpaRepository.kt
│       │       ├── MaintenancePlanJpaRepository.kt
│       │       └── VendorJpaRepository.kt
│       ├── fleet/
│       │   └── FleetManagementGrpcClient.kt
│       └── kafka/
│           └── MaintenanceEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── EventSourcingConfig.kt
│   │   ├── ProjectionConfig.kt
│   │   ├── KafkaConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── InvalidWorkOrderStateException.kt
│       ├── WorkOrderNotFoundException.kt
│       └── PartsNotAvailableException.kt
└── VehicleMaintenanceServiceApplication.kt
```
