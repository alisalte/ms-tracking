# Identity & Access Management (IAM) Context
## Module-Level Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Bounded Context:** Identity & Access Management
**Service:** `identity-service`
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

The Identity & Access Management (IAM) context is responsible for managing users, roles, permissions, organizations, and authentication within the FleetVision platform. It serves as the authoritative source for all access control decisions and organizational hierarchy. Every other bounded context depends on IAM for authorization validation and tenant resolution.

### 1.2 Context Map

```
                        ┌───────────────────────────────┐
                        │  FLEET MANAGEMENT              │
                        │  ACL: User roles, permissions │
                        └───────────────┬───────────────┘
                                        │
┌───────────────────────┐  ┌────────────┴────────────┐  ┌───────────────────────┐
│  BILLING & TENANT MGMT│◄─│  IDENTITY & ACCESS      │──►│  AUDIT LOG SERVICE    │
│  ACL: Org hierarchy   │  │  MANAGEMENT              │  │  (audit events)       │
│  tenant context       │  │  (This Context)          │  └───────────────────────┘
└───────────────────────┘  └──────┬────────┬────────┘
                                  │        │
                                  ▼        ▼
                        ┌──────────┐  ┌──────────────┐
                        │ KEYCLOAK │  │ OPA          │
                        │ (OIDC)   │  │ (Policy)     │
                        └──────────┘  └──────────────┘

Upstream Contexts Consuming IAM:
  • Fleet Management — vehicle/operator access control
  • Tracking & Monitoring — dashboard user permissions
  • Driver Management — driver assignment authorization
  • Trip & Route Management — dispatch authorization
  • Vehicle Maintenance — work order assignment ACL
  • Analytics — user-level report access filtering
```

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **User** | A human actor who authenticates and interacts with the platform; carries a unique identity |
| **Role** | A named collection of permissions assignable to users within an organization scope |
| **Permission** | A fine-grained authorization grant (e.g., `fleet.vehicle.create`, `driver.profile.read`) |
| **Organization** | A hierarchical entity (Tenant > Division > Department > Team) representing structural units |
| **Tenant** | The root-level organizational entity representing an independent customer; owns isolated data |
| **API Key** | A machine-oriented credential for service-to-service or partner API access |
| **Service Account** | A non-human identity used by platform services for internal communication |
| **Session** | An active authenticated context with token claims, device info, and expiry |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        IDENTITY-SERVICE (Spring Boot 3.3 + Kotlin)         │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  INFRASTRUCTURE LAYER                                                 │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ PostgreSQL   │ │ Keycloak     │ │ Redis        │ │ Kafka      │ │  │
│  │  │ Adapter      │ │ Adapter      │ │ Session Store│ │ Producer   │ │  │
│  │  │ (JPA/Hibernate)│ (REST Client)│ │ Adapter      │ │ Adapter    │ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐                                  │  │
│  │  │ OPA          │ │ Vault        │                                  │  │
│  │  │ Policy Client│ │ Secret Client│                                  │  │
│  │  └──────────────┘ └──────────────┘                                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS LAYER                                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│  │  │ REST Controllers │  │ gRPC Server      │  │ Event Listeners  │   │  │
│  │  │ (AuthController, │  │ (IdentityGrpcSvc)│  │ (Kafka Consumer) │   │  │
│  │  │  UserController, │  │                   │  │                   │   │  │
│  │  │  OrgController,  │  │                   │  │                   │   │  │
│  │  │  RoleController) │  │                   │  │                   │   │  │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘   │  │
│  │           │                     │                      │             │  │
│  │  ┌────────┴─────────────────────┴──────────────────────┴─────────┐   │  │
│  │  │ DTOs / Request Mappers / Response Mappers / JWT Parsers      │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  APPLICATION BUSINESS RULES (USE CASES)                             │  │
│  │                                                                       │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ AuthenticateUser │ │ CreateUser       │ │ AssignRole       │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ CreateOrg        │ │ RevokePermission │ │ ManageAPIKeys    │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐     │  │
│  │  │ ValidateToken    │ │ CreateServiceAct │ │ ListUsersInOrg  │     │  │
│  │  │ UseCase          │ │ UseCase          │ │ UseCase          │     │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘     │  │
│  │  Ports: IAuthRepository, IUserRepository, IOrgRepository, etc.       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     ▲                                       │
│  ┌──────────────────────────────────┴───────────────────────────────────┐  │
│  │  ENTERPRISE BUSINESS RULES (ENTITIES)                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │  │
│  │  │ User         │ │ Organization │ │ Role         │ │ Permission │ │  │
│  │  │ (Aggregate)  │ │ (Aggregate)  │ │ (Entity)     │ │ (Value Obj)│ │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │  │
│  │  │ APIKey       │ │ ServiceAcct  │ │ Session      │                  │  │
│  │  │ (Aggregate)  │ │ (Aggregate)  │ │ (Entity)     │                  │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘                  │  │
│  │  Domain Services: AuthorizationService, TenantResolutionService      │  │
│  │  Domain Events: UserCreated, RoleAssigned, PermissionRevoked, etc.  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Aggregate Root Design

