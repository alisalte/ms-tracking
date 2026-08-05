# Telematics & Device Management Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Telematics & Device Management
**Service:** `telemetry-ingestion-service`, `device-management-service`
**Data Store:** MongoDB (device configs), TimescaleDB (telemetry time-series), PostgreSQL 16 (device registry)
**Messaging:** Kafka (domain events, telemetry pipeline), MQTT (IoT device ingestion)

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

The Telematics & Device Management context handles the complete lifecycle of IoT telematics devices installed on fleet vehicles. It covers device provisioning, firmware management (OTA updates), command dispatch, telemetry data ingestion at scale, and device health monitoring. Two closely coupled services handle ingestion (`telemetry-ingestion-service`) and device lifecycle (`device-management-service`).

### 1.2 Context Map

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│  TRACKING & MONITORING       │     │  VEHICLE MAINTENANCE          │
│  Consumes: PositionEvents,    │     │  Consumes: DiagnosticCodes,    │
│  DiagnosticCodes             │     │  DeviceHealth alerts          │
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │                                    │
┌───────────────┴───────────────┐     ┌───────────────┴───────────────┐
│  FLEET MANAGEMENT            │◄────│  TELEMATICS & DEVICE          │
│  Consumes: DeviceBound/Unbound│    │  MANAGEMENT                   │
│  events                      │     │  (This Context)               │
└───────────────┬───────────────┘     └───────┬───────────┬───────────┘
                │                             │           │
┌───────────────┴───────────────┐     ┌───────┴───┐ ┌───┴───────────┐
│  COMPLIANCE & SAFETY          │     │ ANALYTICS │ │ NOTIFICATION   │
│  Consumes: Diagnostic alerts  │     │ ENGINE    │ │ SERVICE        │
└───────────────────────────────┘     │ (all data)│ └───────────────┘
                                      └───────────┘

External:
  • Telematics Hardware (OBD-II, GPS trackers) — MQTT v5.0
  • Firmware Servers (S3/MinIO) — OTA update delivery
  • Device Manufacturers — Integration APIs
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **TelematicsDevice** | A physical hardware unit installed on a vehicle that collects GPS, engine diagnostics, and sensor data |
| **DeviceProvisioning** | The process of registering a new device, assigning it a firmware profile, and preparing it for deployment |
| **OTA Update** | Over-The-Air firmware update delivered to devices remotely without physical access |
| **DeviceCommand** | A directive sent to a device (e.g., `REBOOT`, `SET_REPORTING_INTERVAL`, `PULL_FIRMWARE`) |
| **TelemetryDataPoint** | A single sensor reading (key-value) with timestamp, device ID, and data type |
| **DiagnosticCode** | An OBD-II diagnostic trouble code (DTC) indicating a vehicle issue |
| **DeviceHealth** | A composite health score based on signal strength, battery level, last heartbeat, and data freshness |
| **FirmwareProfile** | A named configuration specifying target firmware version, rollout strategy, and compatibility rules |
| **SensorProfile** | A device-specific configuration defining which sensors to read, sampling rates, and thresholds |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│         TELEMETRY-INGESTION-SERVICE + DEVICE-MANAGEMENT-SERVICE             │
│                         (Spring Boot 3.3 + Kotlin)                         │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ MongoDB      │ │ TimescaleDB  │ │ PostgreSQL   │ │ Kafka     │ │  │
│  │  │ (Device      │ │ (Telemetry   │ │ (Device      │ │ Pipeline  │ │  │
│  │  │  Configs)    │ │  Time-series)│ │  Registry)   │ │ & Events  │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ MQTT Broker │ │ S3/MinIO     │ │ Redis       │ │ WebSocket  │ │  │
│  │  │ (EMQX/Mosquitto)│ (Firmware) │ │ (Cmd Queue) │ │ (Device    │ │  │
│  │  │              │ │              │ │             │ │  Status)   │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────┐    │  │
│  │  │ REST Controllers │ │ MQTT Message      │ │ Event Listeners  │    │  │
│  │  │ (DeviceCtrl,     │ │ Handlers         │ │ (Kafka Consumer) │    │  │
│  │  │  FirmwareCtrl,   │ │ (PositionMsgHdlr, │ │                   │    │  │
│  │  │  TelemetryCtrl)  │ │  TelemetryMsgHdlr,│ │                   │    │  │
│  │  │                  │ │  CommandRespHdlr) │ │                   │    │  │
│  │  └────────┬─────────┘ └────────┬─────────┘ └────────┬──────────┘    │  │
│  │           │                     │                      │            │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴────────┐    │  │
│  │  │ DTOs / MQTT Message Parsers / Telemetry Transformers       │    │  │
│  │  └─────────────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ ProvisionDevice  │ │ IngestTelemetry  │ │ DispatchCommand  │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ UpdateFirmware   │ │ ProcessDiagnostic│ │ MonitorDevice   │     │  │
│  │  │ OTAUseCase       │ │ CodeUseCase      │ │ HealthUseCase    │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                          │  │
│  │  │ DeactivateDevice │ │ GetDeviceStatus  │                          │  │
│  │  │ UseCase          │ │ UseCase          │                          │  │
│  │  └──────────────────┘ └──────────────────┘                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ Telematics   │ │ Firmware     │ │ DeviceCommand│ │ Sensor     │ │  │
│  │  │ Device       │ │ Profile      │ │ (Aggregate)  │ │ Profile    │ │  │
│  │  │ (Aggregate)  │ │ (Aggregate)  │ │              │ │ (Entity)   │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                   │  │
│  │  │ Telemetry    │ │ DeviceHealth │                                   │  │
│  │  │ DataPoint    │ │ Score         │                                   │  │
│  │  │ (Entity)     │ │ (Value Obj)  │                                   │  │
│  │  └──────────────┘ └──────────────┘                                   │  │
│  │  Domain Events: DeviceProvisioned, FirmwareUpdated, etc.             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design

