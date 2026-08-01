# Billing & Tenant Management Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Service:** `billing-service`
**Bounded Context:** Billing & Tenant Management

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

The Billing & Tenant Management context handles multi-tenant subscription management, usage metering, invoice generation, payment processing, and tenant configuration. It enforces resource quotas, manages subscription tiers, and integrates with payment processors (Stripe, Adyen). Tenant provisioning and configuration lifecycle is managed here, propagating tenant context to all other services.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│               BILLING & TENANT MANAGEMENT CONTEXT                 │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Tenant       │  │ Subscription │  │ Invoice       │          │
│  │ (Aggregate)  │  │ (Aggregate)  │  │ (Aggregate)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ UsageRecord  │  │ Payment      │  │ TenantConfig  │          │
│  │ (Aggregate)  │  │ (Aggregate)   │  │ (Aggregate)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  Domain Services:                                                │
│  - UsageMeter                      - InvoiceGenerator          │
│  - QuotaEnforcer                   - PaymentProcessor          │
│  - SubscriptionValidator           - TenantProvisioner         │
│  - BillingCycleManager            - UsageAggregator            │
│                                                                  │
└────────┬──────────┬──────────────────┬───────────────┬───────────┘
         │          │                  │               │
    ┌────┴──────┐  ┌─┴──────┐    ┌────┴─────┐  ┌────┴──────┐
    │ ALL      │  │ Stripe/ │    │ Analy-   │  │  Identi-  │
    │ Services │  │ Adyen   │    │ tics     │  │  ty       │
    │(usage)   │  │(payment)│    │(billing) │  │  (tenant) │
    └──────────┘  └─────────┘    └──────────┘  └───────────┘