### 3.1 User Aggregate Root

**AggregateId:** `UserId` (UUID)
**Consistency Scope:** User identity, credentials, role bindings, and profile within a single tenant.

```kotlin
data class UserId(val value: UUID)

enum class UserStatus { ACTIVE, SUSPENDED, DEACTIVATED, LOCKED }

data class User(
    val id: UserId,
    val tenantId: UUID,
    val email: String,
    val username: String,
    val passwordHash: String?,          // null for SSO-only users
    val status: UserStatus,
    val profile: UserProfile,
    val roleBindings: MutableList<RoleBinding>,
    val authProvider: AuthProvider,
    val mfaEnabled: Boolean,
    val lastLoginAt: Instant?,
    val failedLoginAttempts: Int,
    val lockoutUntil: Instant?,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    // --- Behaviors ---

    fun activate() {
        require(status in listOf(UserStatus.SUSPENDED, UserStatus.DEACTIVATED)) {
            "Cannot activate user in $status state"
        }
        return copy(status = UserStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(UserActivatedEvent(it)) }
    }

    fun suspend(reason: String) {
        require(status == UserStatus.ACTIVE) { "Only active users can be suspended" }
        return copy(status = UserStatus.SUSPENDED, updatedAt = Instant.now())
            .also { raiseDomainEvent(UserSuspendedEvent(it, reason)) }
    }

    fun recordFailedLogin(maxAttempts: Int = 5, lockoutDuration: Duration = Duration.ofMinutes(15)): User {
        val newAttempts = failedLoginAttempts + 1
        return if (newAttempts >= maxAttempts) {
            copy(
                status = UserStatus.LOCKED,
                failedLoginAttempts = newAttempts,
                lockoutUntil = Instant.now().plus(lockoutDuration),
                updatedAt = Instant.now()
            ).also { raiseDomainEvent(UserLockedEvent(it, "Max failed login attempts")) }
        } else {
            copy(failedLoginAttempts = newAttempts, updatedAt = Instant.now())
        }
    }

    fun recordSuccessfulLogin(): User {
        require(status == UserStatus.ACTIVE) { "User is not active" }
        return copy(
            lastLoginAt = Instant.now(),
            failedLoginAttempts = 0,
            lockoutUntil = null,
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(UserLoggedInEvent(it)) }
    }

    fun changeEmail(newEmail: String): User {
        require(newEmail.isNotBlank() && newEmail.contains("@")) { "Invalid email format" }
        require(newEmail != email) { "Email is unchanged" }
        return copy(email = newEmail.lowercase().trim(), updatedAt = Instant.now())
            .also { raiseDomainEvent(UserEmailChangedEvent(it, email, newEmail)) }
    }

    fun assignRole(roleId: UUID, scope: String? = null): User {
        val alreadyBound = roleBindings.any { it.roleId == roleId && it.scope == scope }
        require(!alreadyBound) { "Role $roleId is already bound at scope $scope" }
        val binding = RoleBinding(roleId = roleId, scope = scope, assignedAt = Instant.now())
        return copy(
            roleBindings = (roleBindings + binding).toMutableList(),
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(RoleAssignedEvent(it, roleId, scope)) }
    }

    fun revokeRole(roleId: UUID, scope: String? = null): User {
        val binding = roleBindings.find { it.roleId == roleId && it.scope == scope }
            ?: throw IllegalStateException("Role binding not found")
        return copy(
            roleBindings = roleBindings.filterNot { it.roleId == roleId && it.scope == scope }.toMutableList(),
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(RoleRevokedEvent(it, roleId, scope)) }
    }

    fun enableMfa(secret: String): User {
        require(!mfaEnabled) { "MFA already enabled" }
        return copy(mfaEnabled = true, updatedAt = Instant.now())
            .also { raiseDomainEvent(MfaEnabledEvent(it)) }
    }

    fun deactivate(): User {
        require(status != UserStatus.DEACTIVATED) { "Already deactivated" }
        return copy(status = UserStatus.DEACTIVATED, updatedAt = Instant.now())
            .also { raiseDomainEvent(UserDeactivatedEvent(it)) }
    }

    // --- Invariants ---
    // INV-01: email must be unique within tenant
    // INV-02: username must be unique across platform
    // INV-03: at least one role binding must exist for ACTIVE users
    // INV-04: passwordHash must be present if authProvider == LOCAL
    // INV-05: status transition: ACTIVE->SUSPENDED->DEACTIVATED (or ACTIVE->LOCKED->ACTIVE)
}
```

