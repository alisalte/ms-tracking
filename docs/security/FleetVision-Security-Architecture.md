# FleetVision Security Architecture & Threat Model

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect, Security Architect  
**Classification:** Confidential  

---

## 1. Security Architecture Overview

### 1.1 Defense-in-Depth Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FLEETVISION SECURITY MODEL                            │
│                                                                          │
│  Layer 1: PERIMETER DEFENSE                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  • Cloudflare / AWS Shield (DDoS Protection, L3/L4/L7)         │    │
│  │  • WAF (OWASP Top 10 protection, SQL injection, XSS)            │    │
│  │  • Geo-IP blocking (block traffic from sanctioned countries)   │    │
│  │  • Bot detection and mitigation                                 │    │
│  │  • TLS 1.3 only (FIPS 140-2 compliant ciphers)                 │    │
│  │  • HSTS with preload, 1-year max-age                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Layer 2: API SECURITY                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  • API Gateway (Kong) — single entry point                        │    │
│  │  • JWT validation (RS256, Keycloak JWKS rotation)               │    │
│  │  • API Key authentication for partners                           │    │
│  │  • X.509 mTLS for IoT devices                                   │    │
│  │  • OPA policy engine (fine-grained authorization)               │    │
│  │  • Rate limiting (per-tenant, per-user, per-API-key)             │    │
│  │  • Request size limits (10MB max payload)                        │    │
│  │  • Input validation (JSON Schema per endpoint)                  │    │
│  │  • CORS enforcement (strict origin whitelist)                    │    │
│  │  • Request/response logging (PII redaction)                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Layer 3: SERVICE MESH (ZERO TRUST)                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  • Istio service mesh — mTLS everywhere                         │    │
│  │  • PeerAuthentication STRICT mode                                │    │
│  │  • AuthorizationPolicy (service-to-service ACL)                   │    │
│  │  • SPIFFE/SPIRE workload identity                                │    │
│  │  • NetworkPolicies (Kubernetes — deny all by default)            │    │
│  │  • Service account RBAC (per-service least privilege)             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Layer 4: APPLICATION SECURITY                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  • Tenant isolation enforcement at every layer                   │    │
│  │  • Row-Level Security (PostgreSQL) per tenant                     │    │
│  │  • Domain-level authorization checks                              │    │
│  │  • Input sanitization and output encoding                         │    │
│  │  • CSRF protection (double submit cookie)                       │    │
│  │  • Secure session management (HttpOnly, Secure, SameSite cookies)│    │
│  │  • Dependency scanning (Snyk/Dependabot)                         │    │
│  │  • SAST/DAST in CI/CD pipeline                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Layer 5: DATA SECURITY                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  • Encryption at rest: AES-256 (AWS KMS / Vault)                │    │
│  │  • Encryption in transit: TLS 1.3 + mTLS internally             │    │
│  │  • Column-level encryption (PII: SSN, license numbers)          │    │
│  │  • Data masking in non-production environments                   │    │
│  │  • Key management: HashiCorp Vault (auto-rotation)                │    │
│  │  • Secrets injection: Vault Agent / External Secrets Operator    │    │
│  │  • Database credential rotation (90-day automatic)                 │    │
│  │  • Secure disposal: crypto-shredding for tenant data erasure     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Layer 6: OPERATIONAL SECURITY                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  • Immutable infrastructure (no SSH to production)                 │    │
│  │  • Vulnerability scanning (container images, IaC)               │    │
│  │  • Runtime security (Falco for container threat detection)      │    │
│  │  • Audit logging (all administrative actions)                     │    │
│  │  • Incident response playbooks                                   │    │
│  │  • Penetration testing (quarterly by third party)                │    │
│  │  • Bug bounty program                                             │    │
│  │  • Security champions program (per team)                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Model (STRIDE)

### 2.1 Asset Inventory

| Asset | Classification | Sensitivity |
|---|---|---|
| GPS Position Data | Internal | Medium (location privacy) |
| Driver PII (name, license, address) | Confidential | High (PII, GDPR) |
| HOS Logs | Confidential | High (regulatory) |
| Financial Data (invoices, payments) | Confidential | High (PCI DSS) |
| Telematics Data | Internal | Medium |
| Vehicle Data (VIN, specs) | Internal | Low |
| API Keys & Tokens | Restricted | Critical |
| Encryption Keys | Restricted | Critical |
| Audit Logs | Confidential | High |
| Source Code | Restricted | High |
| Infrastructure Credentials | Restricted | Critical |

### 2.2 STRIDE Threat Analysis

