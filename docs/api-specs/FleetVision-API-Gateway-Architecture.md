# FleetVision API Gateway Architecture

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect  

---

## 1. Overview

The API Gateway is the single entry point for all external client traffic to FleetVision. It handles routing, authentication, authorization, rate limiting, request/response transformation, and cross-cutting concerns.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Web App  │  │ iOS App  │  │ Android  │  │ 3rd Party│            │
│  │ (React) │  │          │  │ App      │  │ Partner  │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │              │              │                   │
└───────┼──────────────┼──────────────┼──────────────┼───────────────────┘
        │              │              │              │
        │   HTTPS      │   HTTPS      │   HTTPS      │   HTTPS
        ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CDN / WAF LAYER                                 │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  CloudFlare / AWS CloudFront + AWS WAF                   │      │
│  │  • DDoS protection (L3/L4/L7)                              │      │
│  │  • Bot management                                           │      │
│  │  • Geo-IP filtering                                        │      │
│  │  • TLS termination (TLS 1.3 only)                          │      │
│  │  • Static asset caching                                    │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     API GATEWAY LAYER                                 │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │              Backend-for-Frontend (BFF) Layer             │      │
│  │                                                            │      │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │      │
│  │  │ Web BFF      │  │ Mobile BFF   │  │ Partner BFF  │   │      │
│  │  │ (Kong Route)  │  │ (Kong Route)  │  │ (Kong Route) │   │      │
│  │  │              │  │              │  │              │   │      │
│  │  │ • Session mgmt│  │ • Push notif │  │ • API keys   │   │      │
│  │  │ • CSRF       │  │ • Offline    │  │ • Webhooks   │   │      │
│  │  │ • SSR comp.  │  │ • Auth tok.  │  │ • Rate limit │   │      │
│  │  │ • HTML/JSON  │  │ • JSON/Proto │  │ • SLA track  │   │      │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │      │
│  │         └─────────────────┼─────────────────┘           │      │
│  │                           ▼                              │      │
│  │  ┌───────────────────────────────────────────────────┐   │      │
│  │  │           Kong API Gateway 3.x                    │   │      │
│  │  │                                                    │   │      │
│  │  │  PLUGINS (applied per route/service):              │   │      │
│  │  │                                                    │   │      │
│  │  │  ┌─────────────────────────────────────────────┐   │   │      │
│  │  │  │ 1. AUTHENTICATION                            │   │   │      │
│  │  │  │    • JWT validation (RS256, Keycloak JWKS)  │   │   │      │
│  │  │  │    • API Key authentication (Partner BFF)   │   │   │      │
│  │  │  │    • mTLS certificate auth (IoT devices)     │   │   │      │
│  │  │  ├─────────────────────────────────────────────┤   │   │      │
│  │  │  │ 2. AUTHORIZATION (OPA integration)           │   │   │      │
│  │  │  │    • OPA plugin evaluates rego policies      │   │   │      │
│  │  │  │    • Tenant isolation verification          │   │   │      │
│  │  │  ├─────────────────────────────────────────────┤   │   │      │
│  │  │  │ 3. RATE LIMITING                              │   │   │      │
│  │  │  │    • Per-tenant rate limits (from billing)   │   │   │      │
│  │  │  │    • Per-user rate limits                    │   │   │      │
│  │  │  │    • Per-API-key rate limits                 │   │   │      │
│  │  │  ├─────────────────────────────────────────────┤   │   │      │
│  │  │  │ 4. REQUEST TRANSFORMATION                     │   │   │      │
│  │  │  │    • Header injection (X-Tenant-Id)           │   │   │      │
│  │  │  │    • Request/response body transformation    │   │   │      │
│  │  │  ├─────────────────────────────────────────────┤   │   │      │
│  │  │  │ 5. SECURITY                                   │   │   │      │
│  │  │  │    • CORS configuration                       │   │   │      │
│  │  │  │    • IP restrictions                          │   │   │      │
│  │  │  │    • Request size limiting                   │   │   │      │
│  │  │  ├─────────────────────────────────────────────┤   │   │      │
│  │  │  │ 6. OBSERVABILITY                             │   │   │      │
│  │  │  │    • Access logging (all requests)            │   │   │      │
│  │  │  │    • Prometheus metrics export                │   │   │      │
│  │  │  │    • OpenTelemetry tracing propagation      │   │   │      │
│  │  │  ├─────────────────────────────────────────────┤   │   │      │
│  │  │  │ 7. TRAFFIC MANAGEMENT                         │   │   │      │
│  │  │  │    • Canary deployments (percentage-based)   │   │   │      │
│  │  │  │    • Circuit breaking per upstream           │   │   │      │
│  │  │  │    • Request queuing during upstream degrade │   │   │      │
│  │  │  └─────────────────────────────────────────────┘   │   │      │
│  │  └───────────────────────────────────────────────────┘   │      │
│  └───────────────────────────────────────────────────────────┘      │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │              WEBSOCKET GATEWAY                               │      │
│  │  Socket.IO Server (clustered via Redis adapter)             │      │
│  │  • Live GPS position streaming                              │      │
│  │  • Alert push notifications                                  │      │
│  │  • Real-time dashboard updates                              │      │
│  │  • Authentication: JWT handshake                            │      │
│  │  • Room-based subscriptions (per fleet, per vehicle)        │      │
│  └───────────────────────────────────────────────────────────┘      │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │              MQTT GATEWAY (IoT)                              │      │
│  │  EMQX / AWS IoT Core                                        │      │
│  │  • MQTT v5.0 protocol                                       │      │
│  │  • Device authentication (X.509 certificates)                │      │
│  │  • Topic: fleetvision/{tenant_id}/{device_id}/telemetry     │      │
│  │  • Bridge to Kafka (MQTT → Kafka bridge)                    │      │
│  │  • QoS 1 (at-least-once) for telemetry                      │      │
│  │  • QoS 2 (exactly-once) for commands                        │      │
│  └───────────────────────────────────────────────────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SERVICE MESH (Istio)                               │
│                    mTLS + Authorization                              │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MICROSERVICE LAYER                                │
│  (identity, fleet-mgmt, tracking, telemetry, maintenance, ...)      │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Routing Configuration