### 3.2 Organization Aggregate Root

```kotlin
data class OrganizationId(val value: UUID)

enum class OrgType { TENANT, DIVISION, DEPARTMENT, TEAM }

data class Organization(
    val id: OrganizationId,
    val tenantId: UUID,
    val parentOrgId: UUID?,
    val name: String,
    val orgType: OrgType,
    val code: String,                    // unique short code
    val status: OrgStatus,
    val metadata: Map<String, String>,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun createSubOrganization(name: String, type: OrgType, code: String): Organization {
        require(type != OrgType.TENANT) { "Sub-org cannot be a Tenant" }
        require(orgType.ordinal < type.ordinal) { "Cannot create a broader org type as child" }
        require(status == OrgStatus.ACTIVE) { "Parent org must be active" }
        // Construction delegated to factory
        return Organization(
            id = OrganizationId(UUID.randomUUID()),
            tenantId = tenantId,
            parentOrgId = id.value,
            name = name,
            orgType = type,
            code = code,
            status = OrgStatus.ACTIVE,
            metadata = emptyMap(),
            version = 0,
            createdAt = Instant.now(),
            updatedAt = Instant.now()
        ).also { raiseDomainEvent(SubOrganizationCreatedEvent(it, id.value)) }
    }

    fun activate(): Organization =
        copy(status = OrgStatus.ACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(OrganizationActivatedEvent(it)) }

    fun deactivate(): Organization =
        copy(status = OrgStatus.INACTIVE, updatedAt = Instant.now())
            .also { raiseDomainEvent(OrganizationDeactivatedEvent(it)) }

    // INV-01: code must be unique within tenant
    // INV-02: parentOrgId must reference an existing Organization in same tenant
    // INV-03: hierarchy depth max 5 levels
}
```

### 3.3 APIKey Aggregate Root

```kotlin
data class APIKeyId(val value: UUID)

data class APIKey(
    val id: APIKeyId,
    val tenantId: UUID,
    val name: String,
    val keyHash: String,              // SHA-256 hash of the key
    val keyPrefix: String,            // First 8 chars for identification (e.g., "fv_live_abc12345...")
    val scopes: List<String>,
    val assignedUserId: UUID?,
    val expiresAt: Instant?,
    val lastUsedAt: Instant?,
    val status: APIKeyStatus,
    val rateLimit: RateLimitConfig,
    val version: Long,
    val createdAt: Instant,
    val updatedAt: Instant
) {
    fun revoke(reason: String): APIKey =
        copy(status = APIKeyStatus.REVOKED, updatedAt = Instant.now())
            .also { raiseDomainEvent(APIKeyRevokedEvent(it, reason)) }

    fun recordUsage(): APIKey =
        copy(lastUsedAt = Instant.now(), updatedAt = Instant.now())

    fun isExpired(): Boolean = expiresAt?.let { Instant.now().isAfter(it) } ?: false

    // INV-01: keyHash is immutable after creation
    // INV-02: scopes cannot exceed tenant permissions
    // INV-03: at least one scope required
}
```

### 3.4 Domain Events

| Event | Trigger | Payload Fields |
|---|---|---|
| `iam.user.created.v1` | New user registered | userId, tenantId, email, username, authProvider |
| `iam.user.activated.v1` | User activated | userId, tenantId |
| `iam.user.suspended.v1` | User suspended | userId, tenantId, reason |
| `iam.user.deactivated.v1` | User deactivated | userId, tenantId |
| `iam.user.locked.v1` | Account locked | userId, tenantId, reason |
| `iam.user.email.changed.v1` | Email updated | userId, tenantId, oldEmail, newEmail |
| `iam.user.mfa.enabled.v1` | MFA activated | userId, tenantId |
| `iam.role.assigned.v1` | Role granted | userId, roleId, scope, tenantId |
| `iam.role.revoked.v1` | Role removed | userId, roleId, scope, tenantId |
| `iam.org.created.v1` | Organization created | orgId, tenantId, parentOrgId, name, type |
| `iam.org.deactivated.v1` | Organization deactivated | orgId, tenantId |
| `iam.apikey.created.v1` | API key issued | keyId, tenantId, name, keyPrefix, scopes |
| `iam.apikey.revoked.v1` | API key revoked | keyId, tenantId, reason |

---

## 4. Repository Interfaces