| Threat | Target | Severity | Mitigation |
|---|---|---|---|
| **S**poofing | User authentication | High | MFA enforcement, JWT with short TTL (15 min), refresh token rotation, brute-force lockout |
| **S**poofing | API keys | Medium | Key rotation policy (90 days), IP allowlisting for partners, key-scoped permissions |
| **S**poofing | IoT devices | High | X.509 certificate authentication, device attestation, certificate revocation list |
| **T**ampering | HOS logs | Critical | Event sourcing with cryptographic hash chain, append-only table, FMCSA compliance |
| **T**ampering | Firmware OTA | Critical | Code signing (ECDSA), secure boot verification, staged rollout |
| **T**ampering | API payloads | High | Request signing (HMAC), payload checksum validation |
| **R**epudiation | All user actions | High | Immutable audit log (append-only ClickHouse), user identification in all entries |
| **R**epudiation | Driver inspections | High | Digital signatures on DVIR, timestamp + geolocation on all entries |
| **I**nformation Disclosure | Tenant data leak | Critical | Row-Level Security, schema isolation, dedicated instances, automated pen testing |
| **I**nformation Disclosure | PII exposure | High | Data masking, field-level encryption, GDPR data minimization, right to erasure |
| **I**nformation Disclosure | Logs with sensitive data | Medium | Structured logging with PII redaction pipeline (Fluentd filter) |
| **D**enial of Service | GPS ingestion pipeline | High | KEDA autoscaling, back-pressure handling, per-tenant rate limits |
| **D**enial of Service | API endpoints | High | WAF, rate limiting, circuit breakers, request queuing |
| **D**enial of Service | Database | High | Connection pooling, query timeouts, read replicas, PgBouncer |
| **E**levation of Privilege | User to admin | Critical | OPA policies, principle of least privilege, admin action MFA confirmation |
| **E**levation of Privilege | Tenant cross-access | Critical | RLS enforcement, tenant context propagation, automated isolation verification |

### 2.3 Attack Tree — Tenant Data Isolation Breach

```
Tenant Data Isolation Breach
├── 1. Application Layer
│   ├── 1.1 Exploit injection in API request to bypass tenant context
│   │   └── Mitigation: Parameterized queries, tenant_id from JWT (not request body), OPA validation
│   ├── 1.2 Compromise service account with cross-tenant access
│   │   └── Mitigation: Per-service RBAC, service accounts scoped to tenant operations, audit
│   └── 1.3 Exploit RLS misconfiguration
│        └── Mitigation: Automated RLS testing, infrastructure-as-code for RLS policies
│
├── 2. Database Layer
│   ├── 2.1 Direct database access bypassing application
│   │   └── Mitigation: Database in private subnet, no public IPs, Vault-managed credentials
│   ├── 2.2 SQL injection to extract cross-tenant data
│   │   └── Mitigation: Parameterized queries only, no dynamic SQL, SAST scanning
│   └── 2.3 Database user with cross-tenant SELECT privileges
│        └── Mitigation: Application database user enforces RLS, separate admin user for DDL only
│
├── 3. Infrastructure Layer
│   ├── 3.1 Compromise Kubernetes node
│   │   └── Mitigation: Encrypted at-rest volumes, node hardening, Falco runtime security
│   ├── 3.2 Cross-namespace traffic via service mesh bypass
│   │   └── Mitigation: Istio AuthorizationPolicy, NetworkPolicies deny-all default
│   └── 3.3 Secrets compromise
│        └── Mitigation: Vault with auto-rotation, short-lived dynamic secrets, audit
│
└── 4. Insider Threat
    ├── 4.1 Developer with database access queries cross-tenant data
    │   └── Mitigation: No direct production DB access, just-in-time access via Teleport + audit
    └── 4.2 Admin intentionally grants cross-tenant permissions
         └── Mitigation: MFA for admin actions,双人审批 for sensitive changes, full audit trail
```

---

## 3. Authentication Architecture

### 3.1 Authentication Flows

#### User Authentication (Web/Mobile)

```
Client                     Keycloak               Identity Service        User DB
  │                            │                          │                    │
  │  1. POST /auth/login      │                          │                    │
  │  {email, password}         │                          │                    │
  │───────────────────────────►                          │                    │
  │                            │                          │                    │
  │                            │  2. Validate credentials │                    │
  │                            │─────────────────────────►│                    │
  │                            │                          │  3. Lookup user     │
  │                            │                          │───────────────────►│
  │                            │                          │  4. User + roles    │
  │                            │                          │◄───────────────────│
  │                            │  5. Valid + tenant info   │                    │
  │                            │◄─────────────────────────│                    │
  │                            │                          │                    │
  │  6. JWT Access Token       │                          │                    │
  │     (15 min TTL)           │                          │                    │
  │     Refresh Token          │                          │                    │
  │     (7 day TTL)           │                          │                    │
  │◄───────────────────────────                          │                    │
  │                            │                          │                    │
  │  7. API Request            │                          │                    │
  │     Authorization: Bearer   │                          │                    │
  │───────────────────────────► Kong                    │                    │
  │                            │                          │                    │
  │  8. JWT validation          │                          │                    │
  │     (RS256, JWKS)          │                          │                    │
  │     + OPA policy check     │                          │                    │
```