```

**Upstream (produces events consumed by):**
- `notification-service` — Invoice due alerts, payment failure alerts, subscription change alerts
- `analytics-engine` — Billing metrics, revenue analytics
- `audit-log-service` — Tenant provisioning/deprovisioning audit events
- ALL services (via tenant context) — Tenant configuration changes

**Downstream (consumes events from):**
- ALL services — Usage events for metering (via usage Kafka topics)
- `asset-lifecycle-service` — Depreciation data for financial reporting
- `fuel-management-service` — Fuel transaction totals

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **Tenant** | An independent organizational entity with isolated data, configuration, and billing |
| **Subscription** | A tenant's active plan defining tier, limits, pricing, and billing cycle |
| **Invoice** | A billing document generated for a subscription period, itemizing charges |
| **UsageRecord** | A metered usage event for billing (e.g., GPS events, API calls, vehicles tracked) |
| **Payment** | A financial transaction associated with an invoice payment or refund |
| **TenantConfig** | Platform configuration for a tenant: feature flags, integrations, branding, compliance settings |
| **Quota** | Resource limits enforced per tenant based on subscription tier |
| **BillingCycle** | The recurring period for which a tenant is billed (monthly, annual) |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     billing-service                              │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST Controllers│  │  gRPC Service Implementations│   │  │
│  │  │  (Spring MVC)    │  │  (BillingServiceGrpcImpl)    │   │  │
│  │  └────────┬────────┘  └──────────────┬───────────────┘   │  │
│  │           │                          │                    │  │
│  │  ┌────────┴────────┐  ┌─────────────┴──────────────┐    │  │
│  │  │  DTO Mappers   │  │  Event Publishers (Kafka)  │    │  │
│  │  │  (MapStruct)   │  │  (DomainEventPublisher)   │    │  │
│  │  └─────────────────┘  └──────────────────────────┘    │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │  External Adapters (Anti-Corruption Layers)       │    │  │
│  │  │  • StripePaymentAdapter (REST API)               │    │  │
│  │  │  • AdyenPaymentAdapter (REST API)                │    │  │
│  │  │  • TaxComplianceAdapter (Avalara)                 │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Command Handlers                                  │    │  │
│  │  │  • ProvisionTenantCommandHandler                   │    │  │
│  │  │  • UpdateTenantConfigCommandHandler                 │    │  │
│  │  │  • CreateSubscriptionCommandHandler                 │    │  │
│  │  │  • ChangeSubscriptionTierCommandHandler            │    │  │
│  │  │  • RecordUsageCommandHandler                       │    │  │
│  │  │  • GenerateInvoiceCommandHandler                   │    │  │
│  │  │  • ProcessPaymentCommandHandler                    │    │  │
│  │  │  • IssueRefundCommandHandler                       │    │  │
│  │  │  • DeprovisionTenantCommandHandler                 │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Query Handlers (CQRS)                              │    │  │
│  │  │  • GetTenantQueryHandler                           │    │  │
│  │  │  • GetSubscriptionQueryHandler                     │    │  │
│  │  │  • GetInvoiceQueryHandler                          │    │  │
│  │  │  • GetUsageReportQueryHandler                       │    │  │
│  │  │  • GetPaymentHistoryQueryHandler                   │    │  │
│  │  │  • GetTenantConfigQueryHandler                     │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Domain Services                                    │    │  │
│  │  │  • UsageMeter                                      │    │  │
│  │  │  • QuotaEnforcer                                   │    │  │
│  │  │  • InvoiceGenerator                                │    │  │
│  │  │  • BillingCycleManager                             │    │  │
│  │  │  • SubscriptionValidator                           │    │  │
│  │  │  • TenantProvisioner                               │    │  │
│  │  │  • PaymentProcessor                                │    │  │
│  │  │  • UsageAggregator                                 │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Aggregate Roots                                    │    │  │
│  │  │  • Tenant                                          │    │  │
│  │  │  • Subscription                                   │    │  │
│  │  │  • Invoice                                        │    │  │
│  │  │  • Payment                                        │    │  │
│  │  │  • UsageRecord                                     │    │  │
│  │  │  • TenantConfig                                    │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • Money, TenantTier, SubscriptionStatus          │    │  │
│  │  │  • BillingCycle, InvoiceStatus, PaymentStatus      │    │  │
│  │  │  • UsageMeterType, Quota, QuotaUsage                │    │  │
│  │  │  • InvoiceLineItem, PaymentMethod                   │    │  │
│  │  │  • TenantFeature, FeatureFlag                     │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Persistence (PostgreSQL)                          │    │  │
│  │  │  • TenantJpaRepository                             │    │  │
│  │  │  • SubscriptionJpaRepository                      │    │  │
│  │  │  • InvoiceJpaRepository                            │    │  │
│  │  │  • PaymentJpaRepository                            │    │  │
│  │  │  • UsageRecordJpaRepository                        │    │  │
│  │  │  • TenantConfigJpaRepository                       │    │  │
│  │  │  • UsageAggregationReadModelRepository              │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Kafka Consumers                                    │    │  │
│  │  │  • UsageEventConsumer (from ALL services)            │    │  │
│  │  │  • AssetDepreciationConsumer (from asset-lifecycle) │    │  │
│  │  │  • FuelTransactionConsumer (from fuel-mgmt)         │    │  │
│  │  │  • WebhookEventConsumer (from Stripe/Adyen)        │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
com.fleetvision.billing/
├── api/
│   ├── rest/
│   │   ├── TenantController.kt
│   │   ├── SubscriptionController.kt
│   │   ├── InvoiceController.kt
│   │   ├── PaymentController.kt
│   │   ├── UsageController.kt
│   │   └── TenantConfigController.kt
│   └── grpc/
│       ├── BillingServiceGrpcImpl.kt
│       ├── TenantConfigServiceGrpcImpl.kt
│       └── proto/
├── application/
│   ├── command/ + commandhandler/
│   ├── query/ + queryhandler/
│   ├── service/
│   └── port/
├── domain/
│   ├── model/
│   │   ├── aggregate/ (Tenant, Subscription, Invoice, Payment, UsageRecord, TenantConfig)
│   │   ├── valueobject/
│   │   └── event/
│   └── service/
├── infrastructure/
│   ├── config/
│   ├── persistence/
│   ├── messaging/
│   ├── adapter/
│   │   ├── StripePaymentAdapter.kt
│   │   ├── AdyenPaymentAdapter.kt
│   │   └── TaxComplianceAdapter.kt
│   └── provisioning/
│       └── TenantProvisioningWorkflow.kt
└── BillingServiceApplication.kt
```

---

## 3. Aggregate Root Designs

### 3.1 Tenant (Aggregate Root)

**Purpose:** Represents an independent organizational entity on the platform with billing, configuration, and isolation semantics.

#### Fields

