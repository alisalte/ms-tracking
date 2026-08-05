# FleetVision — Public API Platform

**Version:** 1.0.0
**Status:** Approved — Foundation-Aligned
**Date:** 2026-08-02
**Owner:** API Platform Lead / Chief Software Architect
**Classification:** Confidential — Platform Design

> **About this document.** This is the **Public API Platform** design — the product- and platform-level view of the *Openness* pillar (per `00_Project_Vision.md`). It defines the **public API program** that turns FleetVision's internal capabilities into a consumable surface for partners, marketplace apps, and enterprise developers: the API Gateway, the three public transports (REST, WebSocket, Webhook), authentication, API Keys, versioning, rate limiting, and the Developer Portal / SDK ecosystem that wraps them.
>
> **Scope boundary — where to look instead.**
> - **Canonical request/response contract, error envelope, headers, and per-event payloads** → `docs/specs/API_Design.md` v2.0.0 (the external-facing contract reference).
> - **Gateway routing table, BFF layer, plugin chain, circuit breakers, MQTT/IoT** → `docs/api-specs/FleetVision-API-Gateway-Architecture.md`.
> - **OpenAPI machine-readable spec** → `docs/api-specs/FleetVision-OpenAPI-v1.yaml`.
> - **OAuth2/OIDC/JWT internals, OPA policies, token lifecycle** → `docs/modules/Authentication.md`.
>
> This document owns the **platform concerns** that sit across those references: how the public surface is structured, how a partner is onboarded, how an API Key flows through the gateway, how the three transports compose, and how the program is governed.

---

## Table of Contents