### 3.1 TelematicsDevice Aggregate Root

**AggregateId:** `DeviceId` (UUID)
**Consistency Scope:** Device identity, provisioning status, firmware binding, sensor profile, and health within a tenant.

```kotlin
data class DeviceId(val value: UUID)

enum class DeviceStatus {
    PROVISIONED, ACTIVE, INACTIVE, FIRMWARE_UPDATING, FAULTED, DECOMMISSIONED
}

enum class DeviceType { OBD_II, GPS_TRACKER, DASHCAM, CUSTOM_SENSOR }

data class TelematicsDevice(
    val id: DeviceId,
    val tenantId: UUID,
    val serialNumber: String,              // manufacturer serial
    val imei: String?,                       // cellular IMEI (if applicable)
    val deviceType: DeviceType,
    val manufacturer: String,
    val model: String,
    val firmwareVersion: String,
    val targetFirmwareVersion: String?,
    val status: DeviceStatus,
    val boundVehicleId: UUID?,               // vehicle this device is installed on
    val sensorProfileId: UUID?,
    val lastHeartbeatAt: Instant?,
    val lastDataAt: Instant?,
    val batteryLevel: Int?,                 // percentage (for battery-powered devices)
    val signalStrength: Int?,                // dBm
    val reportingIntervalSeconds: Int,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    // --- Behaviors ---

    fun activate(): TelematicsDevice {
        require(status == DeviceStatus.PROVISIONED) { "Only PROVISIONED devices can be activated" }
        return copy(status = DeviceStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceActivatedEvent(it)) }
    }

    fun deactivate(reason: String): TelematicsDevice {
        require(status == DeviceStatus.ACTIVE) { "Only ACTIVE devices can be deactivated" }
        return copy(status = DeviceStatus.INACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceDeactivatedEvent(it, reason)) }
    }

    fun bindToVehicle(vehicleId: UUID): TelematicsDevice {
        require(status == DeviceStatus.ACTIVE || status == DeviceStatus.PROVISIONED) {
            "Only ACTIVE or PROVISIONED devices can be bound to vehicles"
        }
        require(boundVehicleId == null) { "Device is already bound to a vehicle" }
        return copy(boundVehicleId = vehicleId, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceBoundToVehicleEvent(it, vehicleId)) }
    }

    fun unbindFromVehicle(): TelematicsDevice {
        require(boundVehicleId != null) { "Device is not bound to any vehicle" }
        val previousVehicleId = boundVehicleId!!
        return copy(boundVehicleId = null, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceUnboundFromVehicleEvent(it, previousVehicleId)) }
    }

    fun startFirmwareUpdate(targetVersion: String): TelematicsDevice {
        require(status == DeviceStatus.ACTIVE) { "Only ACTIVE devices can receive firmware updates" }
        require(targetVersion != firmwareVersion) { "Already on target version" }
        return copy(
            status = DeviceStatus.FIRMWARE_UPDATING,
            targetFirmwareVersion = targetVersion,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(FirmwareUpdateStartedEvent(it, firmwareVersion, targetVersion)) }
    }

    fun completeFirmwareUpdate(newVersion: String): TelematicsDevice {
        require(status == DeviceStatus.FIRMWARE_UPDATING) { "Device is not undergoing firmware update" }
        require(newVersion == targetFirmwareVersion) { "Version mismatch: expected $targetFirmwareVersion, got $newVersion" }
        return copy(
            firmwareVersion = newVersion,
            targetFirmwareVersion = null,
            status = DeviceStatus.ACTIVE,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(FirmwareUpdateCompletedEvent(it, newVersion)) }
    }

    fun failFirmwareUpdate(reason: String): TelematicsDevice {
        require(status == DeviceStatus.FIRMWARE_UPDATING) { "Device is not undergoing firmware update" }
        return copy(
            status = DeviceStatus.FAULTED,
            targetFirmwareVersion = null,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(FirmwareUpdateFailedEvent(it, targetFirmwareVersion!!, reason)) }
    }

    fun recordHeartbeat(batteryLevel: Int?, signalStrength: Int?): TelematicsDevice {
        val now = Instant.now()
        val updated = copy(
            lastHeartbeatAt = now,
            batteryLevel = batteryLevel ?: this.batteryLevel,
            signalStrength = signalStrength ?: this.signalStrength,
            updatedAt = now
        )
        // Emit fault event if no heartbeat for too long (checked at application layer)
        return updated
    }

    fun recordDataReceived(): TelematicsDevice =
        copy(lastDataAt = Instant.now(), updatedAt = Instant.now())

    fun markFaulted(reason: String): TelematicsDevice {
        require(status != DeviceStatus.DECOMMISSIONED) { "Decommissioned devices cannot be faulted" }
        return copy(status = DeviceStatus.FAULTED, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceFaultedEvent(it, reason)) }
    }

    fun recoverFromFault(): TelematicsDevice {
        require(status == DeviceStatus.FAULTED) { "Only FAULTED devices can be recovered" }
        return copy(status = DeviceStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceRecoveredEvent(it)) }
    }

    fun decommission(): TelematicsDevice {
        require(status in listOf(DeviceStatus.INACTIVE, DeviceStatus.FAULTED)) {
            "Only INACTIVE or FAULTED devices can be decommissioned"
        }
        return copy(status = DeviceStatus.DECOMMISSIONED, boundVehicleId = null, updatedAt = Instant.now())
            .also { raiseDomainEvent(DeviceDecommissionedEvent(it)) }
    }

    fun setReportingInterval(seconds: Int): TelematicsDevice {
        require(seconds in 1..3600) { "Reporting interval must be 1-3600 seconds" }
        return copy(reportingIntervalSeconds = seconds, updatedAt = Instant.now())
            .also { raiseDomainEvent(ReportingIntervalChangedEvent(it, seconds)) }
    }

    // --- Invariants ---
    // INV-01: serialNumber must be unique across platform
    // INV-02: imei must be unique across platform (if present)
    // INV-03: boundVehicleId must reference an existing vehicle (checked at application layer)
    // INV-04: firmwareVersion must match a known firmware profile version
    // INV-05: reportingIntervalSeconds must be within [1, 3600]
}
```