#### IoT Device Authentication (MQTT + X.509)

```
Telematics Device         EMQX MQTT Broker        Device Mgmt Service     Vault
  │                            │                          │                    │
  │  1. TLS Handshake           │                          │                    │
  │     (X.509 cert)            │                          │                    │
  │◄───────────────────────────►                          │                    │
  │                            │  2. Validate cert chain   │                    │
  │                            │     + check CRL          │                    │
  │                            │                          │  3. Lookup device   │
  │                            │─────────────────────────►│                    │
  │                            │                          │                    │
  │  4. MQTT CONNECT            │                          │                    │
  │     clientId = serialNumber│                          │                    │
  │───────────────────────────►                          │                    │
  │                            │  5. ACL check per topic   │                    │
  │                            │     (device:tenant_id:    │                    │
  │                            │      device_id only)      │                    │
  │  6. CONNACK (authorized)   │                          │                    │
  │◄───────────────────────────                          │                    │
```

### 3.2 Token Structure

**JWT Access Token Payload:**
```json
{
  "iss": "https://auth.fleetvision.io/realms/{tenant_realm}",
  "sub": "user-uuid",
  "aud": "fleetvision-api",
  "exp": 1759482600,
  "iat": 1759481700,
  "jti": "unique-token-id",
  "fleetvision": {
    "tenant_id": "tenant-uuid",
    "organization_id": "org-uuid",
    "roles": ["fleet-manager", "driver-admin"],
    "permissions": ["vehicle:read", "vehicle:write", "driver:read"],
    "feature_flags": ["predictive-maintenance", "advanced-analytics"]
  }
}
```

### 3.3 MFA Configuration

| User Type | MFA Required | Methods |
|---|---|---|
| Standard User | Configurable per tenant policy | TOTP (Google Authenticator) |
| Admin User | Always required | TOTP + WebAuthn (hardware key) |
| API Integration | Not applicable | API Key + IP allowlist |
| IoT Device | Not applicable | X.509 certificate |

---

## 4. Authorization Architecture

### 4.1 OPA Policy Example

```rego
# fleetvision/authz/policies/vehicle_access.rego

package fleetvision.authz

import input.path
import input.method
import input.tenant_id
import input.user_roles
import input.resource_owner_tenant

default allow = false

# Allow read access if user has vehicle:read permission and same tenant
allow {
    method == "GET"
    has_permission("vehicle:read")
    tenant_isolation_check
}

# Allow write access if user has vehicle:write and same tenant + org
allow {
    method in ["POST", "PUT", "PATCH", "DELETE"]
    has_permission("vehicle:write")
    tenant_isolation_check
    organization_access_check
}

has_permission(perm) {
    perm in input.user_permissions
}

# Critical: never allow cross-tenant access
tenant_isolation_check {
    tenant_id == input.resource_tenant_id
}

# Users can only modify resources in their own organization hierarchy
organization_access_check {
    input.user_organization_id in input.resource_organization_ancestors
}
```

### 4.2 RBAC Matrix

| Role | Vehicles | Drivers | Trips | Maintenance | Fuel | Compliance | Analytics | Billing | Admin |
|---|---|---|---|---|---|---|---|---|---|
| fleet-viewer | R | R | R | R | R | R | R | — | — |
| fleet-operator | RW | R | RW | R | R | R | R | — | — |
| fleet-admin | RW | RW | RW | RW | RW | RW | RW | — | R |
| driver | — | — | R (own) | — | — | R (own) | — | — | — |
| maintenance-tech | R | — | — | RW | — | R | — | — | — |
| compliance-officer | R | R | R | R | R | RW | R | — | — |
| billing-admin | — | — | — | — | R | — | R | RW | — |
| system-admin | RW | RW | RW | RW | RW | RW | RW | RW | RW |
| tenant-admin | RW | RW | RW | RW | RW | RW | RW | RW | RW (scoped) |

R = Read, W = Write, RW = Read + Write, — = No access

---

## 5. Data Encryption

### 5.1 Encryption Matrix