```kotlin
package com.fleetvision.identity.domain.port.out

import com.fleetvision.identity.domain.model.*
import java.util.UUID

/**
 * Port — outbound. Implemented by Infrastructure layer.
 * All query methods accept tenantId for multi-tenant isolation.
 */

interface UserRepository {
    fun save(user: User): User
    fun findById(userId: UUID, tenantId: UUID): User?
    fun findByEmail(email: String, tenantId: UUID): User?
    fun findByUsername(username: String): User?
    fun existsByEmail(email: String, tenantId: UUID): Boolean
    fun existsByUsername(username: String): Boolean
    fun findByTenantAndStatus(tenantId: UUID, status: UserStatus, page: Int, size: Int): List<User>
    fun findUsersInOrganization(orgId: UUID, tenantId: UUID, page: Int, size: Int): List<User>
    fun countByTenant(tenantId: UUID): Long
    fun delete(userId: UUID, tenantId: UUID)
}

interface OrganizationRepository {
    fun save(org: Organization): Organization
    fun findById(orgId: UUID, tenantId: UUID): Organization?
    fun findByTenant(tenantId: UUID): List<Organization>
    fun findChildren(parentOrgId: UUID, tenantId: UUID): List<Organization>
    fun findRootOrganization(tenantId: UUID): Organization?
    fun existsByCode(code: String, tenantId: UUID): Boolean
    fun findHierarchy(orgId: UUID, tenantId: UUID): List<Organization>
    fun delete(orgId: UUID, tenantId: UUID)
}

interface RoleRepository {
    fun save(role: Role): Role
    fun findById(roleId: UUID, tenantId: UUID): Role?
    fun findByName(name: String, tenantId: UUID): Role?
    fun findByTenant(tenantId: UUID): List<Role>
    fun existsByName(name: String, tenantId: UUID): Boolean
    fun delete(roleId: UUID, tenantId: UUID)
}

interface APIKeyRepository {
    fun save(apiKey: APIKey): APIKey
    fun findById(keyId: UUID, tenantId: UUID): APIKey?
    fun findByKeyHash(keyHash: String): APIKey?
    fun findByPrefix(prefix: String, tenantId: UUID): List<APIKey>
    fun findActiveByTenant(tenantId: UUID): List<APIKey>
    fun findExpiredKeys(now: java.time.Instant): List<APIKey>
    fun delete(keyId: UUID, tenantId: UUID)
}

interface SessionRepository {
    fun save(session: Session): Session
    fun findById(sessionId: String): Session?
    fun findByUserId(userId: UUID): List<Session>
    fun deleteById(sessionId: String)
    fun deleteByUserId(userId: UUID)
    fun deleteExpired(now: java.time.Instant)
}

// Port — inbound (used by use cases)
interface EventPublisher {
    fun publish(event: DomainEvent)
}
```

---

## 5. API Endpoints

### 5.1 REST API

Base path: `/api/v1/iam`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/auth/login` | Authenticate user, return JWT + refresh token | Public |
| `POST` | `/auth/logout` | Invalidate session, revoke refresh token | Bearer JWT |
| `POST` | `/auth/refresh` | Exchange refresh token for new access token | Refresh Token |
| `POST` | `/auth/mfa/challenge` | Initiate MFA challenge | Bearer JWT |
| `POST` | `/auth/mfa/verify` | Verify MFA code | Bearer JWT |
| `POST` | `/auth/forgot-password` | Request password reset email | Public |
| `POST` | `/auth/reset-password` | Reset password using token | Reset Token |
| `GET` | `/users` | List users (paginated, filtered) | Bearer JWT + `iam.user.read` |
| `GET` | `/users/{userId}` | Get user detail | Bearer JWT + `iam.user.read` |
| `POST` | `/users` | Create user | Bearer JWT + `iam.user.create` |
| `PUT` | `/users/{userId}` | Update user profile | Bearer JWT + `iam.user.update` |
| `PATCH` | `/users/{userId}/status` | Activate/suspend/deactivate user | Bearer JWT + `iam.user.manage` |
| `POST` | `/users/{userId}/roles` | Assign role to user | Bearer JWT + `iam.role.assign` |
| `DELETE` | `/users/{userId}/roles/{roleId}` | Revoke role from user | Bearer JWT + `iam.role.revoke` |
| `GET` | `/users/{userId}/permissions` | List effective permissions | Bearer JWT + `iam.permission.read` |
| `GET` | `/organizations` | List organizations in tenant | Bearer JWT + `iam.org.read` |
| `GET` | `/organizations/{orgId}` | Get organization detail | Bearer JWT + `iam.org.read` |
| `POST` | `/organizations` | Create sub-organization | Bearer JWT + `iam.org.create` |
| `PUT` | `/organizations/{orgId}` | Update organization | Bearer JWT + `iam.org.update` |
| `PATCH` | `/organizations/{orgId}/status` | Activate/deactivate org | Bearer JWT + `iam.org.manage` |
| `GET` | `/organizations/{orgId}/hierarchy` | Get org subtree | Bearer JWT + `iam.org.read` |
| `GET` | `/roles` | List roles in tenant | Bearer JWT + `iam.role.read` |
| `POST` | `/roles` | Create custom role | Bearer JWT + `iam.role.create` |
| `PUT` | `/roles/{roleId}` | Update role definition | Bearer JWT + `iam.role.update` |
| `DELETE` | `/roles/{roleId}` | Delete custom role | Bearer JWT + `iam.role.delete` |
| `GET` | `/api-keys` | List API keys | Bearer JWT + `iam.apikey.read` |
| `POST` | `/api-keys` | Create API key | Bearer JWT + `iam.apikey.create` |
| `DELETE` | `/api-keys/{keyId}` | Revoke API key | Bearer JWT + `iam.apikey.revoke` |

### 5.2 gRPC Service

```protobuf
service IdentityService {
  // Token validation (called by API Gateway and other services)
  rpc ValidateToken (ValidateTokenRequest) returns (ValidateTokenResponse);
  // Batch permission check
  rpc CheckPermissions (CheckPermissionsRequest) returns (CheckPermissionsResponse);
  // Resolve tenant from token
  rpc ResolveTenant (ResolveTenantRequest) returns (ResolveTenantResponse);
  // Get user effective roles within an org
  rpc GetUserRoles (GetUserRolesRequest) returns (GetUserRolesResponse);
  // Batch user lookup by IDs
  rpc LookupUsers (LookupUsersRequest) returns (LookupUsersResponse);
}