### 3.2 FirmwareProfile Aggregate Root

```kotlin
data class FirmwareProfileId(val value: UUID)

enum class RolloutStrategy { IMMEDIATE, STAGED, CANARY, SCHEDULED }

data class FirmwareProfile(
    val id: FirmwareProfileId,
    val tenantId: UUID,
    val name: String,
    val version: String,
    val deviceType: DeviceType,
    val manufacturer: String,
    val modelCompatibility: List<String>,     // compatible device models
    val minVersion: String,                   // minimum current version to upgrade from
    val rolloutStrategy: RolloutStrategy,
    val stagedPercentage: Int?,               // for STAGED strategy (e.g., 10%, 25%, 50%, 100%)
    val canaryDeviceIds: Set<UUID>?,          // for CANARY strategy
    val scheduledAt: Instant?,                // for SCHEDULED strategy
    val firmwareUrl: String,                 // S3/MinIO URL for firmware binary
    val firmwareChecksumSha256: String,
    val firmwareSizeBytes: Long,
    val releaseNotes: String,
    val status: FirmwareStatus,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun approve(): FirmwareProfile =
        copy(status = FirmwareStatus.APPROVED, updatedAt = Instant.now())
            .also { raiseDomainEvent(FirmwareApprovedEvent(it)) }

    fun publish(): FirmwareProfile {
        require(status == FirmwareStatus.APPROVED) { "Only approved profiles can be published" }
        return copy(status = FirmwareStatus.PUBLISHED, updatedAt = Instant.now())
            .also { raiseDomainEvent(FirmwarePublishedEvent(it)) }
    }

    fun revoke(reason: String): FirmwareProfile =
        copy(status = FirmwareStatus.REVOKED, updatedAt = Instant.now())
            .also { raiseDomainEvent(FirmwareRevokedEvent(it, reason)) }

    // INV-01: version must be unique within tenant + deviceType
    // INV-02: firmwareUrl must point to a valid binary (checked on approval)
    // INV-03: stagedPercentage must be in 1..100 if STAGED strategy
}

enum class FirmwareStatus { DRAFT, APPROVED, PUBLISHED, REVOKED }
```

### 3.3 DeviceCommand Aggregate Root