### 3.1 Route Table

| Route Pattern | Upstream Service | Protocol | Auth Method |
|---|---|---|---|
| `/api/v1/auth/**` | identity-service | REST | Public (login/register) |
| `/api/v1/users/**` | identity-service | REST | JWT |
| `/api/v1/organizations/**` | identity-service | REST | JWT + RBAC |
| `/api/v1/fleets/**` | fleet-management-service | REST | JWT + RBAC |
| `/api/v1/vehicles/**` | fleet-management-service | REST | JWT + RBAC |
| `/api/v1/tracking/**` | tracking-service | REST + WS | JWT |
| `/api/v1/trips/**` | trip-management-service | REST | JWT + RBAC |
| `/api/v1/drivers/**` | driver-management-service | REST | JWT + RBAC |
| `/api/v1/maintenance/**` | vehicle-maintenance-service | REST | JWT + RBAC |
| `/api/v1/compliance/**` | compliance-service | REST | JWT + RBAC |
| `/api/v1/fuel/**` | fuel-management-service | REST | JWT + RBAC |
| `/api/v1/analytics/**` | analytics-engine | REST | JWT |
| `/api/v1/billing/**` | billing-service | REST | JWT + RBAC |
| `/api/v1/reports/**` | report-generation-service | REST | JWT |
| `/api/v1/notifications/**` | notification-service | REST | JWT |
| `/api/v1/devices/**` | device-management-service | REST | JWT + RBAC |
| `/api/v1/assets/**` | asset-lifecycle-service | REST | JWT + RBAC |
| `/api/v1/audit/**` | audit-log-service | REST | JWT + Admin |
| `/ws/tracking` | tracking-service | WebSocket | JWT handshake |
| `/ws/alerts` | notification-service | WebSocket | JWT handshake |
| `/partner/v1/**` | partner-bff | REST | API Key |
| `/mqtt` | emqx | MQTT | X.509 |

### 3.2 Internal gRPC Services (not exposed via API Gateway)

| Service | Port | Consumer Services |
|---|---|---|
| `IdentityService.proto` | 9090 | All services (user validation, role lookup) |
| `FleetMembershipService.proto` | 9091 | Tracking, Trip, Compliance |
| `DriverEligibilityService.proto` | 9092 | Trip Management |
| `QuotaService.proto` | 9093 | API Gateway, all services |
| `TenantConfigService.proto` | 9094 | All services |

## 4. Rate Limiting Strategy

### 4.1 Rate Limit Tiers

| Client Type | Rate Limit | Burst | Scope |
|---|---|---|---|
| Web Dashboard | 100 req/s | 150 | Per user |
| Mobile App | 50 req/s | 75 | Per user |
| Partner API | 200 req/s | 300 | Per API key |
| IoT Device | 10 msg/s | 20 | Per device |
| Internal Service | 1000 req/s | 1500 | Per service |

### 4.2 Rate Limit Implementation

- **Algorithm:** Token Bucket (Kong rate-limiting plugin)
- **Storage:** Redis cluster (shared across Kong instances)
- **Per-tenant override:** Billing service publishes rate limit config to Redis; Kong reads dynamically
- **Response headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Throttle response:** `429 Too Many Requests` with `Retry-After` header

## 5. Request Lifecycle