message ValidateTokenRequest {
  string token = 1;
}

message ValidateTokenResponse {
  bool valid = 1;
  string user_id = 2;
  string tenant_id = 3;
  repeated string roles = 4;
  repeated string permissions = 5;
  int64 expires_at = 6;
}

message CheckPermissionsRequest {
  string user_id = 1;
  string tenant_id = 2;
  repeated string permissions = 3;
  optional string resource_id = 4;
}

message CheckPermissionsResponse {
  map<string, bool> results = 1;  // permission -> granted
}

message ResolveTenantRequest {
  string token = 1;
}

message ResolveTenantResponse {
  string tenant_id = 1;
  string tenant_name = 2;
  string tier = 3;
  map<string, string> config = 4;
}

message GetUserRolesRequest {
  string user_id = 1;
  string tenant_id = 2;
  optional string org_id = 3;
}

message GetUserRolesResponse {
  repeated Role roles = 1;
}

message Role {
  string id = 1;
  string name = 2;
  repeated string permissions = 3;
}

message LookupUsersRequest {
  repeated string user_ids = 1;
  string tenant_id = 2;
}

message LookupUsersResponse {
  repeated UserSummary users = 1;
}

message UserSummary {
  string id = 1;
  string email = 2;
  string username = 3;
  string display_name = 4;
  string status = 5;
}
```

### 5.3 Sample REST Request/Response

```
POST /api/v1/iam/auth/login
Content-Type: application/json

{
  "username": "jdoe@acme.com",
  "password": "********",
  "mfa_code": "123456"          // optional, if MFA enabled
}