1. [API Architecture](#1-api-architecture)
2. [Endpoint Structure](#2-endpoint-structure)
3. [REST API](#3-rest-api)
4. [WebSocket API](#4-websocket-api)
5. [Webhook API](#5-webhook-api)
6. [API Gateway](#6-api-gateway)
7. [Authentication](#7-authentication)
8. [API Keys](#8-api-keys)
9. [Versioning](#9-versioning)
10. [Rate Limiting](#10-rate-limiting)
11. [Security Flow](#11-security-flow)
12. [Developer Experience & Governance](#12-developer-experience--governance)
13. [Traceability](#13-traceability)

---

## 1. API Architecture

### 1.1 What "Public API" Means at FleetVision

The public API is the **programmable face** of the platform — the surface a third party uses when FleetVision is not the UI but the *backend of someone else's product*. Three personas consume it:

| Persona | Identity | Typical transport | Typical pattern |
|---|---|---|---|
| **Enterprise developer** (in-tenant) | OAuth2 Authorization Code + PKCE (user) or API Key (service) | REST + WebSocket | Build a custom dashboard, automate operations, integrate an HR/ERP system |
| **Partner / OEM** (B2B server-to-server) | OAuth2 Client Credentials, or API Key | REST + Webhooks | Sync fleet data into their platform; receive events |
| **Marketplace app** (on behalf of a user) | OAuth2 Authorization Code, user-consented scopes | REST + Webhooks | Multi-tenant app installed by many tenants, acting per-user |

> Internal end-users (web/mobile dashboards) also ride the same REST/WS surface, but via the **Web/Mobile BFFs**, not the public/partner BFF. This document focuses on the *programmable* surface.

### 1.2 The Three Public Transports

FleetVision exposes exactly **three public transports**. Everything else (gRPC, Kafka, MQTT, vendor TCP) is internal or device-only and never public.

```mermaid
flowchart LR
    DEV[Partner / Marketplace / Enterprise Dev] --> PORTAL[Developer Portal]
    PORTAL --> KEY[API Key + Client Credentials]
    KEY --> REST[REST API<br/>request/response]
    KEY --> WS[WebSocket API<br/>real-time push]
    KEY --> WH[Webhook API<br/>outbound events]
    REST --> GW[Kong API Gateway]
    WS --> GW
    GW --> SVC[Microservices<br/>via BFF + mesh]
    SVC --> KAFKA[(Kafka domain events)]
    KAFKA --> DISP[Webhook Dispatcher]
    DISP --> WH
```

| Transport | Direction | Encoding | Latency | Primary use |
|---|---|---|---|---|
| **REST / JSON** | request/response | JSON:API | ms | CRUD, commands, queries, async jobs |
| **WebSocket (Socket.IO)** | server push + ack | JSON frames | real-time | live positions, alerts, video signaling |
| **Webhooks** | outbound (push to partner) | CloudEvents v1.0 + JSON | near-real-time | event delivery to partner endpoints |

The three are **composable by design**: a partner typically uses **REST** to manage state, **WebSocket** to drive a live UI, and **Webhooks** to react asynchronously in their own backend. The same domain event (e.g. `tracking.geofence.entered.v1`) surfaces identically across WebSocket and Webhooks (see `docs/specs/API_Design.md` Appendix A), so a consumer never has to learn two event models.

### 1.3 Architectural Principles

| Principle | What it means for the public surface |
|---|---|
| **API-first** | The OpenAPI/AsyncAPI spec is the source of truth. Code, SDKs, portal docs, and contract tests are all *generated* from it. No endpoint ships without a spec. |
| **One edge, one contract** | All public traffic — REST, WS, Webhook delivery — enters through the single Kong edge. One auth model, one rate-limit model, one observability spine. |
| **Resource-oriented & predictable** | Nouns not verbs; consistent plurals; standard HTTP semantics; one error envelope; one pagination model. |
| **Stateless & tenant-isolated** | Tenant is derived from the credential, never trusted from the client. Every request is independently authorizable. |
| **Versioned & backward-compatible** | Additive-only within a major version; breaking changes ship a new major version with a 12-month parallel deprecation window. |
| **Fail closed** | Auth ambiguity → deny. Quota ambiguity → deny. Permission ambiguity → deny. |
| **Observable & idempotent** | Every request carries `X-Request-Id` end-to-end; every write accepts `Idempotency-Key`. |
| **Self-service** | A developer can register an app, get a key, read docs, try an endpoint, and go live — without a support ticket (gated approval only for production + elevated scopes). |

### 1.4 Platform Topology (layered view)

```
┌──────────────────────────────────────────────────────────────────────┐
│  CONSUMER LAYER                                                       │
│   Enterprise Dev · Partner Server · Marketplace App · Official SDK    │
└───────────────────────────────────┬──────────────────────────────────┘
                                     │ HTTPS / WSS
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EDGE  (Cloudflare + AWS WAF — DDoS, bot, geo, TLS 1.3)              │
└───────────────────────────────────┬──────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  KONG API GATEWAY  (the public edge)                                 │
│   ┌────────────┬────────────┬────────────┬────────────┬───────────┐ │
│   │ AuthN      │ AuthZ(OPA) │ Rate Limit │ Transform │ Observ.   │ │
│   │ JWT/APIKey │  policy    │  token-bkt │ tenant-inj│ OTel/log  │ │
│   └────────────┴────────────┴────────────┴────────────┴───────────┘ │
└──────┬──────────────────┬───────────────────────────┬──────────────┘
       │ /api/v1/*        │ /ws/*                      │ (outbound)
       ▼                  ▼                            ▼
  PARTNER BFF       SOCKET.IO SERVER             WEBHOOK DISPATCHER
  (REST facades)    (Redis adapter)              (Kafka consumer)
       │                  │                            │
       └──────────┬───────┴──────────────┬─────────────┘
                  ▼                      ▼
         ISTIO SERVICE MESH   ───►   MICROSERVICES (14 BCs)
                                        │
                                        ▼
                                   KAFKA (domain events)
```

### 1.5 Relationship to the Specification Suite

| Artifact | Format | Repo | Role |
|---|---|---|---|
| Public REST spec | OpenAPI 3.1 | `fleetvision-api/openapi/` | machine-readable contract; SDKs generated from it |
| Async spec (WS + webhooks) | AsyncAPI 3.0 | `fleetvision-events/` | event/frame contract |
| Event payloads | Avro + Schema Registry | `fleetvision-events/` | `BACKWARD_TRANSITIVE` evolution |
| Permissions | derived CSV (from OpenAPI annotations) | derived | must match `02_Domain_Model.md` §6 (drift fails CI) |
| SDKs | generated (OpenAPI Generator + hand-rolled wrappers) | `fleetvision-sdks/{js,python,dotnet,go}` | the *programmable* deliverable |

CI gates (enforced by `docs/governance/FleetVision-Governance-Standards.md`): `spectral` lint, `oasdiff` breaking-change check, `buf` for proto, Schema Registry compatibility, permission-catalog drift check. **A breaking change that isn't a new major version cannot be merged.**

---

## 2. Endpoint Structure

The public surface is organized as **resource domains** aligned to the bounded contexts, exposed under a single versioned root. This section defines the *structure*; full per-resource schemas live in the OpenAPI spec and `docs/specs/API_Design.md`.

### 2.1 URL Model

```
https://api.fleetvision.example/<api-root>/<version>/<domain>/<resource>[/<id>][/<sub-resource>][:<action>]
        └── host (region-pinned: eu.api. / ap.api.) ─┘
                          │        │       │        │           │
                       api-root  major   domain   resource    action
```

| Segment | Rule | Example |
|---|---|---|
| **api-root** | one of `api` (first-party + user-context), `partner` (server-to-server partner BFF) | `/api/v1/...`, `/partner/v1/...` |
| **version** | major only in path (`v1`); minor is additive (no path bump) | `v1` |
| **domain** | matches a bounded context (kebab-case) | `fleet`, `tracking`, `maintenance` |
| **resource** | plural noun, kebab-case | `vehicles`, `geofences`, `work-orders` |
| **id** | UUID v7 (opaque string) | `550e8400-...` |
| **action** | Google AIP `:verb` for non-CRUD; used sparingly | `vehicles/{id}:dispatch` |

### 2.2 Domain Map (public resources)

| Domain (path) | Backing context | Public resources (examples) |
|---|---|---|
| `/auth`, `/iam` | Identity & Access | `users`, `sessions`, `api-keys`, `oauth-clients` |
| `/fleets` | Fleet Management | `fleets`, `vehicles`, `assignments` |
| `/tracking` | Tracking & Monitoring | `positions`, `sessions`, `geofences`, `replay` |
| `/devices` | Telematics & Device Mgmt | `devices`, `provisioning-tokens` |
| `/drivers` | Driver Management | `drivers`, `assignments`, `hos-records` |
| `/trips` | Trip & Route | `trips`, `routes`, `stops` |
| `/maintenance` | Vehicle Maintenance | `work-orders`, `service-items`, `inspection-forms` |
| `/fuel` | Fuel Management | `fuel-entries`, `fuel-cards` |
| `/compliance` | Compliance & Safety | `hos-violations`, `eld-events`, `documents` |
| `/media` | Video Platform | `recordings`, `streams`, `timelines` |
| `/analytics`, `/reports` | Analytics & Reporting | `metrics`, `reports` (async jobs) |
| `/assets` | Asset Lifecycle | `assets`, `lifecycle-events` |
| `/billing` | Billing & Tenant | `subscriptions`, `usage`, `quotas` |
| `/webhooks` | (platform) | `endpoints`, `event-types`, `deliveries` |

> The full route → upstream mapping (including BFF routing and internal gRPC services) is in `docs/api-specs/FleetVision-API-Gateway-Architecture.md` §3.

### 2.3 Method Semantics (uniform across domains)

| Method | Semantics | Idempotent? | Success code |
|---|---|---|---|
| `GET` | read (collection / item) | yes | `200` / `304` |
| `POST` (collection) | create | with `Idempotency-Key` | `201` + `Location` |
| `POST` (`:action`) | custom command | with `Idempotency-Key` | `200` / `202` |
| `PUT` | full replace | yes | `200` |
| `PATCH` | partial update | with `Idempotency-Key` | `200` |
| `DELETE` | soft-delete (where applicable) | yes | `204` |

Async / long-running operations return `202 Accepted` + a `Location` header pointing at a `/jobs/{id}` resource the client polls or receives a webhook for.

### 2.4 Standard Query Vocabulary

Every collection endpoint honors the same query contract (defined in detail in `docs/specs/API_Design.md` §2):

| Concern | Param | Example |
|---|---|---|
| Pagination | `page[size]`, `page[cursor]` | `?page[size]=25&page[cursor]=eyJ0…` |
| Filtering | `filter` (RSQL for complex) | `?filter=status==active,fleetId=in=(a,b)` |
| Sorting | `sort` (leading `-` = desc) | `?sort=-createdAt,vin` |
| Field selection | `fields` | `?fields=vin,status,driver` |
| Expansion | `include` | `?include=driver,fleet` |

Max page size **100** (default 25). Bulk read is an **async export job**, never a giant page.

---

## 3. REST API

REST is the **primary synchronous** surface — the workhorse for CRUD, commands, and queries. (Contract details in `docs/specs/API_Design.md` §2.)

### 3.1 Request Anatomy

```http
GET /api/v1/fleets/f-123/vehicles?filter=status==active&page[size]=25 HTTP/1.1
Host: api.fleetvision.example
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
X-Request-Id: 7f9e2a1c-...
Accept: application/vnd.api+json
Accept-Language: en-US
```

### 3.2 Response Envelope (JSON:API)

Single resource:
```json
{
  "data": {
    "id": "550e8400-...", "type": "vehicle",
    "attributes": { "vin": "1HGCM8…", "status": "ACTIVE" },
    "relationships": { "fleet": { "data": { "type": "fleet", "id": "660e…" } } }
  },
  "meta": { "requestId": "req-…", "version": "1.0" }
}
```

Collection (cursor pagination):
```json
{
  "data": [ { "id": "…", "type": "vehicle", "attributes": { … } } ],
  "meta": { "page": { "size": 25, "cursor": "eyJ0…", "hasMore": true } }
}
```

### 3.3 Cross-Cutting Request Guarantees

| Feature | Mechanism |
|---|---|
| Tracing | `X-Request-Id` (generated if absent; echoed in response) + W3C `traceparent` propagated end-to-end |
| Optimistic concurrency | `ETag` on every GET; `If-Match` on writes → `412` on mismatch |
| Conditional read | `If-None-Match` → `304 Not Modified` |
| Safe retries | `Idempotency-Key` on all writes; `(key, tenant, bodyHash) → response` cached 24h; mismatched body → `409 IDEMPOTENCY_REPLAY` |
| Async ops | `POST` → `202` + `Location: /jobs/{id}`; poll or subscribe via webhook |

### 3.4 Representative Endpoints (illustrative)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/fleets/{fleetId}/vehicles` | list vehicles in fleet |
| `POST` | `/api/v1/vehicles` | register a vehicle |
| `PATCH` | `/api/v1/vehicles/{id}` | update vehicle attributes |
| `POST` | `/api/v1/vehicles/{id}:assign` | assign to fleet/driver |
| `GET` | `/api/v1/tracking/vehicles/{id}/positions` | position history (expensive — rate-limited) |
| `POST` | `/api/v1/tracking/replay` | build a replay session (async job) |
| `POST` | `/api/v1/reports/generate` | generate a report (async job) |
| `POST` | `/api/v1/webhooks/endpoints` | register a webhook endpoint |

> The exhaustive list (paths, parameters, schemas, examples) is the OpenAPI spec at `docs/api-specs/FleetVision-OpenAPI-v1.yaml`. **The spec is authoritative; this document is structural.**

---

## 4. WebSocket API

WebSocket (Socket.IO) is the **real-time** surface for live positions, alerts, and media signaling — what a dashboard or partner UI subscribes to. (Full frame/event contract in `docs/specs/API_Design.md` §3.)

### 4.1 Endpoint & Namespaces

```
wss://api.fleetvision.example/ws/<namespace>
  /tracking        /media      /notifications    /fleet
```

### 4.2 Connection Model

1. Client opens with `auth: { token: "<jwt>" }`.
2. Gateway middleware verifies the JWT (RS256, JWKS), extracts `tenantId` / `userId` / `roles`.
3. On connect, the socket joins `tenant:<tenantId>`; finer-grained rooms (`fleet:<f>`, `vehicle:<v>`) are joined via an explicit `subscribe` event gated by OPA.
4. Access tokens are short-lived (15 min); on expiry the server emits `error: { code: "TOKEN_EXPIRED" }` and the client refreshes + reconnects (5s grace prevents flapping).

### 4.3 Subscription & Rooms (authz scope)

| Event (client→server) | Payload | Authorization |
|---|---|---|
| `subscribe` | `{ room: "fleet:<id>" }` | OPA checks the caller may read that fleet |
| `unsubscribe` | `{ room }` | — |
| `stream.subscribe` | `{ vehicleId, channelId, quality }` (`/media`) | `media.video.live` |
| `playback.open` | `{ recordingId }` (`/media`) | `media.video.read` |
| `acknowledge` | `{ alertId }` (`/notifications`) | per-alert scope |

### 4.4 Server → Client Events (samples)

| Event | When |
|---|---|
| `position.update` | new position (batched ≤ 10/s/client) |
| `geofence.alert` | enter / exit / dwell |
| `alert.raised` | any domain alert (from Alarm Engine) |
| `stream.offer` / `ice.candidate` | WebRTC signaling (`/media`) |
| `recording.status` | recording lifecycle |
| `ai.alert` | video AI detection |
| `quota.warning` | usage approaching limit |
| `error` | transport / subscription error |

### 4.5 Freshness & Back-Pressure

- **Batching**: a client subscribed to a large fleet would be flooded; the server batches to ≤ 10 position updates/sec/client.
- **Server-side clustering**: beyond 2,000 visible markers, the server clusters markers before sending.
- **Slow consumers**: adapter drops oldest past a watermark → client sees `state: degraded`, never a stall.
- **Reconnection**: exponential backoff + jitter (1s → 30s cap); room subscriptions replayed within a 30s grace window.

### 4.6 WebSocket vs Webhook (when to use which)

| Need | Use |
|---|---|
| Drive a live UI in a browser/app | **WebSocket** |
| React to events in your own backend | **Webhook** |
| Both (UI + backend automation) | **Both** — same events, different transports |

---

## 5. Webhook API

Webhooks are the **outbound event** surface — FleetVision POSTs domain events to a partner's HTTPS endpoint. This is the integration path for B2B partners who don't want to poll REST. (Full payload + retry contract in `docs/specs/API_Design.md` §7.)

### 5.1 Lifecycle

```mermaid
flowchart LR
    REG[Partner registers endpoint<br/>+ secret] --> EVT[Event occurs → Kafka]
    EVT --> DISP[Webhook dispatcher]
    DISP --> SIGN[Sign payload HMAC-SHA256]
    SIGN --> POST[POST CloudEvents to endpoint]
    POST -->|2xx| ACK[ack]
    POST -->|non-2xx / timeout| RETRY[retry 1m..24h]
    RETRY -->|persist fail| DISABLE[disable after N fails → DLQ]
```

### 5.2 Subscription Model

- Subscribe by **event type** or wildcard: `fleet.vehicle.created`, `tracking.geofence.*`, `*.incident.*`.
- One **signing secret** per endpoint (HMAC-SHA256); supports **dual secrets** for zero-downtime rotation (resolves ARR SEC-4).
- Optional per-endpoint **custom headers** (partner's own auth header injected on delivery).

### 5.3 Payload — CloudEvents v1.0

```http
POST https://partner.example/fv HTTP/1.1
Content-Type: application/json
Ce-Specversion: 1.0
Ce-Type: tracking.geofence.entered.v1
Ce-Id: evt-550e8400-…
Ce-Time: 2026-08-02T14:30:00Z
Ce-Tenant: 770e8400-…
X-FleetVision-Signature: t=1690972200,v1=8c4f…
X-FleetVision-Delivery: dlvr-9b3f…

{ "specversion": "1.0", "type": "tracking.geofence.entered.v1",
  "source": "/tracking-service", "id": "evt-550e8400-…",
  "time": "2026-08-02T14:30:00Z",
  "data": { "vehicle_id":"550e…","tenant_id":"770e…","geofence_id":"880e…",
            "geofence_name":"Depot-North",
            "position":{ "latitude":40.71,"longitude":-74.00 } } }
```

### 5.4 Delivery Semantics

| Property | Guarantee |
|---|---|
| Ordering | at-least-once; best-effort per-event-type + `entity_id` partition key |
| Dedup | partner dedups by `Ce-Id` |
| Retries | `1m, 5m, 15m, 1h, 6h, 24h` (6 attempts) → dead-letter + disable |
| Timeout | 10s connect, 30s read; any `2xx` = ack |
| Signature | HMAC-SHA256 over `<timestamp>.<raw_body>`; partners verify constant-time + freshness (±5 min) |

### 5.5 Management Surface

Partners self-manage endpoints via REST:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` / `POST` | `/api/v1/webhooks/endpoints` | list / register |
| `PATCH` / `DELETE` | `/api/v1/webhooks/endpoints/{id}` | update / remove |
| `POST` | `/api/v1/webhooks/endpoints/{id}/test` | send a test event |
| `GET` | `/api/v1/webhooks/endpoints/{id}/deliveries` | delivery history |
| `POST` | `/api/v1/webhooks/endpoints/{id}/replay` | replay a range (gated) |
| `GET` | `/api/v1/webhooks/event-types` | subscribable event catalog |

### 5.6 Event Catalog Alignment

Webhook `Ce-Type` values are the **same** Avro event types flowing through Kafka and surfaced over WebSocket — there is one event model, surfaced three ways. Cross-surface matrix: `docs/specs/API_Design.md` Appendix A.

---

## 6. API Gateway

**Kong Enterprise 3.x** is the single public edge (per `01_Master_Architecture.md` §2, §9 and `docs/api-specs/FleetVision-API-Gateway-Architecture.md`). It terminates TLS, validates credentials, authorizes via OPA, rate-limits, injects tenant context, and routes to the appropriate BFF or service.

### 6.1 Responsibilities (the gateway owns cross-cutting concerns)

| Concern | Gateway behavior |
|---|---|
| **TLS termination** | TLS 1.3 only; HSTS; no plain HTTP (resolves ARR SEC-1) |
| **Authentication** | JWT (RS256, JWKS from Keycloak) *or* API Key (Argon2id-hashed, Redis lookup) |
| **Authorization** | OPA plugin evaluates Rego with `{ subject, action, resource, context }`; default-deny |
| **Tenant injection** | Derives `tenant_id` from the credential → injects `X-Tenant-Id`; **clients MUST NOT set it** (INV-I02 anti-forgery) |
| **Rate limiting** | Token bucket per consumer/tenant/IP/route; Redis-backed counters |
| **Request validation** | Schema check on `POST`/`PUT`/`PATCH` before reaching the service |
| **Correlation** | Generates `X-Request-Id` if absent; propagates W3C `traceparent` |
| **Observability** | Access logs, Prometheus metrics, OpenTelemetry traces |
| **Traffic mgmt** | Circuit breaking per upstream; canary % rollout; back-pressure (`503` + `Retry-After`) |
| **Response transform** | Header injection; legacy-shape shim for older partners (deprecated path) |

### 6.2 Plugin Chain (per route)

```
[1] tls / waf (edge)
[2] cors
[3] authN   ── JWT verify (JWKS) ── or ── API Key lookup (Redis, Argon2id)
[4] tenant-inject   ── derive X-Tenant-Id from credential
[5] authZ   ── OPA policy (default-deny)
[6] rate-limit ── token bucket (Redis)
[7] request-validator ── OpenAPI schema
[8] correlation / tracing ── X-Request-Id + traceparent
[9] proxy   ──→ upstream BFF / service
[10] observability ── log + metrics + trace
```

### 6.3 Routing Summary (public surface)

| Path | Upstream | Auth |
|---|---|---|
| `/api/v1/*` | services via Web / Mobile BFF | JWT (user) |
| `/partner/v1/*` | partner BFF | API Key *or* Client Credentials JWT |
| `/oauth/*` | identity-service (Keycloak) | public (token endpoint) |
| `/ws/*` | Socket.IO server (Redis adapter) | JWT handshake |
| `/api/v1/webhooks/*` | notification/webhook service | JWT + RBAC |

Internal gRPC (`IdentityService`, `QuotaService`, `TenantConfigService`, …) is **mesh-internal only** — never exposed through the public gateway.

### 6.4 Back-Pressure & Resilience

- **Circuit breakers** per upstream (e.g. tracking-service: 50% 5xx in 5s → 15s open, 5 half-open probes).
- **Soft back-pressure**: degraded downstream → `503` + `Retry-After`; SDKs apply exponential backoff.
- **Quota enforcement**: `billing-service` publishes per-tenant limits to Redis; Kong reads dynamically — a plan change takes effect in seconds, no redeploy.

---

## 7. Authentication

Public-API authentication follows `docs/modules/Authentication.md` (authoritative). What an **API consumer** needs to know is summarized here and structured around *who is calling*.

### 7.1 Auth Schemes by Caller

| Caller | Scheme | Token |
|---|---|---|
| End-user (web/mobile SPA) | OAuth2 Authorization Code + **PKCE** (S256) | JWT access (15 min) + refresh (rotated) |
| Partner / 3rd-party server | OAuth2 **Client Credentials**, *or* API Key | JWT *or* opaque key |
| Marketplace app (on behalf of user) | OAuth2 Authorization Code (user-consented scopes) | JWT with consented `scope` |
| Internal service | mTLS (SPIFFE) + service JWT | *not public* |
| IoT device | X.509 mTLS (MQTT/TCP) | *device-only* (`docs/modules/DeviceGateway.md`) |

Disabled per OAuth 2.0 Security BCP: `password` and `implicit` grants.

### 7.2 OAuth2 + OIDC (Keycloak 24)

FleetVision is an OAuth2 Authorization Server and OIDC Provider.

| Grant | Use |
|---|---|
| `authorization_code` + PKCE | SPA, mobile, marketplace — PKCE mandatory for public clients |
| `client_credentials` | machine-to-machine partners |
| `refresh_token` | rotate access tokens (reuse-detected) |

Discovery endpoints:
```
GET /.well-known/openid-configuration
GET /.well-known/jwks.json
```

### 7.3 JWT — Claims & Validation

Access token: **RS256, 15-min TTL**. Claims: `iss`, `sub`, `aud`, `exp`, `iat`, `nbf`, `jti`, `tenant_id`, `tenant_tier`, `scope`, `roles`, `aal`, `session_id`, `auth_time`, `amr`.

Resource-server validation order (any failure → `401`, generic, no oracle):
1. Signature (RS256 via JWKS)
2. `exp` / `nbf` / `iat`
3. `iss`, `aud`
4. Redis revocation check (`revocation:<jti>`, `revocation:user:<sub>`)

### 7.4 Refresh Tokens

Opaque, rotating, reuse-detected (7-day TTL). Each refresh issues a new token and revokes the old; reuse of a consumed token revokes the **entire family**.

### 7.5 Scopes vs Permissions

Two layers, both must pass:

| Layer | Granularity | Set by |
|---|---|---|
| OAuth2 **scope** | coarse, consented surface | user consent / client grant |
| RBAC **permission** | fine-grained action | OPA per-request, canonical catalog (`02_Domain_Model.md` §6) |

> A request satisfies **both**: scope limits *which surfaces* the caller may touch; RBAC limits *which actions* on *which resources*. Default-deny.

### 7.6 Security Practices (edge)

TLS 1.3 everywhere; HSTS. `state` + PKCE mandatory. Strict redirect-URI allowlist. Tokens never in URLs; refresh tokens in HttpOnly cookies (web) / secure storage (mobile). `Cache-Control: no-store` on token responses. `Idempotency-Key` required on writes.

---

## 8. API Keys

API Keys are the **simple, long-lived credential** for partner server-to-server access — the alternative to OAuth2 Client Credentials when a partner just wants "a key." Defined in `docs/modules/Authentication.md` and summarized here.

### 8.1 Format & Lifecycle

- **Format**: `fv_<env>_<random>` (e.g. `fv_live_a1b2c3d4…`, `fv_test_…`); the env prefix prevents test keys in production.
- **Storage**: Argon2id-hashed at rest; the plaintext is **shown once** at creation and never recoverable.
- **Scope**: tenant-scoped, role-bound (inherits a service-account role), rotatable, revocable.
- **Rotation policy**: **90-day rotation default, 365-day absolute max** (resolves ARR SEC-7); the portal warns before expiry.
- **Binding**: bound to one tenant + one environment + a configurable IP allowlist (optional).

### 8.2 Use

```http
GET /partner/v1/vehicles HTTP/1.1
Host: api.fleetvision.example
X-Api-Key: fv_live_a1b2c3d4…
X-Request-Id: 7f9e2a1c-...
```

### 8.3 Gateway Flow (API Key path)

```
1. Kong extracts X-Api-Key.
2. Lookup key hash in Redis (hot cache) → { tenantId, role, scopes, ipAllow, status }.
3. Verify Argon2id hash; verify status=ACTIVE; verify source IP ∈ allowlist.
4. Inject X-Tenant-Id, X-Api-Key-Id, X-Subject (service-account).
5. Proceed to OPA (authZ) → rate-limit → upstream.
```

Failures (unknown key, revoked, IP mismatch) → `401` generic; the response does **not** distinguish "bad key" from "revoked" (no oracle).

### 8.4 Management Surface (self-service)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` / `POST` | `/api/v1/auth/api-keys` | list / create (returns plaintext **once**) |
| `POST` | `/api/v1/auth/api-keys/{id}/rotate` | rotate (new secret, old grace period) |
| `DELETE` | `/api/v1/auth/api-keys/{id}` | revoke |
| `PATCH` | `/api/v1/auth/api-keys/{id}` | rename / update IP allowlist / scopes |

### 8.5 API Key vs OAuth2 — when to use which

| Situation | Use |
|---|---|
| Quick server-to-server integration, partner has no user context | **API Key** |
| Partner needs to act *on behalf of a user* (delegation) | **OAuth2 Authorization Code** |
| Marketplace app, multi-tenant, consented | **OAuth2 Authorization Code (scopes)** |
| Machine-to-machine with short-lived tokens / key rotation by policy | **OAuth2 Client Credentials** |

---

## 9. Versioning

Versioning keeps the public surface **evolvable without breaking consumers**. Strategy and sunset mechanics defined in `docs/specs/API_Design.md` §5; ADR-012 (URI-based versioning with sunset policy) is the governing decision.

### 9.1 Strategy by Surface

| Surface | Strategy | Mechanism | Enforcement |
|---|---|---|---|
| REST | **URI major version** (`/api/v1/`) + additive minor | path segment | `oasdiff` in CI |
| WebSocket | namespace suffix where needed (`/tracking/v2`) | rare | AsyncAPI |
| Webhooks / events | event-type suffix (`.v1`) + Avro | Schema Registry | `BACKWARD_TRANSITIVE` |
| SDKs | semver; major bumps track REST major | package manager | generated |

### 9.2 Compatibility Rules (within a major version)

| Change | Allowed? |
|---|---|
| Add optional field / endpoint / enum value / optional request param | ✅ additive |
| Change field semantics / remove / rename / narrow acceptance / change type / change error status | ❌ breaking |

A breaking change **requires a new major version**, shipped **in parallel** with the old during a **12-month deprecation window**. CI (`oasdiff`, `buf breaking`, Schema Registry) makes an accidental breaking change un-mergeable.

### 9.3 Deprecation & Sunset

```
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sun, 31 May 2027 00:00:00 GMT
Link: </api/v2/vehicles>; rel="successor-version"
```

- `Deprecation` marks the old version deprecated; `Sunset` announces removal (≥ 12 months out).
- Removal announced via email + Developer Portal banner + webhooks (`api.version.deprecated.v1`).
- Both versions run in parallel until sunset.

### 9.4 Stability Tiers

| Tier | Meaning |
|---|---|
| **GA (stable)** | backward-compatible within major; production-ready |
| **Beta** | stable surface, may evolve; small breaking changes with notice |
| **Experimental** | `X-FleetVision-Experimental: true` header; can break anytime |

---

## 10. Rate Limiting

Rate limiting protects the platform and enforces **fair use** per plan. Implemented at Kong (token bucket per consumer) plus per-service Redis counters for fine-grained limits. Detail in `docs/specs/API_Design.md` §6.

### 10.1 Dimensions

| Dimension | Example |
|---|---|
| Per consumer (API key / user) | "1000 req/min for this key" |
| Per tenant | aggregate tenant ceiling |
| Per IP (anonymous / login) | brute-force protection |
| Per route | expensive endpoints (replay, export, history) tighter |
| Per surface | REST vs real-time vs webhook-delivery |

### 10.2 Default Limits by Tier

| Surface | Standard | Professional | Enterprise |
|---|---|---|---|
| REST API (req/min) | 1,000 | 10,000 | custom |
| Real-time subscriptions (concurrent rooms) | 20 | 100 | custom |
| WebSocket connections (concurrent) | 5 | 25 | custom |
| Live video streams (concurrent) | 5 | 50 | 500 |
| Webhook delivery throughput (events/sec) | 50 | 500 | custom |
| Async jobs (concurrent) | 2 | 10 | custom |

### 10.3 Expensive-Endpoint Limits (examples)

| Endpoint | Limit (Professional) | Why |
|---|---|---|
| `GET /tracking/.../history` (long range) | 60/min | Timescale scan |
| `POST /reports/generate` | 10/min | heavy job |
| `GET /media/.../timeline` (7-day) | 30/min | multi-source merge |
| `POST /tracking/replay` | 30/min | replay builder |

### 10.4 Auth-Surface Anti-Abuse

| Surface | Limit | Algorithm |
|---|---|---|
| `POST /auth/login` per IP | 10/min | sliding window |
| `POST /auth/login` per user | 5/min | sliding window |
| `POST /oauth/token` per client | 30/min | token bucket |
| `POST /auth/forgot-password` per email | 3/hour | fixed window |
| `POST /auth/refresh` per user | 30/min | sliding window |

### 10.5 Response Headers & Exhaustion

```
X-RateLimit-Limit:     1000
X-RateLimit-Remaining: 942
X-RateLimit-Reset:     1690972800
```

On exhaustion:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 28
{ "errors":[ { "status":"429","code":"RATE_LIMITED",
   "detail":"Limit 1000/min. Retry in 28s.",
   "meta":{ "limit":1000,"window":"60s","retryAfter":28 } } ] }
```

### 10.6 Strategy & Back-Pressure

- **Token bucket** for REST (allows bursts up to 2× sustained).
- **Sliding window** for auth (precise abuse protection).
- **Quotas** (daily/monthly) tracked in Redis atomic counters by `billing-service`; breach → `402 Payment Required` or `403` with upgrade guidance.
- **Soft back-pressure**: degraded downstream → `503` + `Retry-After`.

---

## 11. Security Flow

This section stitches the previous pieces into the **end-to-end path a request takes** — the security narrative an architect or auditor reads to see how authN, authZ, rate limiting, and tenant isolation compose into a single fail-closed edge.

### 11.1 Request Security Flow (REST, JWT caller)

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (SDK/App)
    participant WAF as Cloudflare + WAF
    participant K as Kong Gateway
    participant R as Redis
    participant O as OPA
    participant S as Upstream Service

    C->>WAF: HTTPS request + Bearer JWT
    WAF->>WAF: TLS 1.3 term · DDoS/bot/geo · WAF rules
    WAF->>K: pass (X-Request-Id set if absent)
    K->>R: JWKS already cached; verify RS256 sig
    K->>K: check exp/nbf/iat, iss, aud
    K->>R: revocation check (jti / user)
    K->>K: derive tenant_id from JWT → inject X-Tenant-Id
    K->>O: {subject, action, resource, context}
    O-->>K: ALLOW / DENY (default-deny)
    K->>R: rate-limit token bucket (consumer+tenant+route)
    K->>K: schema-validate request body
    K->>S: proxy (X-Tenant-Id, X-Subject, traceparent)
    S->>S: re-assert tenant scope (defense-in-depth)
    S-->>K: response + ETag + rate-limit headers
    K-->>C: response (echo X-Request-Id)
```

### 11.2 Request Security Flow (API Key caller)

```mermaid
sequenceDiagram
    autonumber
    participant C as Partner Server
    participant K as Kong Gateway
    participant R as Redis
    participant O as OPA
    participant S as Upstream Service

    C->>K: HTTPS + X-Api-Key
    K->>R: lookup key hash → {tenant, role, scopes, ipAllow, status}
    K->>K: Argon2id verify · status=ACTIVE · IP ∈ allowlist
    K->>K: inject X-Tenant-Id, X-Subject (service-account)
    K->>O: authZ (default-deny)
    K->>R: rate-limit (per-key + per-tenant)
    K->>S: proxy
    S-->>K: response
    K-->>C: response
```

> Any failure (bad signature, revoked token, OPA deny, IP mismatch, quota ambiguity) → **deny** with a generic `401`/`403`. The error never reveals *which* check failed.

### 11.3 WebSocket Security Flow

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant K as Kong
    participant WS as Socket.IO Server
    participant R as Redis
    participant O as OPA

    C->>K: wss + auth:{token} (handshake)
    K->>WS: upgrade (JWT verified at edge)
    WS->>R: JWKS verify · revocation check
    WS->>WS: join tenant:<tenantId>
    C->>WS: emit subscribe {room: fleet:<f>}
    WS->>O: may caller read fleet <f>?
    O-->>WS: ALLOW
    WS->>C: ack {ok:true}
    Note over WS,C: token expires (15 min) → error TOKEN_EXPIRED → refresh + reconnect (5s grace)
```

### 11.4 Webhook Security Flow (outbound)

```mermaid
sequenceDiagram
    autonumber
    participant EV as Domain Event (Kafka)
    participant D as Webhook Dispatcher
    participant P as Partner Endpoint

    EV->>D: event matches subscription
    D->>D: build CloudEvents payload
    D->>D: sign HMAC-SHA256 over <ts>.<body>
    D->>P: POST + X-FleetVision-Signature (t=,v1=)
    P->>P: constant-time verify + freshness (±5 min)
    P-->>D: 2xx (ack)  ──or──  non-2xx/timeout → retry schedule
    Note over D: retries 1m,5m,15m,1h,6h,24h → dead-letter + disable
```

### 11.5 Security Properties Enforced

| Property | How |
|---|---|
| **Confidentiality / integrity in transit** | TLS 1.3 everywhere; HSTS; no plain HTTP |
| **Strong authN** | RS256 JWT (short TTL) or Argon2id API key; mTLS internal |
| **Per-request authZ** | OPA, default-deny, canonical permission catalog |
| **Tenant isolation** | `tenant_id` derived from credential, never client-supplied; RLS + schema isolation in DB (`03_Database_Architecture.md`) |
| **Anti-abuse** | layered rate limits (consumer/tenant/IP/route) + auth-surface sliding windows |
| **Replay protection** | JWT `jti` + revocation; webhook HMAC timestamp (±5 min) |
| **Safe retries** | `Idempotency-Key` on all writes |
| **No information leakage** | 404 (not 403) for unauthorized resources; generic `401` (no oracle); `5xx` never discloses internals |
| **Auditability** | every request → access log + audit event (Kafka) (`docs/modules/Audit-Compliance-Log.md`) |

---

## 12. Developer Experience & Governance

The public API is a **product**. A great contract that nobody can use fails the *Openness* pillar. The program is wrapped by the Developer Portal, SDKs, and a governance process.

### 12.1 Developer Portal

- **Swagger/Stoplight**-based, generated from the OpenAPI spec.
- Interactive **Try-It** playground (against sandbox tenant, real API key).
- Webhook event catalog + signature-verification examples (copy-paste in JS/Python/.NET/Go).
- Version switcher (GA / Beta / Experimental) with deprecation banners.
- Self-service: register an app, create/rotate API keys, register webhook endpoints, view delivery history & quotas.

### 12.2 SDKs

Official SDKs wrap the REST + WebSocket clients and abstract auth/refresh, retries, pagination, and signature verification:

| SDK | Repo | Wraps |
|---|---|---|
| JavaScript / TypeScript | `fleetvision-sdks/js` | REST + Socket.IO client |
| Python | `fleetvision-sdks/python` | REST + WS |
| .NET | `fleetvision-sdks/dotnet` | REST + WS (wraps Socket.IO; **no SignalR** per ADR-015, resolves ARR ARCH-3) |
| Go | `fleetvision-sdks/go` | REST |

SDKs are **generated** from OpenAPI (OpenAPI Generator) plus a hand-maintained auth/refresh wrapper layer, so they never drift from the contract.

### 12.3 Environments

| Environment | Base host | Key prefix | Purpose |
|---|---|---|---|
| Sandbox | `sandbox.api.fleetvision.example` | `fv_test_` | free, isolated, mock-data; for dev & Try-It |
| Production | `api.fleetvision.example` (region-pinned) | `fv_live_` | gated approval before first live key |

### 12.4 Governance (ARB)

Per `docs/governance/FleetVision-Governance-Standards.md`:

- **No endpoint ships without an OpenAPI spec.** CI fails otherwise.
- **No breaking change without a new major version** + 12-month deprecation window. `oasdiff` enforces.
- **Permission catalog drift** (OpenAPI annotations vs `02_Domain_Model.md` §6) fails the build.
- New public surfaces pass **ARB review** (security, versioning, naming, stability tier).
- Stability-tier promotion (Experimental → Beta → GA) is an explicit ARB decision with a documented contract freeze.

### 12.5 Onboarding Journey (partner / marketplace)

```
1. Sign up on Developer Portal → sandbox tenant + fv_test_ key (instant)
2. Read docs · Try-It · build integration against sandbox
3. (Marketplace) Register app → define requested OAuth scopes → ARB review
4. Apply for production access → ARB/Security review → fv_live_ key (gated)
5. Configure webhooks · verify signature · subscribe to event types
6. Go live · monitor quota/usage in portal · rotate keys per policy
```

---

## 13. Traceability

| Foundation element | This document |
|---|---|
| `00` *Openness* pillar (integrations, API, marketplace, SDK) | §1, §5, §12 |
| `00` *Trust* pillar (auth, rate limit, isolation) | §7, §8, §10, §11 |
| `01` §2 Kong edge + Socket.IO | §1.4, §6, §4 |
| `01` §5 communication patterns | §3, §4, §5 |
| `01` §6 event architecture (CloudEvents, ADR-016) | §5, §5.6 |
| `01` §9 security (TLS, JWT, OPA) | §7, §11 |
| `02` §5 domain events | §5.6 |
| `02` §6 permission catalog (canonical) | §7.5, §11.5 |
| `03` multi-tenancy / RLS | §11.5 |
| ADR-009 (Keycloak + OPA) | §7, §11 |
| ADR-012 (URI versioning + sunset) | §9 |
| ADR-015 (Socket.IO canonical — no SignalR) | §4, §12.2 |
| ADR-016 (event naming) | §5.6 |
| ARR API-1, ARCH-3, SEC-1, SEC-4, SEC-7 | resolved, referenced where applied |
| Companion docs | `docs/specs/API_Design.md` (contract) · `docs/api-specs/FleetVision-API-Gateway-Architecture.md` (gateway) · `docs/api-specs/FleetVision-OpenAPI-v1.yaml` (spec) · `docs/modules/Authentication.md` (auth) |

---

*This document defines the **Public API Platform** — how FleetVision's capabilities are exposed as a governed, versioned, self-service surface across REST, WebSocket, and Webhooks. It is structural and platform-facing; the canonical request/response contract lives in `docs/specs/API_Design.md`, and the machine-readable source of truth is the OpenAPI/AsyncAPI specs. Reviewed by the ARB; the public surface evolves additively within each major version.*
