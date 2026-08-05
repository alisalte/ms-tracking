# Notification & Alerting Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Service:** `notification-service`
**Bounded Context:** Notification & Alerting

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate Root Designs](#3-aggregate-root-designs)
4. [Repository Interfaces](#4-repository-interfaces)
5. [API Endpoints](#5-api-endpoints)
6. [Kafka Event Contracts](#6-kafka-event-contracts)
7. [Multi-Channel Delivery Architecture](#7-multi-channel-delivery-architecture)
8. [Dependencies & External Integrations](#8-dependencies--external-integrations)
9. [Configuration Properties](#9-configuration-properties)
10. [Resilience Patterns](#10-resilience-patterns)
11. [Test Strategy](#11-test-strategy)

---

## 1. Module Overview & Context Mapping

### 1.1 Purpose

The Notification & Alerting context is an infrastructure service responsible for delivering multi-channel notifications (email, SMS, push, in-app) to fleet operators, drivers, and administrators. It consumes alert events from all bounded contexts, applies routing rules based on severity and user preferences, manages notification preferences and opt-outs, tracks delivery status, and handles alert escalation workflows.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                NOTIFICATION & ALERTING CONTEXT                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Notification  │  │ AlertRule    │  │ UserPref-    │          │
│  │ (Aggregate)   │  │ (Aggregate)  │  │ erence      │          │
│  └──────────────┘  └──────────────┘  │ (Aggregate)  │          │
│                                      └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Escalation   │  │ DeliveryRec  │  Delivery Channels:          │
│  │ Policy       │  │ ord (Read)    │  - EmailChannel (SMTP/SES)   │
│  │ (Aggregate)  │  └──────────────┘  - SMSChannel (Twilio/SNS)  │
│  └──────────────┘                    - PushChannel (FCM/APNs)   │
│                                      - InAppChannel (WebSocket)  │
│                                      - SlackChannel (Webhook)    │
│                                                                  │
└────────┬──────────┬──────────────────┬───────────────┬───────────┘
         │          │                  │               │
    ┌────┴──────────┴──────────────────┴──────────────┴────────┐
    │  ALL Services (producers of alert/notification events)     │
    └───────────────────────────────────────────────────────────┘
```

**Downstream (consumes events from ALL contexts):**
- `tracking-service` — Geofence alerts, speed alerts, idling alerts
- `compliance-service` — HOS violation alerts, DVIR alerts, incident escalation
- `fuel-management-service` — Fraud alerts, card status alerts
- `vehicle-maintenance-service` — Maintenance due alerts, diagnostic alerts
- `analytics-engine` — KPI threshold breach alerts, anomaly alerts, predictive alerts
- `billing-service` — Invoice alerts, payment failure alerts
- `asset-lifecycle-service` — Warranty expiration alerts, disposal reminders

**Outbound (delivers to):**
- Email providers (AWS SES, SendGrid)
- SMS providers (Twilio, AWS SNS)
- Push notification services (Firebase FCM, Apple APNs)
- In-app (WebSocket / Socket.IO)
- Slack / Microsoft Teams (webhooks)

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **Notification** | A message delivered to a user through one or more channels |
| **AlertRule** | A rule defining when and how an alert should be triggered and routed |
| **AlertSeverity** | Classification of alert urgency: `INFO`, `WARNING`, `HIGH`, `CRITICAL` |
| **NotificationChannel** | A delivery mechanism: `EMAIL`, `SMS`, `PUSH`, `IN_APP`, `SLACK` |
| **UserPreference** | A user's notification channel preferences, quiet hours, and opt-out settings |
| **EscalationPolicy** | A policy defining time-based escalation when alerts are not acknowledged |
| **DeliveryRecord** | A record tracking the delivery status of a notification to a specific channel |
| **QuietHours** | A user-configured time window during which non-critical notifications are suppressed |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    notification-service                          │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST Controllers│  │  WebSocket Handlers          │   │  │
│  │  │  (Spring MVC)    │  │  (InAppNotificationHandler)  │   │  │
│  │  └────────┬────────┘  └──────────────┬───────────────┘   │  │
│  │           │                          │                    │  │
│  │  ┌────────┴────────┐  ┌─────────────┴──────────────┐    │  │
│  │  │  DTO Mappers   │  │  Channel Adapters           │    │  │
│  │  │  (MapStruct)   │  │  • EmailChannelAdapter      │    │  │
│  │  └─────────────────┘  │  • SMSChannelAdapter        │    │  │
│  │                       │  • PushChannelAdapter       │    │  │
│  │  ┌────────────────┐   │  • InAppChannelAdapter      │    │  │
│  │  │  Template      │   │  • SlackChannelAdapter      │    │  │
│  │  │  Engine        │   │  • WebhookChannelAdapter    │    │  │
│  │  │  (Mustache)    │   └──────────────────────────────┘    │  │
│  │  └────────────────┘                                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Command Handlers                                  │    │  │
│  │  │  • SendNotificationCommandHandler                  │    │  │
│  │  │  • CreateUserPreferenceCommandHandler              │    │  │
│  │  │  • UpdateUserPreferenceCommandHandler              │    │  │
│  │  │  • AcknowledgeAlertCommandHandler                  │    │  │
│  │  │  • CreateAlertRuleCommandHandler                   │    │  │
│  │  │  • CreateEscalationPolicyCommandHandler             │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Query Handlers (CQRS)                              │    │  │
│  │  │  • GetNotificationQueryHandler                     │    │  │
│  │  │  • GetUserNotificationsQueryHandler                │    │  │
│  │  │  • GetUserPreferencesQueryHandler                   │    │  │
│  │  │  • GetAlertRulesQueryHandler                       │    │  │
│  │  │  • GetDeliveryStatusQueryHandler                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Services                                    │    │  │
│  │  │  • NotificationRouter                              │    │  │
│  │  │  • AlertRuleEvaluator                              │    │  │
│  │  │  • EscalationManager                               │    │  │
│  │  │  • PreferenceResolver                              │    │  │
│  │  │  • RateLimitEnforcer                               │    │  │
│  │  │  • QuietHoursChecker                               │    │  │
│  │  │  • DeduplicationService                            │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Aggregate Roots                                    │    │  │
│  │  │  • Notification                                     │    │  │
│  │  │  • AlertRule                                        │    │  │
│  │  │  • UserPreference                                   │    │  │
│  │  │  • EscalationPolicy                                 │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • AlertSeverity, NotificationChannel              │    │  │
│  │  │  • DeliveryStatus, ChannelDeliveryResult           │    │  │
│  │  │  • Recipient, QuietHours, TimeWindow               │    │  │
│  │  │  • NotificationTemplate, TemplateVariable           │    │  │
│  │  │  • EscalationStep                                   │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Persistence (PostgreSQL + MongoDB)               │    │  │
│  │  │  • NotificationJpaRepository                      │    │  │
│  │  │  • UserPreferenceJpaRepository                    │    │  │
│  │  │  • AlertRuleJpaRepository                         │    │  │
│  │  │  • EscalationPolicyJpaRepository                 │    │  │
│  │  │  • DeliveryRecordMongoRepository                  │    │  │
│  │  │  • InAppNotificationMongoRepository               │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Kafka Consumers (from ALL bounded contexts)        │    │  │
│  │  │  • AlertEventConsumer (generic alert listener)      │    │  │
│  │  │  • GeofenceAlertConsumer                           │    │  │
│  │  │  • HOSViolationConsumer                            │    │  │
│  │  │  • MaintenanceAlertConsumer                        │    │  │
│  │  │  • FuelFraudAlertConsumer                          │    │  │
│  │  │  • KPIBreachConsumer                               │    │  │
│  │  │  • IncidentAlertConsumer                           │    │  │
│  │  │  • BillingAlertConsumer                            │    │  │
│  │  │  • AnomalyAlertConsumer                            │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Channel Integrations                               │    │  │
│  │  │  • Amazon SES / SendGrid (Email)                    │    │  │
│  │  │  • Twilio / AWS SNS (SMS)                           │    │  │
│  │  │  • Firebase Cloud Messaging (Push)                  │    │  │
│  │  │  • Apple Push Notification Service (Push)           │    │  │
│  │  │  • Slack Webhook / Microsoft Teams Webhook           │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
com.fleetvision.notification/
├── api/
│   ├── rest/
│   │   ├── NotificationController.kt
│   │   ├── PreferenceController.kt
│   │   ├── AlertRuleController.kt
│   │   └── InAppNotificationController.kt
│   └── websocket/
│       └── InAppNotificationWebSocketHandler.kt
├── application/
│   ├── command/ + commandhandler/
│   ├── query/ + queryhandler/
│   ├── service/
│   │   ├── NotificationRouter.kt
│   │   ├── AlertRuleEvaluator.kt
│   │   ├── EscalationManager.kt
│   │   ├── PreferenceResolver.kt
│   │   ├── RateLimitEnforcer.kt
│   │   ├── QuietHoursChecker.kt
│   │   └── DeduplicationService.kt
│   └── port/
├── domain/
│   ├── model/
│   │   ├── aggregate/ (Notification, AlertRule, UserPreference, EscalationPolicy)
│   │   ├── valueobject/
│   │   └── event/
│   └── service/
├── infrastructure/
│   ├── channel/
│   │   ├── EmailChannelAdapter.kt
│   │   ├── SMSChannelAdapter.kt
│   │   ├── PushChannelAdapter.kt
│   │   ├── InAppChannelAdapter.kt
│   │   ├── SlackChannelAdapter.kt
│   │   └── WebhookChannelAdapter.kt
│   ├── template/
│   │   ├── TemplateEngine.kt
│   │   └── templates/ (Mustache .html, .txt, .json)
│   ├── persistence/
│   ├── messaging/
│   └── config/
└── NotificationServiceApplication.kt
```

---

## 3. Aggregate Root Designs

### 3.1 Notification (Aggregate Root)

**Purpose:** Represents a single notification instance to be delivered to one or more recipients through one or more channels.

#### Fields

| Field | Type | Description |
|---|---|---|
| `notificationId` | `UUID` | Unique aggregate identifier |
| `tenantId` | `TenantId` (UUID) | Owning tenant |
| `sourceContext` | `String` | Originating bounded context (e.g., "compliance", "tracking") |
| `sourceEventId` | `UUID` | The domain event that triggered this notification |
| `alertRuleId` | `UUID?` | Associated alert rule (if rule-triggered) |
| `severity` | `AlertSeverity` | `INFO`, `WARNING`, `HIGH`, `CRITICAL` |
| `category` | `NotificationCategory` | `GEOFENCE`, `HOS_VIOLATION`, `MAINTENANCE`, `FUEL_FRAUD`, `INCIDENT`, `SYSTEM`, `BILLING`, `KPI_BREACH` |
| `title` | `String` | Notification title template key |
| `body` | `String` | Notification body template key |
| `templateVariables` | `Map<String, Any>` | Variables for template rendering |
| `recipients` | `List<Recipient>` | Target recipients with resolved channels |
| `deliveryResults` | `Map<NotificationChannel, DeliveryStatus>` | Per-channel delivery status |
| `isRead` | `Boolean` | Whether user has read (in-app) |
| `acknowledgedAt` | `Instant?` | When user acknowledged |
| `escalated` | `Boolean` | Whether escalation was triggered |
| `createdAt` | `Instant` | Creation timestamp |
| `expiresAt` | `Instant?` | Expiration for auto-dismiss |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `createNotification()` | sourceContext, sourceEventId, severity, category, template, variables | `NotificationCreatedEvent` | At least one recipient must be specified |
| `addRecipient()` | userId, channels | — | Recipient must not be a duplicate |
| `markDelivered()` | channel, deliveryResult | `NotificationDeliveredEvent` | Channel must be in PENDING status |
| `markFailed()` | channel, failureReason | `NotificationDeliveryFailedEvent` | Channel must be in PENDING status |
| `markRead()` | — | `NotificationReadEvent` | In-app notification only |
| `acknowledge()` | userId | `NotificationAcknowledgedEvent` | Only the recipient can acknowledge |
| `triggerEscalation()` | escalationPolicyId | `NotificationEscalatedEvent` | All delivery attempts failed or timeout elapsed |

#### Invariants

1. **At Least One Channel:** A notification must have at least one delivery channel per recipient.
2. **Delivery State Machine:** `PENDING -> DELIVERED | FAILED | EXPIRED` per channel.
3. **Critical Always Delivered:** `AlertSeverity.CRITICAL` notifications bypass quiet hours and user opt-outs (delivered to at least one channel).
4. **Deduplication:** Same source event + same recipient + same category within 5 minutes = deduplicated.
5. **Rate Limiting:** Max 100 notifications per user per hour (configurable per tenant).

#### Domain Events

```kotlin
// Event naming: notification.<event>.v1
data class NotificationCreatedEvent(
    val notificationId: UUID, val tenantId: UUID,
    val sourceContext: String, val sourceEventId: UUID,
    val severity: AlertSeverity, val category: NotificationCategory,
    val recipientCount: Int, val channels: List<NotificationChannel>,
    val timestamp: Instant
)

data class NotificationDeliveredEvent(
    val notificationId: UUID, val tenantId: UUID,
    val userId: UUID, val channel: NotificationChannel,
    val deliveredAt: Instant
)

data class NotificationDeliveryFailedEvent(
    val notificationId: UUID, val tenantId: UUID,
    val userId: UUID, val channel: NotificationChannel,
    val failureReason: String, val retryCount: Int,
    val timestamp: Instant
)

data class NotificationEscalatedEvent(
    val notificationId: UUID, val tenantId: UUID,
    val escalationPolicyId: UUID, val escalationLevel: Int,
    val escalatedTo: List<UUID>, val timestamp: Instant
)
```

---

### 3.2 AlertRule (Aggregate Root)

**Purpose:** Defines conditions under which domain events trigger notifications, including routing, severity mapping, and channel selection.

#### Fields

| Field | Type | Description |
|---|---|---|
| `ruleId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `name` | `String` | Rule name |
| `description` | `String` | Rule description |
| `enabled` | `Boolean` | Whether the rule is active |
| `sourceEventTypes` | `List<String>` | Event types that trigger this rule |
| `conditionExpression` | `String` | SpEL / JSONPath expression for matching |
| `severity` | `AlertSeverity` | Severity for matched events |
| `category` | `NotificationCategory` | Notification category |
| `recipients` | `List<RecipientSelector>` | How to determine recipients |
| `channels` | `List<NotificationChannel>` | Default delivery channels |
| `templateKey` | `String` | Notification template to use |
| `cooldownMinutes` | `Int` | Min time between repeated alerts (dedup window) |
| `escalationPolicyId` | `UUID?` | Linked escalation policy |
| `createdBy` | `UUID` | User who created the rule |
| `priority` | `Int` | Rule evaluation priority (lower = higher priority) |

#### Domain Events

```kotlin
data class AlertRuleCreatedEvent(
    val ruleId: UUID, val tenantId: UUID, val name: String,
    val sourceEventTypes: List<String>, val severity: AlertSeverity,
    val channels: List<NotificationChannel>, val timestamp: Instant
)

data class AlertRuleToggledEvent(
    val ruleId: UUID, val tenantId: UUID,
    val enabled: Boolean, val toggledBy: UUID, val timestamp: Instant
)
```

---

### 3.3 UserPreference (Aggregate Root)

**Purpose:** Manages a user's notification channel preferences, quiet hours, and opt-out settings.

#### Fields

| Field | Type | Description |
|---|---|---|
| `preferenceId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `userId` | `UUID` | User |
| `channelPreferences` | `Map<NotificationCategory, Map<AlertSeverity, Set<NotificationChannel>>>` | Per-category, per-severity channel preferences |
| `globalChannels` | `Set<NotificationChannel>` | Default channels if category-specific not set |
| `quietHours` | `QuietHours?` | Time window for suppressing non-critical notifications |
| `quietHoursTimezone` | `String` | Timezone for quiet hours (e.g., "America/New_York") |
| `optOutCategories` | `Set<NotificationCategory>` | Categories the user has opted out of |
| `locale` | `String` | Preferred language (e.g., "en-US") |
| `emailAddress` | `String?` | Override email address |
| `phoneNumber` | `String?` | Override phone number |
| `pushToken` | `String?` | Device push token |
| `pushPlatform` | `PushPlatform?` | `FCM`, `APNS` |
| `updatedAt` | `Instant` | Last update |

#### Invariants

1. **Critical Override:** Users cannot opt out of `AlertSeverity.CRITICAL` notifications for safety categories (`HOS_VIOLATION`, `INCIDENT`, `MAINTENANCE`).
2. **At Least One Channel:** If all channels are opted out for a category, the system defaults to IN_APP.
3. **Quiet Hours Exception:** CRITICAL severity alerts bypass quiet hours.

---

### 3.4 EscalationPolicy (Aggregate Root)

**Purpose:** Defines time-based escalation rules when alerts are not acknowledged.

#### Fields

| Field | Type | Description |
|---|---|---|
| `policyId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `name` | `String` | Policy name |
| `steps` | `List<EscalationStep>` | Ordered escalation steps |
| `repeatLastStep` | `Boolean` | Whether to repeat last step indefinitely |
| `maxEscalationLevel` | `Int` | Maximum escalation level before stopping |

#### Value Object: EscalationStep

```kotlin
data class EscalationStep(
    val level: Int,
    val delayMinutes: Int,               // Wait before escalating to this step
    val recipientSelectors: List<RecipientSelector>,  // Who to notify
    val channels: List<NotificationChannel>,          // How to notify
    val repeatIntervalMinutes: Int?,                  // If repeatLastStep, how often
    val notifyOriginalRecipient: Boolean              // Also re-notify original recipient
)
```

**Example Escalation Policy:**

```kotlin
// For critical vehicle breakdown:
EscalationPolicy(
    name = "Vehicle Breakdown Escalation",
    steps = listOf(
        EscalationStep(level = 1, delayMinutes = 0,           // Immediate: driver + dispatcher
            recipientSelectors = listOf(OriginalRecipient, Dispatcher),
            channels = listOf(SMS, PUSH, IN_APP)),
        EscalationStep(level = 2, delayMinutes = 15,          // 15 min: fleet manager
            recipientSelectors = listOf(FleetManager),
            channels = listOf(SMS, EMAIL, PUSH)),
        EscalationStep(level = 3, delayMinutes = 60,          // 1 hour: regional director
            recipientSelectors = listOf(RegionalDirector),
            channels = listOf(SMS, EMAIL)),
    ),
    repeatLastStep = true,
    maxEscalationLevel = 3
)
```

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.notification.application.port.outbound

import com.fleetvision.notification.domain.model.aggregate.*
import com.fleetvision.notification.domain.model.valueobject.*
import java.time.Instant
import java.util.UUID

interface NotificationRepository {
    fun save(notification: Notification): Notification
    fun findById(notificationId: UUID): Notification?
    fun findByUser(userId: UUID, page: Int, size: Int, unreadOnly: Boolean = false): PageResult<Notification>
    fun findByTenant(tenantId: UUID, page: Int, size: Int, category: String? = null): PageResult<Notification>
    fun findUnacknowledgedCritical(tenantId: UUID): List<Notification>
    fun countUnreadByUser(userId: UUID): Int
}

interface UserPreferenceRepository {
    fun save(preference: UserPreference): UserPreference
    fun findByUserId(userId: UUID): UserPreference?
    fun findByTenant(tenantId: UUID, page: Int, size: Int): PageResult<UserPreference>
    fun delete(preference: UserPreference)
}

interface AlertRuleRepository {
    fun save(rule: AlertRule): AlertRule
    fun findById(ruleId: UUID): AlertRule?
    fun findEnabledByTenant(tenantId: UUID): List<AlertRule>
    fun findByEventType(eventType: String): List<AlertRule>
}

interface EscalationPolicyRepository {
    fun save(policy: EscalationPolicy): EscalationPolicy
    fun findById(policyId: UUID): EscalationPolicy?
    fun findByTenant(tenantId: UUID): List<EscalationPolicy>
}

interface DeliveryRecordRepository {
    // MongoDB for high-volume delivery tracking
    fun save(record: DeliveryRecord): DeliveryRecord
    fun findByNotification(notificationId: UUID): List<DeliveryRecord>
    fun findFailedDeliveries(from: Instant, to: Instant): List<DeliveryRecord>
    fun getDeliveryStats(tenantId: UUID, from: Instant, to: Instant): DeliveryStatsDto
}

interface InAppNotificationRepository {
    // MongoDB for in-app notification feed
    fun save(notification: InAppNotification): InAppNotification
    fun findByUser(userId: UUID, page: Int, size: Int): PageResult<InAppNotification>
    fun findUnreadByUser(userId: UUID, page: Int, size: Int): PageResult<InAppNotification>
    fun markAsRead(userId: UUID, notificationIds: List<UUID>)
    fun markAllAsRead(userId: UUID)
}

// Channel Port (interface for each delivery channel)
interface NotificationChannelPort {
    val channelType: NotificationChannel
    suspend fun send(recipient: Recipient, content: NotificationContent): ChannelDeliveryResult
    fun validate(recipient: Recipient): Boolean
}

// DTOs
data class DeliveryStatsDto(
    val totalSent: Long, val totalDelivered: Long, val totalFailed: Long,
    val deliveryRate: Double,
    val byChannel: Map<String, ChannelStatsDto>
)

data class ChannelStatsDto(
    val sent: Long, val delivered: Long, val failed: Long, val avgLatencyMs: Long
)

data class PageResult<T>(val items: List<T>, val total: Long, val page: Int, val size: Int)
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/notifications`

#### Notification Management

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/` | List current user's notifications | `200` `Page<NotificationSummaryResponse>` |
| `GET` | `/unread-count` | Get unread notification count | `200` `{ count: int }` |
| `GET` | `/{notificationId}` | Get notification details | `200` `NotificationDetailResponse` |
| `POST` | `/{notificationId}/acknowledge` | Acknowledge notification | `200` `NotificationResponse` |
| `POST` | `/{notificationId}/read` | Mark as read | `200` `NotificationResponse` |
| `POST` | `/read-all` | Mark all as read | `200` |

#### User Preferences

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/preferences` | Get current user's preferences | `200` `UserPreferenceResponse` |
| `PUT` | `/preferences` | Update preferences | `200` `UserPreferenceResponse` |
| `POST` | `/preferences/quiet-hours` | Set quiet hours | `200` `UserPreferenceResponse` |
| `DELETE` | `/preferences/quiet-hours` | Remove quiet hours | `200` `UserPreferenceResponse` |
| `PUT` | `/preferences/push-token` | Register/update push token | `200` |

#### Alert Rules (Admin)

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/alert-rules` | List alert rules for tenant | `200` `List<AlertRuleResponse>` |
| `POST` | `/alert-rules` | Create alert rule | `201` `AlertRuleResponse` |
| `GET` | `/alert-rules/{ruleId}` | Get alert rule | `200` `AlertRuleDetailResponse` |
| `PUT` | `/alert-rules/{ruleId}` | Update alert rule | `200` `AlertRuleResponse` |
| `POST` | `/alert-rules/{ruleId}/toggle` | Enable/disable rule | `200` `AlertRuleResponse` |
| `DELETE` | `/alert-rules/{ruleId}` | Delete alert rule | `204` |

#### Escalation Policies (Admin)

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/escalation-policies` | List escalation policies | `200` `List<EscalationPolicyResponse>` |
| `POST` | `/escalation-policies` | Create escalation policy | `201` `EscalationPolicyResponse` |
| `GET` | `/escalation-policies/{policyId}` | Get policy details | `200` `EscalationPolicyDetailResponse` |
| `PUT` | `/escalation-policies/{policyId}` | Update policy | `200` `EscalationPolicyResponse` |

#### Delivery Status (Admin)

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/delivery/stats` | Get delivery statistics | `200` `DeliveryStatsResponse` |
| `GET` | `/delivery/failed` | List failed deliveries | `200` `Page<FailedDeliveryResponse>` |
| `POST` | `/delivery/{recordId}/retry` | Retry failed delivery | `200` `DeliveryResponse` |

### 5.2 WebSocket Endpoint

| Protocol | Path | Description |
|---|---|---|
| `WSS` | `/ws/notifications` | Real-time in-app notification delivery to connected clients |

---

## 6. Kafka Event Contracts

### 6.1 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `notification.created.v1` | `NotificationCreatedEvent` | `tenantId` | By tenant |
| `notification.delivered.v1` | `NotificationDeliveredEvent` | `userId` | By user |
| `notification.failed.v1` | `NotificationDeliveryFailedEvent` | `tenantId` | By tenant |
| `notification.escalated.v1` | `NotificationEscalatedEvent` | `tenantId` | By tenant |
| `notification.acknowledged.v1` | `NotificationAcknowledgedEvent` | `notificationId` | By notification |

### 6.2 Events Consumed (Subscriber) — From ALL Contexts

| Source Topic | Consuming Handler | Purpose |
|---|---|---|
| `tracking.geofence.violation.v1` | `GeofenceAlertConsumer` | Route to appropriate recipients |
| `tracking.speed.exceeded.v1` | `SpeedAlertConsumer` | Route to fleet manager / driver |
| `compliance.hos.violation-detected.v1` | `HOSViolationConsumer` | Route to driver, safety manager |
| `compliance.incident.created.v1` | `IncidentAlertConsumer` | Route to safety investigator, fleet manager |
| `maintenance.due.v1` | `MaintenanceAlertConsumer` | Route to fleet manager, driver |
| `maintenance.diagnostic-alert.v1` | `MaintenanceAlertConsumer` | Route to fleet manager |
| `fuel.transaction.flagged.v1` | `FuelFraudAlertConsumer` | Route to fleet manager, finance |
| `analytics.anomaly.detected.v1` | `AnomalyAlertConsumer` | Route to fleet manager |
| `analytics.kpi.threshold-breached.v1` | `KPIBreachConsumer` | Route to fleet manager, executive |
| `analytics.prediction.maintenance.v1` | `PredictiveAlertConsumer` | Route to fleet manager |
| `billing.invoice.overdue.v1` | `BillingAlertConsumer` | Route to account manager |
| `billing.payment.failed.v1` | `BillingAlertConsumer` | Route to account manager |

### 6.3 Consumer Group Configuration

```yaml
kafka:
  consumer:
    groups:
      notification-tracking-alerts:
        topics:
          - tracking.geofence.violation.v1
          - tracking.speed.exceeded.v1
        concurrency: 4
      notification-compliance-alerts:
        topics:
          - compliance.hos.violation-detected.v1
          - compliance.incident.created.v1
        concurrency: 3
      notification-maintenance-alerts:
        topics:
          - maintenance.due.v1
          - maintenance.diagnostic-alert.v1
        concurrency: 3
      notification-fuel-alerts:
        topics:
          - fuel.transaction.flagged.v1
        concurrency: 2
      notification-analytics-alerts:
        topics:
          - analytics.anomaly.detected.v1
          - analytics.kpi.threshold-breached.v1
          - analytics.prediction.maintenance.v1
        concurrency: 3
      notification-billing-alerts:
        topics:
          - billing.invoice.overdue.v1
          - billing.payment.failed.v1
        concurrency: 2
```

---

## 7. Multi-Channel Delivery Architecture

### 7.1 Channel Adapter Interface

```kotlin
interface NotificationChannelPort {
    val channelType: NotificationChannel
    suspend fun send(recipient: Recipient, content: NotificationContent): ChannelDeliveryResult
    fun validate(recipient: Recipient): Boolean
}

data class Recipient(
    val userId: UUID,
    val emailAddress: String?,
    val phoneNumber: String?,
    val pushToken: String?,
    val pushPlatform: PushPlatform?,
    val slackWebhookUrl: String?
)

data class NotificationContent(
    val title: String,
    val body: String,
    val htmlBody: String?,
    val data: Map<String, String>?,  // Push notification payload
    val actionUrl: String?,           // Deep link
    val imageUrl: String?
)

data class ChannelDeliveryResult(
    val success: Boolean,
    val externalId: String?,    // Provider-side message ID
    val errorCode: String?,
    val errorMessage: String?,
    val latencyMs: Long
)
```

### 7.2 Channel Implementations

| Channel | Provider | Rate Limit | Max Retries | Timeout |
|---|---|---|---|---|
| **Email** | AWS SES / SendGrid | 50/second | 3 | 10s |
| **SMS** | Twilio / AWS SNS | 100/second | 2 | 15s |
| **Push (Android)** | Firebase FCM | 500/second | 3 | 5s |
| **Push (iOS)** | Apple APNs | 500/second | 3 | 5s |
| **In-App** | WebSocket (Socket.IO) | No limit | 0 (fire-and-forget) | 1s |
| **Slack** | Webhook | 1/second per channel | 2 | 5s |
| **Webhook** | HTTP POST | 10/second per URL | 3 | 10s |

### 7.3 Template Engine

```yaml
# Notification templates (Mustache)
templates:
  - key: "hos.violation.11-hour"
    subject: "HOS Violation Alert: {{driverName}} exceeded 11-hour driving limit"
    body_sms: "ALERT: {{driverName}} (Vehicle {{vehicleId}}) has exceeded the 11-hour daily driving limit. Violation time: {{violationTime}}."
    body_email: "templates/hos_violation_11hour_email.html"
    body_push_title: "HOS Violation Alert"
    body_push_body: "{{driverName}} exceeded 11-hour driving limit"
    variables:
      - driverName
      - vehicleId
      - violationTime
      - violationMinutes

  - key: "geofence.exit"
    subject: "Geofence Exit Alert: {{vehicleName}} left {{geofenceName}}"
    body_sms: "{{vehicleName}} ({{vehicleId}}) exited {{geofenceName}} at {{exitTime}}."
    body_email: "templates/geofence_exit_email.html"
    body_push_title: "Geofence Exit"
    body_push_body: "{{vehicleName}} left {{geofenceName}}"
    variables:
      - vehicleName
      - vehicleId
      - geofenceName
      - exitTime
      - driverName
```

---

## 8. Dependencies & External Integrations

### 8.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| ALL services | Kafka (async) | Consume all alert events | Eventual consistency |
| `identity-service` | gRPC | Resolve user details, email, phone, roles | Circuit breaker, 3s timeout |
| `audit-log-service` | Kafka (async) | Log notification audit events | Fire-and-forget |

### 8.2 External Integrations

| Integration | Protocol | Purpose |
|---|---|---|
| **AWS SES** | SMTP/HTTPS | Transactional email delivery |
| **SendGrid** | REST API | Transactional email delivery (fallback) |
| **Twilio** | REST API | SMS delivery |
| **AWS SNS** | HTTPS | SMS delivery (fallback) |
| **Firebase Cloud Messaging** | HTTPS | Android push notifications |
| **Apple Push Notification Service** | HTTPS (TLS) | iOS push notifications |
| **Slack** | Webhook | Slack channel notifications |
| **Microsoft Teams** | Webhook | Teams channel notifications |

---

## 9. Configuration Properties

```yaml
# application.yml
notification:
  service:
    name: notification-service

  routing:
    default-channels:
      - IN_APP
      - EMAIL
    severity-channel-mapping:
      INFO: [IN_APP]
      WARNING: [IN_APP, EMAIL]
      HIGH: [IN_APP, EMAIL, SMS]
      CRITICAL: [IN_APP, EMAIL, SMS, PUSH]
    critical-bypass-quiet-hours: true
    critical-bypass-opt-out: true
    critical-categories:
      - HOS_VIOLATION
      - INCIDENT
      - MAINTENANCE

  deduplication:
    enabled: true
    window-seconds: 300
    key-strategy: "sourceEventId:userId:category"

  rate-limiting:
    max-per-user-per-hour: 100
    max-per-user-per-day: 500
    max-per-tenant-per-minute: 1000

  quiet-hours:
    default-enabled: false
    max-duration-hours: 12

  escalation:
    check-interval-seconds: 60
    max-escalation-levels: 5

  channels:
    email:
      provider: ses              # ses or sendgrid
      ses:
        region: us-east-1
        sender: noreply@fleetvision.io
      sendgrid:
        api-key: ${SENDGRID_API_KEY}
        sender: noreply@fleetvision.io
      max-retries: 3
      timeout-seconds: 10
    sms:
      provider: twilio           # twilio or sns
      twilio:
        account-sid: ${TWILIO_ACCOUNT_SID}
        from-number: ${TWILIO_FROM_NUMBER}
      sns:
        region: us-east-1
      max-retries: 2
      timeout-seconds: 15
    push:
      fcm:
        project-id: ${FCM_PROJECT_ID}
        service-account-json: ${FCM_SERVICE_ACCOUNT}
      apns:
        key-id: ${APNS_KEY_ID}
        team-id: ${APNS_TEAM_ID}
        bundle-id: com.fleetvision.app
      max-retries: 3
      timeout-seconds: 5
    in-app:
      websocket:
        max-connections-per-user: 5
        heartbeat-seconds: 30
    slack:
      default-webhook-url: ${SLACK_WEBHOOK_URL}
      timeout-seconds: 5

  templates:
    directory: classpath:/templates/
    engine: mustache
    cache-enabled: true

server:
  port: 8094

spring:
  application:
    name: notification-service

  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:fleetvision_notification}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:}

  data:
    mongodb:
      uri: ${MONGODB_URI:mongodb://localhost:27017/fleetvision_notification}

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    consumer:
      group-id: notification-service
      auto-offset-reset: latest

grpc:
  server:
    port: 9098
  client:
    identity-service:
      address: static://identity-service:9090
      negotiation-type: tls

resilience4j:
  circuitbreaker:
    instances:
      identityService:
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
      emailChannel:
        slidingWindowSize: 10
        failureRateThreshold: 60
        waitDurationInOpenState: 60s
      smsChannel:
        slidingWindowSize: 10
        failureRateThreshold: 60
        waitDurationInOpenState: 60s
  retry:
    instances:
      emailChannel:
        maxAttempts: 3
        waitDuration: 2s
      smsChannel:
        maxAttempts: 2
        waitDuration: 5s
  timelimiter:
    instances:
      identityService:
        timeoutDuration: 3s
      emailChannel:
        timeoutDuration: 10s
      smsChannel:
        timeoutDuration: 15s
      pushChannel:
        timeoutDuration: 5s
```

---

## 10. Resilience Patterns

### 10.1 Circuit Breaker Configuration

| Target Service | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| `identity-service` (gRPC) | 10 calls | 50% | 30s | 3 |
| AWS SES / SendGrid | 10 calls | 60% | 60s | 3 |
| Twilio / AWS SNS | 10 calls | 60% | 60s | 3 |
| Firebase FCM | 10 calls | 60% | 60s | 3 |

### 10.2 Retry Configuration

| Operation | Max Attempts | Backoff | Retryable Errors |
|---|---|---|---|
| Email delivery | 3 | 2s exponential | SMTP timeout, 429 rate limit, 5xx |
| SMS delivery | 2 | 5s fixed | Network error, 5xx |
| Push delivery | 3 | 1s exponential | Network error, 5xx |
| User identity lookup | 3 | 500ms exponential | `UNAVAILABLE`, `DEADLINE_EXCEEDED` |

### 10.3 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| User identity lookup (gRPC) | 3s | Use cached user data; if no cache, skip delivery |
| Email delivery | 10s | Queue for async retry via dead letter queue |
| SMS delivery | 15s | Queue for async retry |
| Push delivery | 5s | Skip; in-app still delivered |
| Slack webhook | 5s | Skip silently |

### 10.4 Graceful Degradation

- **Email provider down:** Fall back to secondary provider (SES -> SendGrid). If both down, queue messages for later delivery.
- **SMS provider down:** Fall back to secondary (Twilio -> SNS). If both down, deliver via push + in-app only.
- **Push service unavailable:** Skip push; deliver via in-app, email, SMS per severity.
- **Identity service unavailable:** Use cached user preferences and contact info. If no cache exists, queue notification for retry.
- **Channel adapter failure:** Attempt all configured channels. As long as at least one channel succeeds, notification is considered "partially delivered" (not failed).
- **Kafka consumer lag:** Prioritize CRITICAL severity events in processing queue.

---

## 11. Test Strategy

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | JUnit 5 + MockK + Kotest | 90% | Routing logic, escalation rules, preference resolution, quiet hours, deduplication, rate limiting |
| **Integration Tests** | Spring Boot Test + Testcontainers | 80% | Alert rule evaluation, channel adapter delivery, WebSocket in-app notifications |
| **Channel Tests** | WireMock | 100% per channel | Email (SES/SendGrid mock), SMS (Twilio mock), Push (FCM mock) |
| **Contract Tests** | Pact | 100% | gRPC contracts with identity-service |
| **E2E Tests** | Karate DSL + Testcontainers | Critical paths | Alert event consumed -> rule matched -> notification created -> delivered to 3 channels -> acknowledged |
| **Load Tests** | Gatling | SLO validation | 1000 notifications/second sustained delivery |
| **Escalation Tests** | Kotest | High | Time-based escalation: unacknowledged -> level 1 -> level 2 -> level 3 at correct intervals |

### Key Test Scenarios

1. **Routing:** HOS violation event -> matched rule -> delivered to driver (SMS, push) + fleet manager (email, in-app)
2. **Quiet Hours:** Non-critical notification at 3 AM with quiet hours 10 PM - 7 AM -> delayed until 7 AM; critical notification -> delivered immediately
3. **Escalation:** Critical alert unacknowledged for 15 minutes -> escalated to fleet manager; 60 minutes -> escalated to regional director
4. **Deduplication:** Same geofence violation event received twice in 2 minutes -> second one suppressed
5. **Rate Limiting:** 101st notification in 1 hour for a user -> rejected with rate limit error
6. **Multi-Channel Failover:** Email SES down, SendGrid down -> notification still delivered via SMS, push, in-app
7. **Opt-Out:** User opts out of FUEL_FRAUD category -> fuel fraud alert not delivered to that user (unless CRITICAL)

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