Response 200:
{
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2g...",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "jdoe@acme.com",
      "username": "jdoe",
      "display_name": "John Doe",
      "tenant_id": "660e8400-e29b-41d4-a716-446655440001",
      "roles": ["fleet-operator"],
      "mfa_enabled": true
    }
  }
}
```

---

## 6. Kafka Event Contracts

### 6.1 Event Topics

| Topic | Partition Key | Retention | Owner |
|---|---|---|---|
| `fleetvision.iam.user.events` | `userId` | 7 days | identity-service |
| `fleetvision.iam.role.events` | `roleId` | 7 days | identity-service |
| `fleetvision.iam.org.events` | `orgId` | 7 days | identity-service |
| `fleetvision.iam.apikey.events` | `keyId` | 7 days | identity-service |

### 6.2 Published Events (Producer)

```json
// iam.user.created.v1
{
  "specversion": "1.0",
  "type": "iam.user.created.v1",
  "source": "/identity-service",
  "id": "uuid-v4",
  "time": "2026-08-02T14:30:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "660e8400-e29b-41d4-a716-446655440001",
    "email": "jdoe@acme.com",
    "username": "jdoe",
    "auth_provider": "LOCAL",
    "created_by": "system"
  },
  "fleetvision": {
    "tenant_id": "660e8400-e29b-41d4-a716-446655440001",
    "correlation_id": "uuid-v4",
    "causation_id": "uuid-v4",
    "aggregate_id": "550e8400-e29b-41d4-a716-446655440000",
    "aggregate_version": 1
  }
}
```

### 6.3 Consumed Events (Subscriber)

| Topic | Event | Handler Action |
|---|---|---|
| `fleetvision.tenant.billing.events` | `billing.tenant.suspended.v1` | Suspend all users in tenant, block new logins |
| `fleetvision.tenant.billing.events` | `billing.tenant.activated.v1` | Reactivate suspended users in tenant |
| `fleetvision.audit.log.requests` | `audit.log.query.requested.v1` | Query user/org change history and publish to audit topic |
| `fleetvision.driver.license.events` | `driver.license.expired.v1` | Auto-revoke driver-role binding if applicable |

---

## 7. Dependencies & External Integrations

### 7.1 Internal Service Dependencies

| Dependency | Protocol | Purpose |
|---|---|---|
| API Gateway | REST (inbound) | Single entry for IAM endpoints |
| Notification Service | Kafka (outbound) | Password reset emails, MFA codes, account alerts |
| Audit Log Service | Kafka (outbound) | All user/org change audit trails |
| Billing & Tenant Mgmt | Kafka (bidirectional) | Tenant lifecycle events |
| Analytics Engine | Kafka (outbound) | User activity events for dashboards |
| All Core Services | gRPC (inbound) | Token validation, permission checks |

### 7.2 External Integrations

| Integration | Technology | Direction | Notes |
|---|---|---|---|
| **Keycloak** | REST API | Bidirectional | OIDC identity provider, user federation, SSO |
| **OPA** | REST API | Outbound | Policy-as-code authorization evaluation |
| **HashiCorp Vault** | Transit engine | Outbound | Password hashing, encryption key management |
| **SMTP Relay** | SMTP | Outbound | Password reset, MFA, notification emails |
| **HR Systems (Workday, ADP)** | SCIM 2.0 | Outbound | User provisioning/deprovisioning sync |
| **Customer SSO (Okta, Azure AD)** | OIDC/SAML2 | Inbound | Federated authentication for enterprise tenants |

### 7.3 Integration Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Client App │     │  Keycloak   │     │  HR System  │
│  (Web/Mob)  │────►│  (OIDC)     │◄────│  (SCIM)     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              identity-service                        │
│                                                      │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────┐  │
│  │ REST   │  │ gRPC   │  │ Kafka  │  │ OPA      │  │
│  │ API    │  │ Server │  │ Pub/Sub│  │ Client   │  │
│  └────┬───┘  └───┬────┘  └───┬────┘  └─────┬────┘  │
│       │          │           │              │        │
│       ▼          ▼           ▼              ▼        │
│  ┌────────────────────────────────────────────────┐ │
│  │           Domain & Application Layer             │ │
│  └────────────────────────────────────────────────┘ │
└───────────────┬──────────────────┬───────────────────┘
                │                  │
                ▼                  ▼
         ┌──────────┐       ┌──────────┐
         │PostgreSQL│       │  Redis   │
         │          │       │ (Session)│
         └──────────┘       └──────────┘
```

---

## 8. Configuration Properties

```yaml
# application-iam.yaml (identity-service)
fleetvision:
  iam:
    service-name: identity-service

    auth:
      jwt:
        access-token-ttl: 15m
        refresh-token-ttl: 7d
        issuer: fleetvision-identity
        signing-algorithm: RS256
        key-id: iam-rsa-key-1
        # Key loaded from Vault at runtime
      mfa:
        totp-issuer: FleetVision
        code-length: 6
        code-ttl-seconds: 30
        backup-codes-count: 10
      password:
        min-length: 12
        require-uppercase: true
        require-lowercase: true
        require-digit: true
        require-special: true
        history-count: 5
        max-age-days: 90

    lockout:
      max-failed-attempts: 5
      lockout-duration: 15m
      progressive-multiplier: 2.0

    api-key:
      default-ttl: 90d
      max-ttl: 365d
      rate-limit:
        default-rpm: 1000
        default-burst: 100
      prefix: "fv_live_"

    organization:
      max-hierarchy-depth: 5
      default-role-on-create: "org-admin"

    tenant:
      default-roles:
        - name: "fleet-admin"
          permissions:
            - "fleet.*"
        - name: "fleet-operator"
          permissions:
            - "fleet.vehicle.read"
            - "fleet.vehicle.update"
            - "driver.profile.read"
        - name: "driver"
          permissions:
            - "trip.own.read"
            - "driver.own.profile.update"
        - name: "viewer"
          permissions:
            - "fleet.*.read"

    keycloak:
      base-url: ${KEYCLOAK_URL}
      realm: fleetvision
      client-id: identity-service
      client-secret: ${KEYCLOAK_CLIENT_SECRET}
      connection-timeout: 5s
      read-timeout: 10s

    opa:
      base-url: ${OPA_URL}
      policy-bundle-path: /iam/policies
      connection-timeout: 3s
      read-timeout: 5s

  database:
    jdbc-url: jdbc:postgresql://${DB_HOST}:5432/fleetvision_iam
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    pool:
      maximum-pool-size: 20
      minimum-idle: 5
      idle-timeout: 300000
      max-lifetime: 1800000
    migration:
      locations: classpath:db/migration/iam

  redis:
    host: ${REDIS_HOST}
    port: 6379
    password: ${REDIS_PASSWORD}
    session-ttl: 900         # matches access token TTL
    database-index: 0

  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      client-id: identity-service-producer
      acks: all
      retries: 3
      linger-ms: 5
      compression-type: lz4
    consumer:
      group-id: identity-service-consumer
      auto-offset-reset: earliest
      enable-auto-commit: false
    topics:
      user-events: fleetvision.iam.user.events
      role-events: fleetvision.iam.role.events
      org-events: fleetvision.iam.org.events
      apikey-events: fleetvision.iam.apikey.events
```