| Field | Type | Description |
|---|---|---|
| `tenantId` | `UUID` | Unique identifier |
| `name` | `String` | Organization display name |
| `slug` | `String` | URL-safe identifier |
| `domain` | `String?` | Custom domain (if applicable) |
| `tier` | `TenantTier` | `STANDARD`, `PROFESSIONAL`, `ENTERPRISE` |
| `status` | `TenantStatus` | `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `DEPROVISIONED` |
| `ownerId` | `UUID` | Primary contact / owner user |
| `billingEmail` | `String` | Email for billing notifications |
| `billingAddress` | `Address` | Billing address |
| `taxId` | `String?` | Tax identification number |
| `currency` | `String` | Billing currency (ISO 4217, e.g., "USD") |
| `timezone` | `String` | Tenant timezone (e.g., "America/New_York") |
| `locale` | `String` | Locale for UI and communications |
| `isolationLevel` | `IsolationLevel` | `DEDICATED_INSTANCE`, `SCHEMA`, `ROW_LEVEL` |
| `createdAt` | `Instant` | Provisioning timestamp |
| `suspendedAt` | `Instant?` | Suspension timestamp |
| `deprovisionedAt` | `Instant?` | Deprovisioning timestamp |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `provision()` | name, slug, tier, ownerId, billingEmail, currency | `TenantProvisionedEvent` | Slug must be unique; tier must be valid |
| `activate()` | — | `TenantActivatedEvent` | Status must be PROVISIONING; infrastructure ready |
| `suspend()` | reason | `TenantSuspendedEvent` | Status must be ACTIVE |
| `reinstate()` | — | `TenantReinstatedEvent` | Status must be SUSPENDED |
| `updateBillingDetails()` | billingEmail, address, taxId | `TenantBillingUpdatedEvent` | — |
| `deprovision()` | reason | `TenantDeprovisionedEvent` | Status must be SUSPENDED; all subscriptions terminated; all data export completed |
| `changeTier()` | newTier | `TenantTierChangedEvent` | New tier must be higher or equal; billing proration applies |

#### Invariants

1. **Slug Uniqueness:** Tenant slug must be globally unique across the platform.
2. **Status Machine:** `PROVISIONING -> ACTIVE -> SUSPENDED -> DEPROVISIONED` (with reinstatement from SUSPENDED).
3. **Tier Progression:** Tier changes must follow `STANDARD -> PROFESSIONAL -> ENTERPRISE` (downgrades allowed with proration).
4. **Data Retention on Deprovision:** Deprovisioning requires data export completion and a 30-day grace period.

#### Domain Events

```kotlin
// Event naming: billing.tenant.<event>.v1
data class TenantProvisionedEvent(
    val tenantId: UUID, val name: String, val slug: String,
    val tier: TenantTier, val ownerId: UUID, val currency: String,
    val isolationLevel: IsolationLevel, val timestamp: Instant
)

data class TenantActivatedEvent(
    val tenantId: UUID, val timestamp: Instant
)

data class TenantSuspendedEvent(
    val tenantId: UUID, val reason: String, val suspendedBy: UUID,
    val timestamp: Instant
)

data class TenantDeprovisionedEvent(
    val tenantId: UUID, val reason: String, val deprovisionedBy: UUID,
    val timestamp: Instant
)

data class TenantTierChangedEvent(
    val tenantId: UUID, val previousTier: TenantTier,
    val newTier: TenantTier, val prorationAmount: BigDecimal,
    val effectiveDate: Instant, val timestamp: Instant
)
```

---

### 3.2 Subscription (Aggregate Root)

**Purpose:** Manages a tenant's subscription plan, including tier features, pricing, billing cycle, and entitlements.

#### Fields

| Field | Type | Description |
|---|---|---|
| `subscriptionId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `planId` | `String` | Plan identifier (e.g., "fleet-standard-100") |
| `planName` | `String` | Display name |
| `tier` | `TenantTier` | Current tier |
| `status` | `SubscriptionStatus` | `TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, `EXPIRED` |
| `billingCycle` | `BillingCycle` | `MONTHLY`, `ANNUAL` |
| `currentPeriodStart` | `Instant` | Start of current billing period |
| `currentPeriodEnd` | `Instant` | End of current billing period |
| `basePrice` | `Money` | Base subscription price |
| `addonPrices` | `Map<String, Money>` | Additional add-on charges |
| `totalMonthlyPrice` | `Money` | Total expected monthly charge |
| `usageIncluded` | `Map<UsageMeterType, Long>` | Included usage per meter type |
| `usageOverageRate` | `Map<UsageMeterType, BigDecimal>` | Per-unit overage rates |
| `paymentMethodId` | `String?` | External payment method reference |
| `trialEndsAt` | `Instant?` | Trial expiration (if applicable) |
| `cancelledAt` | `Instant?` | Cancellation timestamp |
| `cancelEffectiveDate` | `Instant?` | When cancellation takes effect |

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `createSubscription()` | tenantId, planId, billingCycle, paymentMethodId | `SubscriptionCreatedEvent` | Tenant must be ACTIVE; payment method must be valid |
| `startTrial()` | tenantId, planId, trialDays | `SubscriptionTrialStartedEvent` | Tenant must not have active trial |
| `activateSubscription()` | paymentMethodId | `SubscriptionActivatedEvent` | Subscription must be TRIAL or PAST_DUE |
| `cancelSubscription()` | effectiveDate | `SubscriptionCancelledEvent` | Effective date must be >= current period end |
| `renewSubscription()` | — | `SubscriptionRenewedEvent` | Auto-renewal enabled; payment method valid |
| `addAddon()` | addonId, price | `SubscriptionAddonAddedEvent` | Addon must be available for tier |
| `removeAddon()` | addonId | `SubscriptionAddonRemovedEvent` | Proration applied |
| `changePlan()` | newPlanId | `SubscriptionPlanChangedEvent` | Proration applied |

#### Domain Events

```kotlin
// Event naming: billing.subscription.<event>.v1
data class SubscriptionCreatedEvent(
    val subscriptionId: UUID, val tenantId: UUID,
    val planId: String, val planName: String, val tier: TenantTier,
    val billingCycle: BillingCycle, val basePrice: BigDecimal,
    val totalMonthlyPrice: BigDecimal, val timestamp: Instant
)