```kotlin
data class CommandId(val value: UUID)

enum class CommandType {
    REBOOT, SET_REPORTING_INTERVAL, PULL_FIRMWARE, SEND_DIAGNOSTIC_QUERY,
    RESET_DEVICE, ENABLE_SENSOR, DISABLE_SENSOR, SET_GEOFENCE_CONFIG
}

enum class CommandStatus { PENDING, SENT, ACKNOWLEDGED, COMPLETED, FAILED, EXPIRED }

data class DeviceCommand(
    val id: CommandId,
    val tenantId: UUID,
    val deviceId: UUID,
    val commandType: CommandType,
    val payload: Map<String, Any>,
    val status: CommandStatus,
    val sentAt: Instant?,
    val acknowledgedAt: Instant?,
    val completedAt: Instant?,
    val response: Map<String, Any>?,
    val errorMessage: String?,
    val expiresAt: Instant,
    val retryCount: Int,
    val maxRetries: Int,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun send(): DeviceCommand {
        require(status == CommandStatus.PENDING) { "Only PENDING commands can be sent" }
        return copy(status = CommandStatus.SENT, sentAt = Instant.now(), updatedAt = Instant.now())
            .also { raiseDomainEvent(CommandSentEvent(it)) }
    }

    fun acknowledge(): DeviceCommand {
        require(status == CommandStatus.SENT) { "Only SENT commands can be acknowledged" }
        return copy(status = CommandStatus.ACKNOWLEDGED, acknowledgedAt = Instant.now(), updatedAt = Instant.now())
    }

    fun complete(response: Map<String, Any>): DeviceCommand {
        require(status == CommandStatus.ACKNOWLEDGED) { "Only ACKNOWLEDGED commands can be completed" }
        return copy(
            status = CommandStatus.COMPLETED,
            completedAt = Instant.now(),
            response = response,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(CommandCompletedEvent(it, response)) }
    }

    fun fail(error: String): DeviceCommand {
        require(status in listOf(CommandStatus.SENT, CommandStatus.ACKNOWLEDGED)) {
            "Only SENT or ACKNOWLEDGED commands can fail"
        }
        val newRetryCount = retryCount + 1
        return if (newRetryCount < maxRetries) {
            copy(
                status = CommandStatus.PENDING,
                retryCount = newRetryCount,
                errorMessage = error,
                updatedAt = Instant.now()
            )
        } else {
            copy(
                status = CommandStatus.FAILED,
                retryCount = newRetryCount,
                errorMessage = error,
                updatedAt = Instant.now()
            ).also { raiseDomainEvent(CommandFailedEvent(it, error)) }
        }
    }

    fun expire(): DeviceCommand {
        require(status in listOf(CommandStatus.PENDING, CommandStatus.SENT)) { "Cannot expire in $status" }
        return copy(status = CommandStatus.EXPIRED, updatedAt = Instant.now())
            .also { raiseDomainEvent(CommandExpiredEvent(it)) }
    }

    // INV-01: expiresAt must be in the future
    // INV-02: maxRetries must be >= 0
    // INV-03: retryCount must not exceed maxRetries
}
```

### 3.4 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `telemetry.device.provisioned.v1` | New device registered | deviceId, tenantId, serialNumber, deviceType, manufacturer, model |
| `telemetry.device.activated.v1` | Device activated | deviceId, tenantId |
| `telemetry.device.deactivated.v1` | Device deactivated | deviceId, tenantId, reason |
| `telemetry.device.bound.v1` | Device bound to vehicle | deviceId, tenantId, vehicleId |
| `telemetry.device.unbound.v1` | Device unbound from vehicle | deviceId, tenantId, vehicleId |
| `telemetry.device.faulted.v1` | Device entered fault state | deviceId, tenantId, reason |
| `telemetry.device.recovered.v1` | Device recovered from fault | deviceId, tenantId |
| `telemetry.device.decommissioned.v1` | Device decommissioned | deviceId, tenantId |
| `telemetry.firmware.update.started.v1` | Firmware update initiated | deviceId, tenantId, fromVersion, toVersion |
| `telemetry.firmware.update.completed.v1` | Firmware update succeeded | deviceId, tenantId, newVersion |
| `telemetry.firmware.update.failed.v1` | Firmware update failed | deviceId, tenantId, targetVersion, reason |
| `telemetry.firmware.profile.published.v1` | Firmware profile published | profileId, tenantId, version |
| `telemetry.command.sent.v1` | Command dispatched to device | commandId, deviceId, tenantId, commandType |
| `telemetry.command.completed.v1` | Command completed | commandId, deviceId, tenantId, response |
| `telemetry.command.failed.v1` | Command failed permanently | commandId, deviceId, tenantId, error |
| `telemetry.diagnostic.code.received.v1` | OBD-II DTC received | deviceId, tenantId, vehicleId, code, description |

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.telemetry.domain.port.out

import com.fleetvision.telemetry.domain.model.*
import java.time.Instant
import java.util.UUID