---

## 9. Resilience Patterns

### 9.1 Circuit Breaker Configurations

| Target | Failure Threshold | Open Duration | Half-Open Calls | Fallback |
|---|---|---|---|---|
| Keycloak (auth) | 5 failures in 30s | 30s | 3 | Return cached token data or deny auth |
| Keycloak (user sync) | 3 failures in 60s | 60s | 2 | Queue sync for retry, return stale data |
| OPA (policy check) | 10 failures in 30s | 10s | 5 | Default deny (secure by default) |
| Vault (key operations) | 3 failures in 60s | 60s | 2 | Deny sensitive operations |
| SMTP (email delivery) | 5 failures in 60s | 120s | 3 | Queue email in dead letter store |
| SCIM (HR provisioning) | 3 failures in 120s | 300s | 1 | Queue sync for later retry |

### 9.2 Retry Policies

| Operation | Max Retries | Backoff Strategy | Jitter |
|---|---|---|---|
| Token validation (gRPC) | 2 | Fixed 200ms | +/- 50ms |
| OPA policy evaluation | 3 | Exponential (100ms, 200ms, 400ms) | +/- 20% |
| User provisioning (SCIM) | 5 | Exponential (1s, 2s, 4s, 8s, 16s) | +/- 10% |
| Event publishing (Kafka) | 10 | Exponential (100ms base, 2x) | Full jitter |
| Database write | 3 | Exponential (50ms, 100ms, 200ms) | +/- 25% |

### 9.3 Timeout Configurations

| Operation | Connect Timeout | Read Timeout | Total Timeout |
|---|---|---|---|
| REST API requests | 5s | 10s | 15s |
| gRPC requests | 3s | 5s | 8s |
| Keycloak calls | 5s | 10s | 15s |
| OPA evaluation | 3s | 5s | 8s |
| Vault operations | 5s | 10s | 15s |
| SCIM sync | 10s | 30s | 45s |
| Kafka produce | 5s | — | 30s (including retries) |

### 9.4 Bulkhead Isolation

```kotlin
// Resilience4j bulkhead configuration
bulkhead:
  keycloak:
    max-concurrent-calls: 10
    max-wait-duration: 500ms
  opa:
    max-concurrent-calls: 20
    max-wait-duration: 200ms
  scim:
    max-concurrent-calls: 3
    max-wait-duration: 2s
  smtp:
    max-concurrent-calls: 5
    max-wait-duration: 1s
  database:
    max-concurrent-calls: 25
    max-wait-duration: 100ms
```

### 9.5 Rate Limiting

| Scope | Rate | Burst | Algorithm |
|---|---|---|---|
| Login attempts (per IP) | 10/min | 20 | Token bucket |
| Login attempts (per user) | 5/min | 8 | Sliding window |
| Password reset requests | 3/hour | 5 | Fixed window |
| API key creation | 5/min per tenant | 10 | Token bucket |
| User creation | 50/min per tenant | 100 | Token bucket |
| Token refresh | 30/min per user | 50 | Sliding window |

---

## 10. Test Strategy

### 10.1 Test Pyramid

| Layer | Scope | Tools | Coverage Target |
|---|---|---|---|
| **Unit Tests** | Domain entities, use cases, invariants | JUnit 5, Kotest, MockK | 90% |
| **Integration Tests** | Repository implementations, Kafka pub/sub | Testcontainers (PostgreSQL, Kafka, Redis) | 80% |
| **Contract Tests** | gRPC/REST API contracts | Spring Cloud Contract, Pact | 100% (all endpoints) |
| **Component Tests** | Full service with testcontainers | SpringBootTest, WireMock | Key flows |
| **End-to-End Tests** | Multi-service scenarios | Testcontainers Compose | Critical paths |

### 10.2 Domain Test Scenarios

**User Aggregate:**
- Create user with valid data succeeds
- Create user with duplicate email fails
- Activate suspended user succeeds
- Activate already-active user fails
- Record 5 failed logins locks account
- Record successful login resets failed attempts
- Assign duplicate role binding fails
- Revoke non-existent role binding fails
- SSO-only user must not have password hash
- User deactivation publishes domain event