data class SubscriptionCancelledEvent(
    val subscriptionId: UUID, val tenantId: UUID,
    val effectiveDate: Instant, val reason: String,
    val timestamp: Instant
)

data class SubscriptionPlanChangedEvent(
    val subscriptionId: UUID, val tenantId: UUID,
    val previousPlanId: String, val newPlanId: String,
    val prorationCredit: BigDecimal, val prorationCharge: BigDecimal,
    val effectiveDate: Instant, val timestamp: Instant
)
```

---

### 3.3 Invoice (Aggregate Root)

**Purpose:** A billing document for a subscription period, itemizing charges, taxes, and payment status.

#### Fields

| Field | Type | Description |
|---|---|---|
| `invoiceId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `subscriptionId` | `UUID` | Associated subscription |
| `invoiceNumber` | `String` | Human-readable invoice number (e.g., "INV-2026-001234") |
| `status` | `InvoiceStatus` | `DRAFT`, `PENDING`, `PAID`, `OVERDUE`, `VOID`, `WRITTEN_OFF` |
| `billingPeriodStart` | `Instant` | Period start |
| `billingPeriodEnd` | `Instant` | Period end |
| `dueDate` | `Instant` | Payment due date |
| `lineItems` | `List<InvoiceLineItem>` | Individual charges |
| `subtotal` | `Money` | Sum of line items |
| `taxAmount` | `Money` | Calculated tax |
| `discountAmount` | `Money` | Applied discounts |
| `totalAmount` | `Money` | Final amount due |
| `paidAmount` | `Money` | Amount paid to date |
| `paymentId` | `UUID?` | Associated payment |
| `pdfUrl` | `String?` | Invoice PDF artifact |
| `generatedAt` | `Instant` | Generation timestamp |
| `paidAt` | `Instant?` | Payment timestamp |

#### Value Object: InvoiceLineItem

```kotlin
data class InvoiceLineItem(
    val itemId: UUID,
    val description: String,
    val type: LineItemType,       // SUBSCRIPTION, USAGE_OVERAGE, ADDON, TAX, DISCOUNT
    val meterType: UsageMeterType?,
    val quantity: BigDecimal,
    val unitPrice: BigDecimal,
    val totalAmount: BigDecimal,
    `periodStart: Instant?,
    val periodEnd: Instant?
)
```

#### Behaviors

| Behavior | Parameters | Raises Events | Guards |
|---|---|---|---|
| `generateDraft()` | subscriptionId, periodStart, periodEnd, usageSummary | `InvoiceDraftedEvent` | Subscription must be ACTIVE |
| `finalizeInvoice()` | — | `InvoiceFinalizedEvent` | Invoice must be DRAFT; all line items validated |
| `markAsPaid()` | paymentId, paidAmount | `InvoicePaidEvent` | paidAmount >= totalAmount |
| `markAsOverdue()` | — | `InvoiceOverdueEvent` | dueDate has passed; status is PENDING |
| `voidInvoice()` | reason | `InvoiceVoidedEvent` | Invoice must be PENDING or DRAFT |
| `writeOffInvoice()` | reason | `InvoiceWrittenOffEvent` | Invoice must be OVERDUE; requires admin approval |

---

### 3.4 Payment (Aggregate Root)

**Purpose:** Tracks payment transactions associated with invoices.

#### Fields

| Field | Type | Description |
|---|---|---|
| `paymentId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `invoiceId` | `UUID` | Associated invoice |
| `amount` | `Money` | Payment amount |
| `method` | `PaymentMethod` | `CREDIT_CARD`, `BANK_TRANSFER`, `ACH`, `WIRE` |
| `status` | `PaymentStatus` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `REFUNDED` |
| `externalPaymentId` | `String` | Provider-side payment reference |
| `processor` | `PaymentProcessor` | `STRIPE`, `ADYEN` |
| `failureReason` | `String?` | Failure description |
| `refundedAmount` | `Money?` | Amount refunded |
| `createdAt` | `Instant` | Initiation timestamp |
| `completedAt` | `Instant?` | Completion timestamp |

---

### 3.5 UsageRecord (Aggregate Root)

**Purpose:** Records a metered usage event for billing purposes.

#### Fields