interface TelematicsDeviceRepository {
    fun save(device: TelematicsDevice): TelematicsDevice
    fun findById(deviceId: UUID, tenantId: UUID): TelematicsDevice?
    fun findBySerialNumber(serialNumber: String): TelematicsDevice?
    fun existsBySerialNumber(serialNumber: String): Boolean
    fun existsByImei(imei: String): Boolean
    fun findByVehicleId(vehicleId: UUID, tenantId: UUID): TelematicsDevice?
    fun findByStatus(status: DeviceStatus, tenantId: UUID, page: Int, size: Int): List<TelematicsDevice>
    fun findActiveDevices(tenantId: UUID): List<TelematicsDevice>
    fun findDevicesNeedingFirmwareUpdate(profileId: UUID, tenantId: UUID): List<TelematicsDevice>
    fun findStaleDevices(since: Instant, tenantId: UUID): List<TelematicsDevice>
    fun countByStatus(tenantId: UUID): Map<DeviceStatus, Long>
    fun delete(deviceId: UUID, tenantId: UUID)
}

interface FirmwareProfileRepository {
    fun save(profile: FirmwareProfile): FirmwareProfile
    fun findById(profileId: UUID, tenantId: UUID): FirmwareProfile?
    fun findByVersion(version: String, tenantId: UUID): FirmwareProfile?
    fun findPublishedByDeviceType(deviceType: DeviceType, tenantId: UUID): List<FirmwareProfile>
    fun findLatestPublished(deviceType: DeviceType, manufacturer: String, tenantId: UUID): FirmwareProfile?
    fun delete(profileId: UUID, tenantId: UUID)
}

interface DeviceCommandRepository {
    fun save(command: DeviceCommand): DeviceCommand
    fun findById(commandId: UUID, tenantId: UUID): DeviceCommand?
    fun findPendingByDeviceId(deviceId: UUID, tenantId: UUID): List<DeviceCommand>
    fun findExpired(now: Instant): List<DeviceCommand>
    fun delete(commandId: UUID, tenantId: UUID)
}

interface TelemetryRepository {
    /** Write a batch of telemetry data points to TimescaleDB */
    fun saveBatch(dataPoints: List<TelemetryDataPoint>)
    /** Query telemetry for a device within a time range */
    fun findByDeviceAndTimeRange(deviceId: UUID, from: Instant, to: Instant, limit: Int): List<TelemetryDataPoint>
    /** Get latest telemetry values for a device */
    fun findLatest(deviceId: UUID): List<TelemetryDataPoint>
    /** Find devices reporting specific diagnostic codes */
    fun findDiagnosticCodes(deviceId: UUID, from: Instant): List<DiagnosticCode>
}

interface DeviceConfigRepository {
    /** MongoDB-based device configuration storage */
    fun saveConfig(deviceId: UUID, config: SensorProfile)
    fun getConfig(deviceId: UUID): SensorProfile?
    fun deleteConfig(deviceId: UUID)
}

interface EventPublisher {
    fun publish(event: DomainEvent)
}