| Data Category | At Rest | In Transit | In Application | Key Management |
|---|---|---|---|---|
| Database storage | AES-256 (PG TDE) | TLS 1.3 | — | AWS KMS / Vault |
| PII fields (SSN, license#) | AES-256 (column encryption) | TLS 1.3 | Decrypted in memory only | Vault (envelope encryption) |
| Backup files | AES-256 | TLS 1.3 | — | AWS KMS |
| Kafka topics | AES-256 (KMS) | TLS 1.3 | — | AWS KMS |
| S3 objects | AES-256 (SSE-S3) | TLS 1.3 | — | AWS KMS |
| Redis cache | AES-256 (in-transit encryption) | TLS 1.3 | — | Config-managed |
| Service mesh (mTLS) | N/A | TLS 1.3 (mTLS) | N/A | SPIFFE/SPIRE auto-rotation |

### 5.2 Key Rotation

| Key Type | Rotation Period | Method |
|---|---|---|
| TLS certificates | 90 days | cert-manager with Let's Encrypt / Vault PKI |
| JWT signing keys | 90 days | Keycloak automatic rotation, JWKS published |
| Database encryption keys | 180 days | Vault auto-rotation (envelope encryption) |
| API encryption keys | 365 days | Manual rotation with 30-day overlap |
| Device certificates | 365 days | Device Mgmt Service automated renewal |

---

## 6. Compliance Requirements

### 6.1 SOC 2 Type II Controls

| Trust Service Criteria | Control | Implementation |
|---|---|---|
| CC6.1 | Logical access security | MFA, RBAC, least privilege, OPA |
| CC6.2 | Data encryption | AES-256 at rest, TLS 1.3 in transit |
| CC7.1 | System monitoring | Prometheus, Grafana, alerting |
| CC7.2 | Incident response | PagerDuty, runbooks, post-mortem |
| CC8.1 | Change management | GitOps (ArgoCD), PR reviews, IaC |
| A1.2 | Data classification | Asset inventory, sensitivity labels |

### 6.2 GDPR Compliance

| Right | Implementation |
|---|---|
| Right to Access | User data export API (`/api/v1/users/me/export`) |
| Right to Erasure | Soft-delete + crypto-shredding; audit log preserved (anonymized) |
| Right to Rectification | User profile update API; correction audit trail |
| Right to Portability | JSON/CSV export of all user data |
| Right to Restrict Processing | Account deactivation (data preserved but not processed) |
| Data Minimization | Only collect necessary fields; PII fields encrypted |
| Data Residency | Multi-region deployment; EU tenants in EU regions |
| Breach Notification | Automated detection + 72-hour notification workflow |

### 6.3 FMCSA ELD Compliance

| Requirement | Implementation |
|---|---|
| Tamper-proof HOS recording | Event sourcing with cryptographic hash chain |
| Automatic recording switches | Telemetry-driven duty status detection |
| Data retention (6 months minimum) | 7-year retention in event store |
| ELD malfunction detection | Device health monitoring → compliance event |
| Transfer to law enforcement | FMCSA-compliant data export format |
| Authentication of record changes | Digital signatures on all HOS modifications |

---

## 7. Vulnerability Management

### 7.1 SDLC Security Requirements

| Phase | Requirement |
|---|---|
| Design | Threat modeling (STRIDE) for all new bounded contexts |
| Development | SAST (SonarQube), dependency scanning (Snyk), pre-commit hooks |
| Build | Container image scanning (Trivy), SBOM generation |
| Test | DAST (OWASP ZAP) on staging, security integration tests |
| Deploy | Image signing (Cosign), admission controllers (OPA Gatekeeper) |
| Runtime | Falco (container threat detection), runtime vulnerability scanning |

### 7.2 Security Scanning Schedule

| Scan Type | Tool | Frequency | Scope |
|---|---|---|---|
| SAST | SonarQube | Every PR | All Java/Kotlin/Go/Python source |
| Dependency Scan | Snyk | Every PR + daily | All package manifests |
| Container Scan | Trivy | Every build | All Docker images |
| DAST | OWASP ZAP | Weekly | Staging environment |
| IaC Scan | Checkov | Every PR | All Terraform/Helm/Kustomize |
| Pen Test | Third-party | Quarterly | Full platform |
| Bug Bounty | HackerOne | Continuous | Public-facing endpoints |

---

## 8. Incident Response

### 8.1 Incident Severity Levels

| Level | Definition | Response Time | Communication |
|---|---|---|---|
| SEV-1 (Critical) | Data breach, full service outage, active attack | 15 minutes | Exec + all teams |
| SEV-2 (High) | Tenant data isolation issue, single service down | 30 minutes | Affected teams + management |
| SEV-3 (Medium) | Performance degradation, non-critical security finding | 4 hours | Engineering team |
| SEV-4 (Low) | Minor bugs, low-risk vulnerabilities | 24 hours | Backlog |

### 8.2 Security Incident Response Workflow

```
Detection → Triage → Containment → Eradication → Recovery → Post-Mortem
    │           │          │              │             │           │
    ▼           ▼          ▼              ▼             ▼           ▼
 Alert from   Assign     Isolate        Identify      Restore    Blameless
 monitoring   severity   affected       root cause    services   review,
 or report    and owner  systems                      with fix   publish
                                                      and verify  findings
```