| Field | Type | Description |
|---|---|---|
| `recordId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `meterType` | `UsageMeterType` | `GPS_EVENTS`, `API_CALLS`, `VEHICLES_TRACKED`, `DRIVERS`, `STORAGE_GB`, `DATA_RETENTION_MONTHS` |
| `quantity` | `BigDecimal` | Measured quantity |
| `recordedAt` | `Instant` | When usage was measured |
| `sourceContext` | `String` | Originating service |
| `sourceEventId` | `UUID?` | Originating event reference |
| `billed` | `Boolean` | Whether included in an invoice |

#### Usage Meter Types

```kotlin
enum class UsageMeterType {
    GPS_EVENTS,           // Per GPS position event ingested
    API_CALLS,            // Per API request
    VEHICLES_TRACKED,     // Per vehicle (ceiling)
    DRIVERS,              // Per driver (ceiling)
    STORAGE_GB,           // Per GB of storage used
    DATA_RETENTION_MONTHS, // Per month of extended data retention
    TELEMATICS_DATA_POINTS, // Per telematics data point
    REPORT_GENERATION,    // Per report generated
    ML_PREDICTIONS        // Per ML model inference
}
```

---

### 3.6 TenantConfig (Aggregate Root)

**Purpose:** Platform configuration for a tenant, including feature flags, branding, integration settings, and compliance settings.

#### Fields

| Field | Type | Description |
|---|---|---|
| `configId` | `UUID` | Unique identifier |
| `tenantId` | `UUID` | Owning tenant |
| `featureFlags` | `Map<String, Boolean>` | Feature toggle flags |
| `integrations` | `Map<String, IntegrationConfig>` | Integration settings |
| `branding` | `BrandingConfig` | Logo, colors, custom domain |
| `complianceSettings` | `Map<String, Any>` | Regulatory settings (HOS rules, data residency, retention) |
| `notificationSettings` | `NotificationSettingsConfig` | Default notification preferences for tenant |
| `version` | `Int` | Optimistic locking version |

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.billing.application.port.outbound

import com.fleetvision.billing.domain.model.aggregate.*
import com.fleetvision.billing.application.query.*
import java.time.Instant
import java.util.UUID

interface TenantRepository {
    fun save(tenant: Tenant): Tenant
    fun findById(tenantId: UUID): Tenant?
    fun findBySlug(slug: String): Tenant?
    fun findByOwner(ownerId: UUID): Tenant?
    fun findActive(page: Int, size: Int): PageResult<Tenant>
    fun findSuspended(page: Int, size: Int): PageResult<Tenant>
}

interface SubscriptionRepository {
    fun save(subscription: Subscription): Subscription
    fun findById(subscriptionId: UUID): Subscription?
    fun findByTenant(tenantId: UUID): Subscription?
    fun findExpiringRenewals(date: Instant): List<Subscription>
    fun findTrialsExpiring(date: Instant): List<Subscription>
}

interface InvoiceRepository {
    fun save(invoice: Invoice): Invoice
    fun findById(invoiceId: UUID): Invoice?
    fun findByTenant(tenantId: UUID, page: Int, size: Int, status: String? = null): PageResult<Invoice>
    fun findByNumber(invoiceNumber: String): Invoice?
    fun findOverdue(tenantId: UUID): List<Invoice>
    fun findPendingByDueDate(dueDate: Instant): List<Invoice>
}

interface PaymentRepository {
    fun save(payment: Payment): Payment
    fun findById(paymentId: UUID): Payment?
    fun findByInvoice(invoiceId: UUID): List<Payment>
    fun findByTenant(tenantId: UUID, page: Int, size: Int): PageResult<Payment>
    fun findByExternalId(externalId: String): Payment?
}

interface UsageRecordRepository {
    fun save(record: UsageRecord): UsageRecord
    fun findByTenantAndPeriod(tenantId: UUID, from: Instant, to: Instant): List<UsageRecord>
    fun findUnbilled(tenantId: UUID): List<UsageRecord>
    fun aggregateUsageByTenant(tenantId: UUID, periodStart: Instant, periodEnd: Instant): Map<UsageMeterType, BigDecimal>
}

interface TenantConfigRepository {
    fun save(config: TenantConfig): TenantConfig
    fun findByTenant(tenantId: UUID): TenantConfig?
}

// CQRS Read Model
interface UsageAggregationReadModelPort {
    fun getTenantUsageSummary(tenantId: UUID, periodStart: Instant, periodEnd: Instant): TenantUsageSummaryDto
    fun getRevenueSummary(from: Instant, to: Instant): RevenueSummaryDto
    fun getUsageByMeterType(meterType: UsageMeterType, from: Instant, to: Instant): List<TenantUsageDto>
}

// DTOs
data class TenantUsageSummaryDto(
    val tenantId: UUID, val tenantName: String, val tier: String,
    val meters: Map<String, UsageMeterDto>,
    val includedQuota: Map<String, Long>,
    val overage: Map<String, BigDecimal>,
    val estimatedOverageCost: BigDecimal
)

data class UsageMeterDto(
    val meterType: String, val quantity: BigDecimal,
    val includedAmount: Long, val overageAmount: BigDecimal
)

data class RevenueSummaryDto(
    val totalMRR: BigDecimal, val totalARR: BigDecimal,
    val totalOverageRevenue: BigDecimal, val churnRate: Double,
    val activeSubscriptions: Long, val trialCount: Long
)
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/billing`