**Organization Aggregate:**
- Create tenant root organization succeeds
- Create sub-org deeper than max depth fails
- Create sub-org under inactive parent fails
- Deactivate organization with active children fails (invariant check)

### 10.3 Integration Test Scenarios

- User creation persists to PostgreSQL and publishes Kafka event
- Token validation via gRPC returns correct permissions
- Keycloak integration creates federated user
- OPA policy evaluation grants/denies correctly
- Session stored in Redis with correct TTL
- Concurrent user creation with same email fails (unique constraint)

### 10.4 Contract Test Scenarios

- `ValidateToken` gRPC: valid token returns user roles
- `ValidateToken` gRPC: expired token returns `valid=false`
- `POST /auth/login`: valid credentials return JWT
- `POST /users`: required fields validated; returns 201
- `GET /users/{id}`: returns 404 for non-existent user
- `POST /users/{id}/roles`: returns 409 for duplicate role

### 10.5 Security Test Scenarios

- SQL injection on email/username fields
- JWT with forged claims rejected
- MFA bypass attempt fails
- Brute-force login blocked by rate limiter
- Cross-tenant data access prevented (RLS validation)
- API key with expired scope denied
- Service-to-service mTLS enforced via Istio

### 10.6 Performance Test Scenarios

| Scenario | Target | Tool |
|---|---|---|
| Login throughput | 500 TPS sustained | Gatling |
| Token validation (gRPC) | 10,000 TPS | Gatling / grpc-benchmark |
| User list with pagination | < 50ms p99 | k6 |
| Concurrent user creation | 100 concurrent without deadlock | JMeter |
| Session store (Redis) read latency | < 5ms p99 | Redis benchmark |

---

## Appendix A: Package Structure

```
com.fleetvision.identity/
├── domain/
│   ├── model/
│   │   ├── User.kt
│   │   ├── Organization.kt
│   │   ├── Role.kt
│   │   ├── APIKey.kt
│   │   ├── Session.kt
│   │   └── valueobjects/
│   │       ├── UserId.kt
│   │       ├── Permission.kt
│   │       ├── RoleBinding.kt
│   │       └── RateLimitConfig.kt
│   ├── event/
│   │   ├── UserCreatedEvent.kt
│   │   ├── RoleAssignedEvent.kt
│   │   └── ...
│   ├── service/
│   │   ├── AuthorizationService.kt
│   │   └── TenantResolutionService.kt
│   └── port/
│       ├── out/
│       │   ├── UserRepository.kt
│       │   ├── OrganizationRepository.kt
│       │   ├── RoleRepository.kt
│       │   ├── APIKeyRepository.kt
│       │   ├── SessionRepository.kt
│       │   └── EventPublisher.kt
│       └── in/
│           └── AuthUseCasePort.kt
├── application/
│   ├── usecase/
│   │   ├── AuthenticateUserUseCase.kt
│   │   ├── CreateUserUseCase.kt
│   │   ├── AssignRoleUseCase.kt
│   │   ├── CreateOrganizationUseCase.kt
│   │   ├── ManageAPIKeysUseCase.kt
│   │   └── ...
│   └── dto/
│       ├── LoginRequest.kt
│       ├── UserResponse.kt
│       ├── OrganizationResponse.kt
│       └── ...
├── adapter/
│   ├── inbound/
│   │   ├── rest/
│   │   │   ├── AuthController.kt
│   │   │   ├── UserController.kt
│   │   │   ├── OrganizationController.kt
│   │   │   ├── RoleController.kt
│   │   │   └── APIKeyController.kt
│   │   ├── grpc/
│   │   │   └── IdentityGrpcService.kt
│   │   └── event/
│   │       └── IAMEventConsumer.kt
│   └── outbound/
│       ├── persistence/
│       │   ├── jpa/
│       │   │   ├── UserJpaRepository.kt
│       │   │   ├── OrganizationJpaRepository.kt
│       │   │   └── ...
│       │   └── UserRepositoryAdapter.kt
│       ├── keycloak/
│       │   └── KeycloakAdapter.kt
│       ├── opa/
│       │   └── OPAPolicyClient.kt
│       ├── redis/
│       │   └── RedisSessionAdapter.kt
│       ├── vault/
│       │   └── VaultSecretClient.kt
│       └── kafka/
│           └── KafkaEventPublisherAdapter.kt
├── infrastructure/
│   ├── config/
│   │   ├── SecurityConfig.kt
│   │   ├── KafkaConfig.kt
│   │   ├── RedisConfig.kt
│   │   └── ResilienceConfig.kt
│   └── exception/
│       ├── UserAlreadyExistsException.kt
│       ├── InvalidCredentialsException.kt
│       └── AccessDeniedException.kt
└── IdentityServiceApplication.kt
```