interface MqttCommandPublisher {
    fun publishCommand(deviceId: String, commandType: String, payload: Map<String, Any>)
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/telemetry`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/devices` | List devices (paginated, filterable by status/type) | `telemetry.device.read` |
| `GET` | `/devices/{deviceId}` | Get device detail | `telemetry.device.read` |
| `POST` | `/devices` | Provision a new device | `telemetry.device.create` |
| `PUT` | `/devices/{deviceId}` | Update device metadata | `telemetry.device.update` |
| `PATCH` | `/devices/{deviceId}/status` | Activate/deactivate/decommission device | `telemetry.device.manage` |
| `GET` | `/devices/{deviceId}/health` | Get device health score and status | `telemetry.device.read` |
| `GET` | `/devices/{deviceId}/telemetry` | Get telemetry data (time range query) | `telemetry.data.read` |
| `GET` | `/devices/{deviceId}/diagnostics` | Get diagnostic codes | `telemetry.data.read` |
| `POST` | `/devices/{deviceId}/commands` | Send command to device | `telemetry.command.send` |
| `GET` | `/devices/{deviceId}/commands` | List commands for device | `telemetry.command.read` |
| `GET` | `/devices/{deviceId}/commands/{commandId}` | Get command detail and status | `telemetry.command.read` |
| `GET` | `/devices/stale` | List devices with stale heartbeats | `telemetry.device.read` |
| `GET` | `/firmware-profiles` | List firmware profiles | `telemetry.firmware.read` |
| `POST` | `/firmware-profiles` | Create firmware profile | `telemetry.firmware.create` |
| `PUT` | `/firmware-profiles/{profileId}` | Update firmware profile | `telemetry.firmware.update` |
| `POST` | `/firmware-profiles/{profileId}/approve` | Approve firmware for rollout | `telemetry.firmware.manage` |
| `POST` | `/firmware-profiles/{profileId}/publish` | Publish firmware | `telemetry.firmware.manage` |
| `POST` | `/firmware-profiles/{profileId}/revoke` | Revoke firmware | `telemetry.firmware.manage` |
| `POST` | `/firmware-rollout` | Initiate firmware rollout | `telemetry.firmware.manage` |
| `GET` | `/firmware-rollout/{rolloutId}/status` | Get rollout progress | `telemetry.firmware.read` |
| `GET` | `/sensor-profiles` | List sensor profiles | `telemetry.device.read` |
| `POST` | `/sensor-profiles` | Create sensor profile | `telemetry.device.create` |

### 5.2 MQTT Topics (Device Communication)

```
# Device-to-Platform (Inbound)
fleetvision/{tenantId}/devices/{deviceId}/position    — GPS position data
fleetvision/{tenantId}/devices/{deviceId}/telemetry   — Sensor data
fleetvision/{tenantId}/devices/{deviceId}/diagnostic   — OBD-II DTC codes
fleetvision/{tenantId}/devices/{deviceId}/heartbeat    — Device heartbeat
fleetvision/{tenantId}/devices/{deviceId}/command/response — Command response
fleetvision/{tenantId}/devices/{deviceId}/firmware/status — Firmware update progress

# Platform-to-Device (Outbound)
fleetvision/{tenantId}/devices/{deviceId}/command     — Dispatch commands
fleetvision/{tenantId}/devices/{deviceId}/config       — Push configuration updates
```

### 5.3 gRPC Service

```protobuf
service DeviceManagementService {
  rpc GetDevice (GetDeviceRequest) returns (DeviceResponse);
  rpc LookupDeviceByVehicle (LookupDeviceByVehicleRequest) returns (DeviceResponse);
  rpc GetDeviceHealth (GetDeviceHealthRequest) returns (DeviceHealthResponse);
  rpc SendCommand (SendCommandRequest) returns (CommandResponse);
}

message GetDeviceRequest {
  string device_id = 1;
  string tenant_id = 2;
}

message DeviceResponse {
  string id = 1;
  string serial_number = 2;
  string device_type = 3;
  string manufacturer = 4;
  string model = 5;
  string firmware_version = 6;
  string status = 7;
  optional string bound_vehicle_id = 8;
  int64 last_heartbeat_at = 9;
  optional int32 battery_level = 10;
  optional int32 signal_strength = 11;
}

message LookupDeviceByVehicleRequest {
  string vehicle_id = 1;
  string tenant_id = 2;
}

message DeviceHealthResponse {
  string device_id = 1;
  string overall_status = 2;    // HEALTHY, DEGRADED, CRITICAL, OFFLINE
  double health_score = 3;       // 0.0-100.0
  int32 days_since_last_data = 4;
  bool firmware_current = 5;
  repeated string active_dtc_codes = 6;
}

message SendCommandRequest {
  string device_id = 1;
  string tenant_id = 2;
  string command_type = 3;
  map<string, string> payload = 4;
}

message CommandResponse {
  string command_id = 1;
  string status = 2;
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.telemetry.device.events` | `deviceId` | 7 days | device-management-service |
| `fleetvision.telemetry.firmware.events` | `profileId` | 7 days | device-management-service |
| `fleetvision.telemetry.command.events` | `commandId` | 7 days | device-management-service |
| `fleetvision.telemetry.position.raw` | `deviceId` | 3 days | telemetry-ingestion-service |
| `fleetvision.telemetry.sensor.raw` | `deviceId` | 3 days | telemetry-ingestion-service |

### 6.2 Published Events (Producer)

```json
// telemetry.device.provisioned.v1
{
  "specversion": "1.0",
  "type": "telemetry.device.provisioned.v1",
  "source": "/device-management-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "data": {
    "device_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "770e8400-e29b-41d4-a716-446655440002",
    "serial_number": "TM-2024-0042",
    "imei": "490154203237518",
    "device_type": "OBD_II",
    "manufacturer": "CalAmp",
    "model": "LMU-3030",
    "firmware_version": "3.2.1"
  },
  "fleetvision": { ... }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.fleet.vehicle.events` | `fleet.vehicle.device.bound.v1` | Validate device exists and is ACTIVE |
| `fleetvision.fleet.vehicle.events` | `fleet.vehicle.decommissioned.v1` | Decommission bound device |
| `fleetvision.maintenance.workorder.events` | `maintenance.workorder.diagnostic_requested.v1` | Send diagnostic query command to device |
| `fleetvision.billing.tenant.events` | `billing.tenant.suspended.v1` | Suspend all device communications |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| Tracking & Monitoring | Kafka (outbound) | Publish position events for live tracking |
| Vehicle Maintenance | Kafka (outbound) | Publish diagnostic codes for maintenance triage |
| Fleet Management | Kafka (outbound) | Publish device bound/unbound events |
| Notification Service | Kafka (outbound) | Device fault alerts, firmware status alerts |
| Analytics Engine | Kafka (outbound) | All telemetry data for analytics |
| Audit Log Service | Kafka (outbound) | Device lifecycle audit trails |
| Identity & Access Mgmt | gRPC (outbound) | Permission checks |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **MQTT Broker (EMQX)** | MQTT v5.0 | Bidirectional | IoT device communication, device command delivery |
| **S3/MinIO** | S3 API | Outbound | Firmware binary storage and distribution |
| **Device Manufacturers** | REST API | Outbound | Device provisioning APIs (CalAmp, Geotab, etc.) |

---

## 8. Configuration Properties

```yaml
# application-telemetry.yaml
fleetvision:
  telemetry:
    service-name: telemetry-ingestion-service

    device:
      heartbeat-timeout-seconds: 600
      data-stale-threshold-seconds: 1800
      default-reporting-interval: 60
      max-devices-per-tenant: 50000

    firmware:
      max-binary-size-mb: 100
      rollout-staged-intervals: [10, 25, 50, 100]
      max-rollback-attempts: 3
      update-timeout-seconds: 600

    command:
      default-timeout-seconds: 300
      default-max-retries: 3
      max-commands-per-device: 50
      command-rate-per-minute: 10

    ingestion:
      batch-size: 1000
      flush-interval-ms: 500
      max-consumers: 20
      position-dedup-window-ms: 5000
      max-sensors-per-device: 100

  mqtt:
    broker-url: ${MQTT_BROKER_URL}
    client-id-prefix: fleetvision-telemetry
    connection-timeout: 10s
    keep-alive-seconds: 60
    max-inflight: 100
    clean-session: false
    topics:
      position: fleetvision/+/devices/+/position
      telemetry: fleetvision/+/devices/+/telemetry
      diagnostic: fleetvision/+/devices/+/diagnostic
      heartbeat: fleetvision/+/devices/+/heartbeat
      command-response: fleetvision/+/devices/+/command/response
      firmware-status: fleetvision/+/devices/+/firmware/status

  database:
    primary:
      jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_telemetry
      pool:
        maximum-pool-size: 20
        minimum-idle: 5
    timescale:
      jdbc-url: jdbc:postgresql://${TIMESCALEDB_HOST}:5432/fleetvision_telemetry_ts
      pool:
        maximum-pool-size: 20
        minimum-idle: 5

  mongodb:
    uri: mongodb://${MONGO_HOST}:27017/fleetvision_telemetry
    database: fleetvision_telemetry
    collection: device-configs

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: telemetry-producer
      acks: all
      retries: 3
      compression-type: lz4
      batch-size: 32768
    consumer:
      group-id: telemetry-ingestion-consumer
      auto-offset-reset: latest
      enable-auto-commit: false
      max-poll-records: 2000
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| PostgreSQL (device registry) | 5 failures in 30s | 30s | 3 | Buffer writes in Redis |
| TimescaleDB (telemetry) | 5 failures in 30s | 30s | 3 | Buffer in local disk queue |
| MongoDB (device configs) | 3 failures in 30s | 30s | 3 | Use default sensor profile |
| MQTT Broker | 5 failures in 30s | 30s | 3 | Queue commands for retry |
| S3/MinIO (firmware) | 3 failures in 60s | 120s | 2 | Return firmware unavailable error |
| IAM gRPC | 10 failures in 30s | 10s | 5 | Deny operation |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| MQTT publish | 3 | Fixed 1s | None |
| Database write | 3 | Exponential (50ms, 100ms, 200ms) | +/- 25% |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |
| Firmware download (S3) | 3 | Exponential (1s, 2s, 4s) | +/- 20% |
| Device command dispatch | 3 (device retries) | Exponential (5s, 10s, 20s) | +/- 10% |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| MQTT operations | 10s | 30s | 40s |
| PostgreSQL operations | 1s | 3s | 4s |
| TimescaleDB batch write | 2s | 10s | 12s |
| MongoDB operations | 2s | 5s | 7s |
| S3 operations | 5s | 30s | 35s |
| Kafka produce | 5s | — | 30s |

### 9.4 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Device provisioning | 50/min per tenant | 100 | Token bucket |
| Device commands | 10/min per device | 20 | Fixed window |
| Telemetry queries | 200/min per user | 400 | Sliding window |
| Firmware profile creation | 5/min per tenant | 10 | Fixed window |
| OTA rollout initiation | 1/hour per tenant | 2 | Fixed window |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | Device lifecycle, firmware logic, command state machine | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | All data stores, MQTT, Kafka | Testcontainers (PG, TimescaleDB, Mongo, Kafka, EMQX) | 80% |
| **Contract Tests** | REST/gRPC API contracts | Spring Cloud Contract | 100% |
| **Component Tests** | Full ingestion pipeline | SpringBootTest | Critical paths |
| **Load Tests** | High-throughput telemetry ingestion | Gatling / k6 | Performance budgets |

### 10.2 Domain Test Scenarios

**TelematicsDevice:**
- Provision device with valid data succeeds
- Provision device with duplicate serial number fails
- Activate PROVISIONED device succeeds
- Activate already-ACTIVE device fails
- Bind device to vehicle when ACTIVE succeeds
- Bind device when FIRMWARE_UPDATING fails
- Start firmware update on ACTIVE device succeeds
- Complete firmware update with version mismatch fails
- Fail firmware update transitions to FAULTED
- Recover FAULTED device succeeds
- Decommission INACTIVE device succeeds
- Decommission ACTIVE device fails

**FirmwareProfile:**
- Create DRAFT profile succeeds
- Publish non-APPROVED profile fails
- Revoke PUBLISHED profile succeeds

**DeviceCommand:**
- Send PENDING command succeeds
- Complete non-ACKNOWLEDGED command fails
- Fail command with retries remaining resets to PENDING
- Fail command with no retries remaining transitions to FAILED

### 10.3 Integration Test Scenarios

- MQTT position message ingested, parsed, stored in TimescaleDB, published to Kafka
- Device heartbeat updates device health in PostgreSQL
- Firmware rollout staged: 10% devices updated first
- Command dispatch via MQTT, response received, command completed
- Diagnostic code from device triggers maintenance event

### 10.4 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| Telemetry ingestion throughput | 100,000 data points/sec | k6 / custom MQTT producer |
| Position ingestion end-to-end latency | < 20ms p99 | Gatling |
| Device command round-trip time | < 5s p99 | Custom MQTT test |
| Batch TimescaleDB write (10K points) | < 1s p99 | pgbench |
| Concurrent device heartbeats (10K) | < 100ms p99 per device | k6 |

---

## Appendix A: Package Structure

```
com.fleetvision.telemetry/
├── domain/
│   ├── model/
│   │   ├── TelematicsDevice.kt
│   │   ├── FirmwareProfile.kt
│   │   ├── DeviceCommand.kt
│   │   ├── TelemetryDataPoint.kt
│   │   ├── DiagnosticCode.kt
│   │   ├── DeviceHealth.kt
│   │   └── valueobjects/
│   │       ├── DeviceId.kt
│   │       ├── FirmwareProfileId.kt
│   │       └── SensorProfile.kt
│   ├── event/
│   │   ├── DeviceProvisionedEvent.kt
│   │   ├── DeviceActivatedEvent.kt
│   │   ├── FirmwareUpdateStartedEvent.kt
│   │   ├── CommandSentEvent.kt
│   │   └── ...
│   └── port/
│       └── out/
│           ├── TelematicsDeviceRepository.kt
│           ├── FirmwareProfileRepository.kt
│           ├── DeviceCommandRepository.kt
│           ├── TelemetryRepository.kt
│           ├── DeviceConfigRepository.kt
│           ├── EventPublisher.kt
│           └── MqttCommandPublisher.kt
├── application/
│   ├── usecase/
│   │   ├── ProvisionDeviceUseCase.kt
│   │   ├── IngestTelemetryUseCase.kt
│   │   ├── DispatchCommandUseCase.kt
│   │   ├── UpdateFirmwareOTAUseCase.kt
│   │   ├── ProcessDiagnosticCodeUseCase.kt
│   │   ├── MonitorDeviceHealthUseCase.kt
│   │   └── DeactivateDeviceUseCase.kt
│   └── dto/
│       ├── DeviceRequest.kt
│       ├── DeviceResponse.kt
│       ├── FirmwareProfileDto.kt
│       ├── TelemetryQueryDto.kt
│       └── CommandDto.kt
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── DeviceController.kt
│   │   │   ├── FirmwareController.kt
│   │   │   ├── TelemetryController.kt
│   │   │   └── CommandController.kt
│   │   ├── mqtt/
│   │   │   ├── MqttPositionHandler.kt
│   │   │   ├── MqttTelemetryHandler.kt
│   │   │   ├── MqttDiagnosticHandler.kt
│   │   │   ├── MqttHeartbeatHandler.kt
│   │   │   └── MqttCommandResponseHandler.kt
│   │   ├── grpc/
│   │   │   └── DeviceManagementGrpcService.kt
│   │   └── event/
│   │       └── TelemetryEventConsumer.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── jpa/
│       │   │   ├── DeviceJpaRepository.kt
│       │   │   └── FirmwareJpaRepository.kt
│       │   ├── timescale/
│       │   │   └── TelemetryRepositoryAdapter.kt
│       │   └── mongo/
│       │       └── DeviceConfigMongoRepository.kt
│       ├── mqtt/
│       │   └── MqttCommandPublisherAdapter.kt
│       ├── storage/
│       │   └── FirmwareStorageAdapter.kt
│       └── kafka/
│           └── TelemetryEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── MqttConfig.kt
│   │   ├── TimescaleDbConfig.kt
│   │   ├── MongoConfig.kt
│   │   ├── KafkaConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── DeviceAlreadyExistsException.kt
│       ├── DeviceNotActiveException.kt
│       └── FirmwareUpdateException.kt
└── TelemetryServiceApplication.kt
```