#### Tenant Management (Admin)

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/tenants` | Provision a new tenant | `201` `TenantResponse` |
| `GET` | `/tenants/{tenantId}` | Get tenant details | `200` `TenantDetailResponse` |
| `GET` | `/tenants` | List tenants | `200` `Page<TenantSummaryResponse>` |
| `PUT` | `/tenants/{tenantId}` | Update tenant details | `200` `TenantResponse` |
| `POST` | `/tenants/{tenantId}/suspend` | Suspend tenant | `200` `TenantResponse` |
| `POST` | `/tenants/{tenantId}/reinstate` | Reinstate tenant | `200` `TenantResponse` |
| `POST` | `/tenants/{tenantId}/deprovision` | Deprovision tenant | `200` `TenantResponse` |
| `PUT` | `/tenants/{tenantId}/tier` | Change tenant tier | `200` `TenantResponse` |

#### Subscription Management

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/subscriptions` | Create subscription | `201` `SubscriptionResponse` |
| `GET` | `/subscriptions/{subscriptionId}` | Get subscription details | `200` `SubscriptionDetailResponse` |
| `GET` | `/tenants/{tenantId}/subscription` | Get tenant's active subscription | `200` `SubscriptionResponse` |
| `PUT` | `/subscriptions/{subscriptionId}/plan` | Change subscription plan | `200` `SubscriptionResponse` |
| `POST` | `/subscriptions/{subscriptionId}/cancel` | Cancel subscription | `200` `SubscriptionResponse` |
| `POST` | `/subscriptions/{subscriptionId}/addons` | Add add-on | `200` `SubscriptionResponse` |
| `DELETE` | `/subscriptions/{subscriptionId}/addons/{addonId}` | Remove add-on | `200` `SubscriptionResponse` |

#### Invoice Management

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/invoices/generate` | Generate invoice for period | `201` `InvoiceResponse` |
| `GET` | `/invoices/{invoiceId}` | Get invoice details | `200` `InvoiceDetailResponse` |
| `GET` | `/invoices/{invoiceId}/pdf` | Download invoice PDF | `200` PDF file |
| `GET` | `/tenants/{tenantId}/invoices` | List tenant invoices | `200` `Page<InvoiceSummaryResponse>` |
| `GET` | `/invoices/overdue` | List overdue invoices | `200` `List<InvoiceSummaryResponse>` |
| `POST` | `/invoices/{invoiceId}/void` | Void invoice | `200` `InvoiceResponse` |
| `POST` | `/invoices/{invoiceId}/write-off` | Write off bad debt | `200` `InvoiceResponse` |

#### Payment Management

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/payments` | Initiate payment | `201` `PaymentResponse` |
| `GET` | `/payments/{paymentId}` | Get payment details | `200` `PaymentDetailResponse` |
| `GET` | `/tenants/{tenantId}/payments` | List payment history | `200` `Page<PaymentSummaryResponse>` |
| `POST` | `/payments/{paymentId}/refund` | Issue refund | `200` `PaymentResponse` |
| `POST` | `/payments/webhook/stripe` | Stripe webhook handler | `200` |
| `POST` | `/payments/webhook/adyen` | Adyen webhook handler | `200` |

#### Usage & Quota

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/usage/tenants/{tenantId}` | Get tenant usage for period | `200` `UsageSummaryResponse` |
| `GET` | `/usage/tenants/{tenantId}/quota` | Get quota usage and limits | `200` `QuotaResponse` |
| `POST` | `/usage/record` | Record usage event (internal) | `201` `UsageRecordResponse` |

#### Tenant Configuration (Admin)

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/config/tenants/{tenantId}` | Get tenant configuration | `200` `TenantConfigResponse` |
| `PUT` | `/config/tenants/{tenantId}` | Update tenant configuration | `200` `TenantConfigResponse` |
| `PUT` | `/config/tenants/{tenantId}/feature-flags` | Update feature flags | `200` `TenantConfigResponse` |
| `GET` | `/config/tenants/{tenantId}/feature-flags` | Get feature flags | `200` `Map<String, Boolean>` |

### 5.2 gRPC API

```protobuf
syntax = "proto3";
package fleetvision.billing.v1;

service BillingService {
  rpc GetTenantQuota(GetTenantQuotaRequest) returns (QuotaResponse);
  rpc CheckQuota(CheckQuotaRequest) returns (QuotaCheckResponse);
  rpc RecordUsage(RecordUsageRequest) returns (RecordUsageResponse);
  rpc GetSubscription(GetSubscriptionRequest) returns (SubscriptionResponse);
  rpc ValidatePaymentMethod(ValidatePaymentMethodRequest) returns (ValidationResponse);
}

service TenantConfigService {
  rpc GetTenantConfig(GetTenantConfigRequest) returns (TenantConfigResponse);
  rpc GetFeatureFlags(GetFeatureFlagsRequest) returns (FeatureFlagResponse);
}
```