```
Client Request
    │
    ▼
[1] TLS Termination (WAF/CDN)
    │
    ▼
[2] Kong API Gateway
    │  • Route matching
    │  • Authentication (JWT validation / API Key / mTLS)
    │  • Extract tenant_id from JWT → inject X-Tenant-Id header
    │  • Extract user_id from JWT → inject X-User-Id header
    │  • Authorization (OPA policy check)
    │  • Rate limiting (token bucket check)
    │  • Request validation (schema check for POST/PUT)
    │  • Correlation ID generation (X-Correlation-Id)
    │
    ▼
[3] Istio Ingress Gateway
    │  • mTLS termination (if needed)
    │  • Istio AuthorizationPolicy check
    │
    ▼
[4] Microservice
    │  • Tenant context extraction
    │  • Business logic execution
    │  • Domain event publication (Kafka)
    │  • Audit event publication (Kafka)
    │
    ▼
[5] Response
    │  • Response transformation (if configured)
    │  • Access log written
    │  • Metrics exported
    │
    ▼
Client Response
```

## 6. Circuit Breaker Configuration

| Upstream Service | Threshold (5xx errors) | Break Duration | Half-Open Probes |
|---|---|---|---|
| identity-service | 50% in 10s | 30s | 3 requests |
| fleet-management-service | 50% in 10s | 30s | 3 requests |
| tracking-service | 50% in 5s | 15s | 5 requests |
| analytics-engine | 50% in 10s | 30s | 3 requests |
| notification-service | 50% in 10s | 60s | 3 requests |
| All other services | 50% in 10s | 30s | 3 requests |

## 7. API Response Standards

### 7.1 Success Response (Collection)

```json
{
  "data": [
    { "id": "uuid", "type": "vehicle", "attributes": { }, "relationships": { } }
  ],
  "meta": {
    "total": 150,
    "page": { "number": 1, "size": 20 },
    "tenant_id": "uuid"
  },
  "links": {
    "self": "/api/v1/vehicles?page=1&size=20",
    "next": "/api/v1/vehicles?page=2&size=20",
    "last": "/api/v1/vehicles?page=8&size=20"
  }
}
```

### 7.2 Success Response (Single Resource)

```json
{
  "data": {
    "id": "uuid",
    "type": "vehicle",
    "attributes": {
      "vin": "1HGCM82633A004352",
      "make": "Honda",
      "model": "Accord",
      "year": 2023,
      "status": "active",
      "license_plate": { "number": "ABC-1234", "state": "CA" }
    },
    "relationships": {
      "fleet": { "data": { "id": "uuid", "type": "fleet" } },
      "telematics_device": { "data": { "id": "uuid", "type": "device" } }
    },
    "links": { "self": "/api/v1/vehicles/uuid" }
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-08-02T14:30:00.000Z",
    "tenant_id": "uuid"
  }
}
```

### 7.3 Error Response

```json
{
  "errors": [
    {
      "code": "FLEET-4001",
      "title": "Vehicle Already Assigned",
      "detail": "Vehicle VIN-ABC123 is already assigned to fleet 'Northeast Region'",
      "status": 409,
      "source": { "pointer": "/data/relationships/fleet/id" },
      "meta": {
        "tenant_id": "uuid",
        "request_id": "uuid",
        "timestamp": "2026-08-02T14:30:00.000Z",
        "documentation_url": "https://docs.fleetvision.io/errors/FLEET-4001"
      }
    }
  ]
}
```

## 8. CORS Configuration

| Property | Web BFF | Partner BFF |
|---|---|---|
| Allowed Origins | `https://app.fleetvision.io`, `https://*.fleetvision.io` | Configured per partner |
| Allowed Methods | GET, POST, PUT, PATCH, DELETE, OPTIONS | GET, POST, PUT, PATCH, DELETE |
| Allowed Headers | Authorization, Content-Type, X-Correlation-Id, X-Request-Id | Authorization, Content-Type, X-API-Key |
| Expose Headers | X-RateLimit-*, X-Correlation-Id, X-Request-Id | X-RateLimit-* |
| Max Age | 7200s | 3600s |
| Credentials | true | false |

## 9. WebSocket Gateway

### 9.1 Protocol

Socket.IO with STOMP over WebSocket:
- Transport: WSS (WebSocket Secure)
- Authentication: JWT in handshake `auth` payload
- Rooms: `fleet:{fleet_id}`, `vehicle:{vehicle_id}`, `driver:{driver_id}`, `alerts:{user_id}`
- Events: `position:update`, `alert:new`, `trip:status_change`, `vehicle:status_change`

### 9.2 Scaling

- Redis adapter for multi-node Socket.IO clustering
- Sticky sessions (not required with Redis adapter)
- Max concurrent connections per node: 50,000
- Horizontal scaling via Kubernetes HPA

## 10. MQTT Gateway (IoT)

### 10.1 Topic Hierarchy

```
fleetvision/{tenant_id}/{device_id}/telemetry     → Device publishes telemetry
fleetvision/{tenant_id}/{device_id}/command/resp   → Device publishes command responses
fleetvision/{tenant_id}/{device_id}/command       → Platform publishes commands to device
fleetvision/{tenant_id}/{device_id}/status       → Device publishes status/heartbeat
```

### 10.2 Security

- X.509 mutual TLS for device authentication
- Device certificates provisioned via Device Management Service
- Topic ACLs enforced per tenant and device
- MQTT → Kafka bridge (EMQX Kafka extension) for all telemetry topics