---

## 6. Kafka Event Contracts

### 6.1 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `billing.tenant.provisioned.v1` | `TenantProvisionedEvent` | `tenantId` | By tenant |
| `billing.tenant.activated.v1` | `TenantActivatedEvent` | `tenantId` | By tenant |
| `billing.tenant.suspended.v1` | `TenantSuspendedEvent` | `tenantId` | By tenant |
| `billing.tenant.deprovisioned.v1` | `TenantDeprovisionedEvent` | `tenantId` | By tenant |
| `billing.tenant.tier-changed.v1` | `TenantTierChangedEvent` | `tenantId` | By tenant |
| `billing.subscription.created.v1` | `SubscriptionCreatedEvent` | `tenantId` | By tenant |
| `billing.subscription.cancelled.v1` | `SubscriptionCancelledEvent` | `tenantId` | By tenant |
| `billing.subscription.plan-changed.v1` | `SubscriptionPlanChangedEvent` | `tenantId` | By tenant |
| `billing.invoice.generated.v1` | `InvoiceGeneratedEvent` | `tenantId` | By tenant |
| `billing.invoice.overdue.v1` | `InvoiceOverdueEvent` | `tenantId` | By tenant |
| `billing.invoice.paid.v1` | `InvoicePaidEvent` | `tenantId` | By tenant |
| `billing.payment.completed.v1` | `PaymentCompletedEvent` | `tenantId` | By tenant |
| `billing.payment.failed.v1` | `PaymentFailedEvent` | `tenantId` | By tenant |
| `billing.usage.recorded.v1` | `UsageRecordedEvent` | `tenantId` | By tenant |
| `billing.config.updated.v1` | `TenantConfigUpdatedEvent` | `tenantId` | By tenant |

### 6.2 Events Consumed (Subscriber)

| Source Topic | Consuming Handler | Purpose |
|---|---|---|
| `fuel.transaction.completed.v1` | `FuelTransactionConsumer` | Aggregate fuel costs for invoice line items |
| `asset.depreciation.recorded.v1` | `AssetDepreciationConsumer` | Aggregate depreciation for financial reporting |
| Usage events from ALL services (internal topic) | `UsageEventConsumer` | Meter usage for billing |
| Stripe/Adyen webhooks (via HTTP -> Kafka bridge) | `WebhookEventConsumer` | Payment status updates |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| `identity-service` | gRPC | User validation for tenant owner | Circuit breaker, 3s timeout |
| `notification-service` | Kafka (async) | Invoice alerts, payment failure alerts | Fire-and-forget |
| `analytics-engine` | Kafka (async) | Revenue and billing metrics | Fire-and-forget |
| `audit-log-service` | Kafka (async) | Tenant lifecycle audit | Fire-and-forget |
| ALL services | gRPC | Quota check endpoint (enforced at API gateway) | Circuit breaker, 2s timeout |

### 7.2 External Integrations

| Integration | Protocol | Purpose | Adapter |
|---|---|---|---|
| **Stripe** | REST API + Webhooks | Payment processing, subscription management | `StripePaymentAdapter` |
| **Adyen** | REST API + Webhooks | Payment processing (alternative) | `AdyenPaymentAdapter` |
| **Avalara** | REST API | Tax calculation and compliance | `TaxComplianceAdapter` |

---

## 8. Configuration Properties

```yaml
# application.yml
billing:
  service:
    name: billing-service

  plans:
    standard:
      name: "Standard"
      base-price: 299.00
      included:
        vehicles: 100
        drivers: 25
        gps-events-per-sec: 50
        api-calls-per-min: 1000
        storage-gb: 10
        retention-months: 6
      overage-rates:
        vehicles: 5.00
        gps-events-per-sec: 0.01
        api-calls-per-min: 0.001
    professional:
      name: "Professional"
      base-price: 999.00
      included:
        vehicles: 1000
        drivers: 250
        gps-events-per-sec: 500
        api-calls-per-min: 10000
        storage-gb: 100
        retention-months: 24
    enterprise:
      name: "Enterprise"
      base-price: 0.00   # Custom pricing
      included:
        vehicles: -1      # Unlimited
        drivers: -1
        gps-events-per-sec: -1
        api-calls-per-min: -1
        storage-gb: -1

  invoice:
    generation-day: 1            # Day of month for invoice generation
    due-days: 30                 # Days after generation
    overdue-grace-days: 7        # Days before overdue alert
    write-off-days: 90           # Days before automatic write-off
    auto-generation-enabled: true
    tax-calculation-enabled: true

  payment:
    processor: stripe            # stripe or adyen
    stripe:
      api-key: ${STRIPE_API_KEY}
      webhook-secret: ${STRIPE_WEBHOOK_SECRET}
    adyen:
      api-key: ${ADYEN_API_KEY}
      merchant-account: ${ADYEN_MERCHANT_ACCOUNT}
      webhook-secret: ${ADYEN_WEBHOOK_SECRET}
    retry-max-attempts: 3
    retry-backoff-seconds: 5

  usage:
    aggregation-interval-seconds: 60
    meter-types:
      - GPS_EVENTS
      - API_CALLS
      - VEHICLES_TRACKED
      - DRIVERS
      - STORAGE_GB
      - DATA_RETENTION_MONTHS
      - REPORT_GENERATION
      - ML_PREDICTIONS

  tenant:
    trial-days: 14
    suspension-grace-days: 7
    deprotection-grace-days: 30
    provisioning-workflow:
      create-database: true
      create-schema: true
      seed-default-config: true
      notify-owner: true

  quota:
    enforcement-enabled: true
    check-endpoint-enabled: true
    soft-limit-percent: 80        # Alert at 80% of quota
    hard-limit-percent: 100       # Block at 100%

server:
  port: 8095

spring:
  application:
    name: billing-service

  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:fleetvision_billing}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:}

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    consumer:
      group-id: billing-service
      auto-offset-reset: latest

grpc:
  server:
    port: 9099
  client:
    identity-service:
      address: static://identity-service:9090
      negotiation-type: tls

resilience4j:
  circuitbreaker:
    instances:
      stripeAdapter:
        slidingWindowSize: 10
        failureRateThreshold: 60
        waitDurationInOpenState: 60s
      identityService:
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
  retry:
    instances:
      stripeAdapter:
        maxAttempts: 3
        waitDuration: 5s
      identityService:
        maxAttempts: 3
        waitDuration: 500ms
  timelimiter:
    instances:
      stripeAdapter:
        timeoutDuration: 15s
      identityService:
        timeoutDuration: 3s
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configuration

| Target Service | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| `identity-service` (gRPC) | 10 calls | 50% | 30s | 3 |
| Stripe API | 10 calls | 60% | 60s | 3 |
| Adyen API | 10 calls | 60% | 60s | 3 |
| Avalara API | 5 calls | 60% | 60s | 2 |

### 9.2 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| gRPC: Validate user | 3s | Reject provisioning |
| Stripe payment intent | 15s | Queue for async retry |
| Stripe invoice create | 10s | Generate draft locally; sync later |
| Tax calculation | 5s | Use default tax rate; flag for review |

### 9.3 Graceful Degradation

- **Payment processor down:** Queue payment attempts for async retry. Invoice status remains PENDING.
- **Tax calculation unavailable:** Use default tax rate (based on tenant jurisdiction); flag invoice for tax review.
- **Quota check failure:** Default to "allow" if quota service is unavailable (avoid blocking all platform access).
- **Invoice PDF generation failure:** Invoice data is still available; PDF generation retried asynchronously.

---

## 10. Test Strategy

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | JUnit 5 + MockK + Kotest | 90% | Invoice calculation, usage aggregation, quota enforcement, subscription rules, proration logic, tier transitions |
| **Integration Tests** | Spring Boot Test + Testcontainers | 80% | Tenant provisioning, subscription lifecycle, invoice generation, payment processing |
| **Contract Tests** | Pact | 100% | gRPC contracts with identity-service; Stripe webhook schema |
| **E2E Tests** | Karate DSL | Critical paths | Tenant provisioning -> subscription creation -> usage recording -> invoice generation -> payment |
| **Performance Tests** | Gatling | SLO validation | Usage recording throughput (10K TPS), invoice generation (< 5s), quota check latency (< 10ms) |
| **Billing Accuracy Tests** | Kotest property-based | High | Invoice line item accuracy, tax calculation, overage billing, proration formulas |

### Key Test Scenarios

1. **Full Billing Cycle:** Provision tenant -> create subscription (monthly) -> record usage (mixed meters) -> generate invoice -> process payment -> verify invoice is PAID
2. **Overage Billing:** Tenant on Standard plan uses 150 vehicles (100 included) -> invoice shows 50 vehicle overage at $5/vehicle = $250
3. **Quota Enforcement:** Tenant at 100% vehicle quota -> new vehicle registration blocked with 423 response
4. **Subscription Cancellation:** Cancel subscription mid-period -> prorated credit on final invoice
5. **Tier Upgrade:** Standard -> Professional -> prorated charge for remaining period
6. **Payment Failure:** Payment intent fails -> invoice status PENDING -> 7 days -> overdue alert -> 90 days -> write-off
7. **Tenant Suspension:** Non-payment for 30 days -> tenant suspended -> all services notified via Kafka
8. **Tenant Deprovisioning:** Suspended tenant deprovisioned -> database schema dropped (after grace period) -> audit logged

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
