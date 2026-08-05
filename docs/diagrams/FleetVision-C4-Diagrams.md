# FleetVision C4 Architecture Diagrams

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect  

---

## 1. C4 Level 1 — System Context

```
                                    ┌──────────────────────┐
                                    │                      │
                                    │  Fleet Operations    │
                                    │  Manager             │
                                    │  (Web Dashboard)     │
                                    │                      │
                                    └──────────┬───────────┘
                                               │ HTTPS
                                               │
┌──────────────────┐         ┌─────────────────┼───────────────────┐
│                  │         │                 ▼                   │
│  Telematics      │ MQTT    │  ┌──────────────────────────┐    │
│  Devices         │◄────────┤  │                            │    │
│  (GPS/OBD-II)    │         │  │     FleetVision            │    │
│                  │         │  │     Enterprise Fleet       │    │  ┌──────────────────┐
└──────────────────┘         │  │     Management Platform    │───┤  │ ERP Systems      │
                              │  │                            │    │  │ (SAP, Oracle)     │
┌──────────────────┐         │  │                            │    │  └──────────────────┘
│                  │ REST    │  │  - Real-time GPS tracking  │    │
│  Fuel Card       │◄────────┤  │  - Predictive maintenance  │    │
│  Providers       │         │  │  - Driver management       │    │
│  (Wex, Comdata)  │         │  │  - Fleet analytics         │    │  ┌──────────────────┐
│                  │         │  │  - Compliance (ELD/HOS)    │    │  │ Regulatory Bodies│
└──────────────────┘         │  │  - Fuel management         │    │  │ (FMCSA, DOT)     │
                              │  │  - Multi-tenant billing   │    │  └──────────────────┘
┌──────────────────┐         │  │                            │    │
│                  │ OIDC/   │  └──────────────────────────┘    │  ┌──────────────────┐
│  Corporate SSO   │ SAML2   │                                 │  │ Insurance         │
│  (Azure AD,      │────────►│                                 │  │ Platforms         │
│   Okta)          │         │                                 ├──►│                  │
│                  │         │                                 │  └──────────────────┘
└──────────────────┘         │                                 │
                              │                                 │  ┌──────────────────┐
┌──────────────────┐         │                                 │  │ HR Systems        │
│  Fleet Drivers   │         │                                 │  │ (Workday, ADP)    │
│  (Mobile App)    │────────►│                                 ├──►│                  │
│                  │         │                                 │  └──────────────────┘
└──────────────────┘         │                                 │
                              │                                 │  ┌──────────────────┐
┌──────────────────┐         │                                 │  │ Mapping Services  │
│  3rd-Party       │         │                                 │  │ (Google Maps,     │
│  Integrators     │────────►│                                 │  │  Mapbox)          │
│                  │         │                                 ├──►│                  │
└──────────────────┘         │                                 │  └──────────────────┘
                              │                                 │
                              └─────────────────────────────────┘
                                               │
                                               ▼
                              ┌──────────────────────────────────┐
                              │        Cloud Infrastructure       │
                              │  (AWS/Azure/GCP)                  │
                              │  - Kubernetes (EKS/AKS/GKE)       │
                              │  - Managed Databases              │
                              │  - Message Broker (Kafka)         │
                              │  - Object Storage (S3)            │
                              └──────────────────────────────────┘
```

---

## 2. C4 Level 2 — Container Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               FLEETVISION PLATFORM                              │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  WEB & MOBILE CLIENTS                                                      │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐  │ │
│  │  │ Web Dashboard        │  │ iOS/Android App      │  │ Admin Portal     │  │ │
│  │  │ (React 18 + TS)      │  │ (React Native)       │  │ (React + TS)    │  │ │
│  │  └──────────┬──────────┘  └──────────┬──────────┘  └────────┬─────────┘  │ │
│  └─────────────┼─────────────────────────┼──────────────────────┼───────────┘ │
│                │                         │                      │             │
│                │ HTTPS                   │ HTTPS                │ HTTPS       │
│                │                         │ WSS (live tracking)  │             │
│                ▼                         ▼                      ▼             │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  API GATEWAY LAYER                                                         │ │
│  │                                                                            │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐│ │
│  │  │ Cloudflare CDN/WAF  │  │ Kong API Gateway    │  │ Socket.IO Server ││ │
│  │  │                     │  │                     │  │ (WebSocket)      ││ │
│  │  │ • DDoS protection   │  │ • JWT validation    │  │ • Live positions ││ │
│  │  │ • Bot management    │  │ • Rate limiting     │  │ • Alert push     ││ │
│  │  │ • TLS termination   │  │ • OPA authorization │  │ • Dashboard      ││ │
│  │  │ • Geo-IP filtering   │  │ • Request routing   │  │                  ││ │
│  │  │ • Static caching    │  │ • Circuit breaking  │  │ Redis Adapter    ││ │
│  │  └─────────────────────┘  └──────────┬──────────┘  └──────────────────┘│ │
│  │                                    │                                     │ │
│  │  ┌─────────────────────────────────┘                                     │ │
│  │  │                                                                      │ │
│  │  │  ┌─────────────────────┐  ┌─────────────────────┐                    │ │
│  │  │  │ MQTT Gateway (EMQX) │  │ Backend-for-Frontend│                    │ │
│  │  │  │                     │  │ (BFF) Layer         │                    │ │
│  │  │  │ • MQTT v5.0         │  │ • Web BFF           │                    │ │
│  │  │  │ • X.509 auth        │  │ • Mobile BFF        │                    │ │
│  │  │  │ • Kafka bridge      │  │ • Partner BFF       │                    │ │
│  │  │  └─────────────────────┘  └─────────────────────┘                    │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                       │
│                                       │ gRPC / REST                            │
│                                       ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  SERVICE MESH (Istio)                                                      │ │
│  │  • mTLS between all pods                                                    │ │
│  │  • AuthorizationPolicy (service-to-service ACL)                             │ │
│  │  • Traffic management (canary, circuit breaker)                             │ │
│  │  • OpenTelemetry sidecar (traces, metrics)                                 │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                       │
│                                       ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  CORE SERVICES (fleet-core namespace)                                      │ │
│  │                                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │ │
│  │  │ identity-service │  │ fleet-mgmt-      │  │ tracking-service  │        │ │
│  │  │                  │  │ service           │  │                  │        │ │
│  │  │ • User auth       │  │ • Vehicle CRUD    │  │ • Position proc. │        │ │
│  │  │ • Role mgmt       │  │ • Fleet CRUD     │  │ • Geofence eval  │        │ │
│  │  │ • Org hierarchy   │  │ • Group mgmt     │  │ • Speed events   │        │ │
│  │  │ • SSO federation  │  │ • Policy mgmt    │  │ • Trip tracking  │        │ │
│  │  │ • Keycloak realm  │  │ • Assignment     │  │ • Live map data  │        │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘        │ │
│  │                                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │ │
│  │  │ driver-mgmt-     │  │ trip-mgmt-       │  │ maintenance-     │        │ │
│  │  │ service           │  │ service           │  │ service           │        │ │
│  │  │ • Driver profiles │  │ • Trip planning  │  │ • Work orders    │        │ │
│  │  │ • License track   │  │ • Route optim.   │  │ • Maint. plans   │        │ │
│  │  │ • Behavior score  │  │ • Dispatch       │  │ • Parts inventory│        │ │
│  │  │ • Fatigue mgmt    │  │ • POD mgmt       │  │ • Vendor mgmt    │        │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘        │ │
│  │                                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │ │
│  │  │ compliance-      │  │ fuel-mgmt-        │  │ asset-lifecycle- │        │ │
│  │  │ service           │  │ service           │  │ service           │        │ │
│  │  │ • ELD / HOS       │  │ • Fuel cards      │  │ • Procurement    │        │ │
│  │  │ • DVIR            │  │ • Transactions    │  │ • Depreciation   │        │ │
│  │  │ • Incidents       │  │ • Fraud detection │  │ • Disposal       │        │ │
│  │  │ • Safety scoring  │  │ • Station mgmt    │  │ • TCO            │        │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘        │ │
│  │                                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐                              │ │
│  │  │ billing-service  │  │ notification-     │                              │ │
│  │  │                  │  │ service            │                              │ │
│  │  │ • Tenant mgmt     │  │ • Multi-channel   │                              │ │
│  │  │ • Subscription    │  │ • Alert rules     │                              │ │
│  │  │ • Invoicing       │  │ • Escalation      │                              │ │
│  │  │ • Usage metering  │  │ • Preferences     │                              │ │
│  │  │ • Feature flags   │  │                   │                              │ │
│  │  └──────────────────┘  └──────────────────┘                              │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  DATA SERVICES (fleet-data namespace)                                      │ │
│  │                                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐        │ │
│  │  │ telemetry-       │  │ analytics-       │  │ report-gen-      │        │ │
│  │  │ ingestion-service│  │ engine           │  │ service           │        │ │
│  │  │                  │  │                  │  │                  │        │ │
│  │  │ • GPS position    │  │ • Stream agg.    │  │ • PDF/Excel gen  │        │ │
│  │  │   processing     │  │ • ML inference   │  │ • Scheduled      │        │ │
│  │  │ • Sensor data    │  │ • KPI compute    │  │   reports        │        │ │
│  │  │ • Device health  │  │ • Anomaly detect  │  │ • Custom reports │        │ │
│  │  │ • MQTT → Kafka   │  │ • Dashboards     │  │ • Email reports  │        │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘        │ │
│  │                                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐                              │ │
│  │  │ device-mgmt-     │  │ audit-log-       │                              │ │
│  │  │ service           │  │ service           │                              │ │
│  │  │ • Device CRUD    │  │                   │                              │ │
│  │  │ • OTA firmware   │  │ • Immutable log  │                              │ │
│  │  │ • Commands       │  │ • Compliance     │                              │ │
│  │  │ • Pairing        │  │ • Retention      │                              │ │
│  │  └──────────────────┘  └──────────────────┘                              │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  EVENT BACKBONE                                                            │ │
│  │                                                                            │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐   │ │
│  │  │  Apache Kafka Cluster (Confluent Platform)                        │   │ │
│  │  │                                                                    │   │ │
│  │  │  Topics:                                                           │   │ │
│  │  │  fleet.vehicle.*  |  tracking.*  |  telemetry.*  |  trip.*         │   │ │
│  │  │  compliance.*     |  maintenance.* |  fuel.*      |  driver.*       │   │ │
│  │  │  billing.*        |  audit.*       |  notification.*              │   │ │
│  │  │                                                                    │   │ │
│  │  │  Schema Registry (Avro)  |  Kafka Connect  |  ksqlDB             │   │ │
│  │  └──────────────────────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  DATA STORES                                                               │ │
│  │                                                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │ │
│  │  │PostgreSQL│  │Timescale │  │ MongoDB  │  │ Redis    │  │ClickHouse│    │ │
│  │  │ 16       │  │ DB       │  │ 7        │  │ 7        │  │          │    │ │
│  │  │          │  │          │  │          │  │          │  │          │    │ │
│  │  │ OLTP     │  │ Time-    │  │ Docs     │  │ Cache    │  │ OLAP     │    │ │
│  │  │ Event    │  │ Series   │  │ Event    │  │ Sessions │  │ Analytics│    │ │
│  │  │ Store    │  │ GPS      │  │ Sourced  │  │ Rate     │  │ Reports  │    │ │
│  │  │ PostGIS  │  │ Sensor   │  │ Inspect. │  │ Limit    │  │ KPIs     │    │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │ │
│  │                                                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                              │ │
│  │  │Elastic-  │  │ S3/MinIO │  │ Kafka    │                              │ │
│  │  │ search   │  │          │  │ Event    │                              │ │
│  │  │ 8        │  │ Objects  │  │ Archive  │                              │ │
│  │  │          │  │ Firmware │  │ (7-day   │                              │ │
│  │  │ Search   │  │ Documents│  │  buffer) │                              │ │
│  │  │ Logs     │  │ Backups │  │          │                              │ │
│  │  └──────────┘  └──────────┘  └──────────┘                              │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  PLATFORM INFRASTRUCTURE                                                   │ │
│  │                                                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │  │ Keycloak │  │ HashiCorp│  │ Prom +   │  │ ArgoCD   │              │ │
│  │  │ 24       │  │ Vault    │  │ Grafana  │  │ + Rollouts│              │ │
│  │  │          │  │          │  │ + Loki   │  │          │              │ │
│  │  │ IAM      │  │ Secrets  │  │ Jaeger   │  │ GitOps   │              │ │
│  │  │ SSO      │  │ Keys     │  │ OTel     │  │ Deploy   │              │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. C4 Level 3 — Component Diagram (Tracking Service)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      tracking-service                                    │
│                                                                          │
│  ┌── INTERFACES ──────────────────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │ │
│  │  │ VehicleController│  │ TrackingWS       │  │ Geofence         │ │ │
│  │  │ (REST)           │  │ Handler          │  │ Controller        │ │ │
│  │  │                  │  │ (WebSocket)      │  │ (REST)            │ │ │
│  │  │ GET /positions   │  │ Socket.IO       │  │ CRUD /geofences   │ │ │
│  │  │ GET /history     │  │ rooms: fleet:*   │  │ POST /evaluate    │ │ │
│  │  │ GET /speed-events│  │ events:          │  │                   │ │ │
│  │  │                  │  │  position:update │  │                   │ │ │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │ │
│  └───────────┼──────────────────────┼──────────────────────┼───────────┘ │
│              │                      │                      │             │
│  ┌── APPLICATION ──────────────────┼──────────────────────┼───────────┐ │
│  │              │                      │                      │             │ │
│  │  ┌───────────▼──────────┐  ┌──────▼──────────────┐  ┌──▼──────────┐ │ │
│  │  │ GetVehicleHistory   │  │ TrackPosition       │  │ Manage      │ │ │
│  │  │ UseCase              │  │ UseCase             │  │ Geofence    │ │ │
│  │  │                      │  │                     │  │ UseCase     │ │ │
│  │  │ Reads from CQRS     │  │ Validates + saves   │  │ CRUD + eval │ │ │
│  │  │ read model           │  │ position; evaluates │  │ geofences   │ │ │
│  │  │                      │  │ geofences; publishes│  │             │ │ │
│  │  │                      │  │ events              │  │             │ │ │
│  │  └───────────┬──────────┘  └──────┬──────────────┘  └──┬──────────┘ │ │
│  │              │                      │                      │             │ │
│  │  ┌───────────▼──────────────────────▼──────────────────────▼──────┐ │ │
│  │  │              Domain Event Publisher                              │ │ │
│  │  │  Publishes: tracking.position.updated, tracking.geofence.*       │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│              │                      │                      │             │
│  ┌── DOMAIN ──┼──────────────────────┼──────────────────────┼───────────┐ │
│  │              │                      │                      │             │ │
│  │  ┌───────────▼──────────┐  ┌──────▼──────────────┐  ┌──▼──────────┐ │ │
│  │  │ VehicleTracker      │  │ Geofence            │  │ Position    │ │ │
│  │  │ Aggregate           │  │ Aggregate           │  │ ValueObject │ │ │
│  │  │ (Event Sourced)     │  │                     │  │             │ │ │
│  │  │                      │  │ • boundary          │  │ • lat       │ │ │
│  │  │ • vehicleId        │  │ • type (poly/circle)│  │ • lng       │ │ │
│  │  │ • latestPosition   │  │ • rules             │  │ • speed     │ │ │
│  │  │ • trackingStatus    │  │ • active flag       │  │ • heading   │ │ │
│  │  │ • positions[]       │  │                     │  │ • accuracy  │ │ │
│  │  │                      │  │ Events:            │  │ • timestamp │ │ │
│  │  │ Events:             │  │  GeofenceCreated   │  │             │ │ │
│  │  │  PositionReceived  │  │  GeofenceUpdated   │  │ GeoCoordinate│ │ │
│  │  │  TrackingStarted    │  │  GeofenceDeleted   │  │ ValueObject │ │ │
│  │  │  TrackingStopped    │  │                     │  │             │ │ │
│  │  │  VehicleExitedGeo   │  │ Invariants:        │  │ SpeedEvent  │ │ │
│  │  │                     │  │  Boundary valid    │  │ ValueObject │ │ │
│  │  │ Invariants:         │  │  No self-intersect │  │             │ │ │
│  │  │  One active session │  └────────────────────┘  └────────────┘ │ │
│  │  │  Immutable history  │                               Geofence    │ │ │
│  │  └────────────────────┘                               Boundary VO │ │ │
│  │                                                              │   │ │ │
│  │  ┌─────────────────────┐                       ┌───────────┘   │ │ │
│  │  │ GeofenceEvaluation  │                       │ SpeedThreshold │ │ │ │
│  │  │ Domain Service      │                       │ ValueObject    │ │ │ │
│  │  │                     │                       └────────────────┘ │ │ │
│  │  │ • evaluate(position)│                                          │ │ │
│  │  │   → geofence events│  ┌──────────────────────────────────┐ │ │ │
│  │  │ • high-performance  │  │ Repositories (Interfaces)         │ │ │ │
│  │  │   spatial indexing  │  │                                    │ │ │ │
│  │  └─────────────────────┘  │ • VehicleTrackerRepository       │ │ │ │
│  │                            │ • GeofenceRepository             │ │ │ │
│  │                            │ • PositionReadModelRepository    │ │ │ │
│  │                            └──────────────────────────────────┘ │ │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│              │                      │                      │             │
│  ┌── INFRASTRUCTURE ───────────────┼──────────────────────┼───────────┐ │
│  │              │                      │                      │             │ │
│  │  ┌───────────▼──────────┐  ┌──────▼──────────────┐  ┌──▼──────────┐ │ │
│  │  │ TimescaleDB         │  │ PostgreSQL          │  │ Redis       │ │ │
│  │  │ PositionAdapter     │  │ GeofenceAdapter     │  │ Position    │ │ │
│  │  │                     │  │ (PostGIS)           │  │ Cache       │ │ │
│  │  │ • hypertable writes│  │                     │  │ Adapter     │ │ │
│  │  │ • time-range queries│  │ • polygon storage  │  │             │ │ │
│  │  │ • compression      │  │ • spatial index     │  │ • latest    │ │ │
│  │  │                     │  │ • boundary check    │  │   position  │ │ │
│  │  └────────────────────┘  └────────────────────┘  │ • TTL 10s  │ │ │
│  │                                                    └────────────┘ │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐              │ │
│  │  │ Kafka Producer       │  │ Event Store Adapter  │              │ │
│  │  │                     │  │                     │              │ │
│  │  │ • Outbox pattern    │  │ • Position events   │              │ │
│  │  │ • Avro serialization│  │   (event table)     │              │ │
│  │  │ • Schema registry   │  │ • Snapshots         │              │ │
│  │  └─────────────────────┘  └─────────────────────┘              │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. C4 Sequence Diagram — Vehicle Registration

```
  Client      API GW     Identity     FleetMgmt      Outbox      Kafka     AuditLog
    │           │          │            │             │           │          │
    │  POST     │          │            │             │           │          │
    │  /vehicles│          │            │             │           │          │
    │──────────►│          │            │             │           │          │
    │           │          │            │             │           │          │
    │           │ JWT valid│            │             │           │          │
    │           │ OPA check│            │             │           │          │
    │           │──────────►            │             │           │          │
    │           │          │            │             │           │          │
    │           │  roles OK│            │             │           │          │
    │           │◄──────────            │             │           │          │
    │           │          │            │             │           │          │
    │           │  gRPC: validate user │             │           │          │
    │           │──────────►            │             │           │          │
    │           │          │            │             │           │          │
    │           │  user valid          │             │           │          │
    │           │◄──────────            │             │           │          │
    │           │          │            │             │           │          │
    │           │  POST /vehicles       │             │           │          │
    │           │──────────────────────►│             │           │          │
    │           │          │            │             │           │          │
    │           │          │  RegisterVehicleCommand           │          │
    │           │          │            │             │           │          │
    │           │          │            │ Vehicle.register()   │          │
    │           │          │            │ ┌─────────────────┐ │          │
    │           │          │            │ │ 1. Validate VIN │ │          │
    │           │          │            │ │ 2. Check unique │ │          │
    │           │          │            │ │ 3. Create entity│ │          │
    │           │          │            │ │ 4. Generate evt │ │          │
    │           │          │            │ └─────────────────┘ │          │
    │           │          │            │             │           │          │
    │           │          │            │ BEGIN TX               │          │
    │           │          │            │ INSERT vehicle ────────┼─────────►│
    │           │          │            │ INSERT outbox event  ──┼─────────►│
    │           │          │            │ COMMIT TX               │          │
    │           │          │            │             │           │          │
    │           │          │            │  201 Created           │          │
    │           │◄──────────────────────│             │           │          │
    │           │          │            │             │           │          │
    │           │  { vehicle: {...} }  │             │           │          │
    │◄──────────│          │            │             │           │          │
    │           │          │            │             │           │          │
    │           │          │            │             │  Debezium │          │
    │           │          │            │             │  CDC reads│          │
    │           │          │            │             │  outbox   │          │
    │           │          │            │             │──────────►│          │
    │           │          │            │             │           │          │
    │           │          │            │             │  fleet.vehicle.
    │           │          │            │             │  registered.v1
    │           │          │            │             │           │          │
    │           │          │            │             │           │ audit.event
    │           │          │            │             │           │ published
    │           │          │            │             │           │◄─────────│
```

---

## 5. Deployment Topology Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION DEPLOYMENT (us-east-1)                     │
│                                                                          │
│  Internet ──► CloudFlare ──► ALB ──► Kong (5 pods) ──► Istio Ingress   │
│                                                                          │
│  ┌─ platform-infra namespace ──────────────────────────────────────────┐│
│  │ Kong (5 replicas)  Istio Control Plane  Keycloak (3 replicas)     ││
│  │ Vault (3 replicas)  Prometheus (2 replicas)  Grafana (2 replicas)    ││
│  │ ArgoCD (2 replicas)  cert-manager  External Secrets Operator       ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─ gateway namespace ─────────────────────────────────────────────────┐│
│  │ Kong Gateway (5 replicas, m6i.2xlarge)                              ││
│  │ Socket.IO Server (3 replicas, m6i.xlarge)                          ││
│  │ EMQX MQTT Broker (3 replicas, m6i.2xlarge)                          ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─ fleet-core namespace ──────────────────────────────────────────────┐│
│  │ identity-service (2-10 replicas, m6i.xlarge)                         ││
│  │ fleet-management-service (2-10 replicas, m6i.xlarge)                 ││
│  │ tracking-service (3-20 replicas, m6i.2xlarge)                       ││
│  │ driver-management-service (2-8 replicas, m6i.xlarge)                ││
│  │ trip-management-service (2-10 replicas, m6i.xlarge)                 ││
│  │ vehicle-maintenance-service (2-8 replicas, m6i.xlarge)            ││
│  │ compliance-service (2-8 replicas, m6i.xlarge)                       ││
│  │ fuel-management-service (2-8 replicas, m6i.xlarge)                   ││
│  │ asset-lifecycle-service (2-8 replicas, m6i.xlarge)                ││
│  │ billing-service (2-5 replicas, m6i.xlarge)                          ││
│  │ notification-service (2-10 replicas, m6i.large)                   ││
│  │ audit-log-service (2-8 replicas, m6i.xlarge)                        ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─ fleet-data namespace ──────────────────────────────────────────────┐│
│  │ telemetry-ingestion-service (5-50 replicas, m6i.2xlarge, KEDA)      ││
│  │ device-management-service (2-8 replicas, m6i.xlarge)               ││
│  │ analytics-engine (2-15 replicas, m6i.2xlarge, GPU pool)           ││
│  │ report-generation-service (2-10 replicas, m6i.xlarge)               ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─ monitoring namespace ──────────────────────────────────────────────┐│
│  │ Prometheus (2 replicas)  Loki (3 replicas)  Jaeger (3 replicas)     ││
│  │ OTel Collector (5 replicas)  AlertManager (3 replicas)              ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─ External Services (AWS Managed) ─────────────────────────────────┐│
│  │ RDS PostgreSQL 16 (Multi-AZ, r6g.2xlarge)                          ││
│  │ ElastiCache Redis 7 (Cluster Mode, 6 nodes, r6g.xlarge)            ││
│  │ MSK Kafka 3.7 (6 brokers, m6g.2xlarge)                             ││
│  │ OpenSearch 8.x (3 nodes, r6g.2xlarge)                              ││
│  │ S3 (FleetVision data bucket, versioning enabled)                    ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```
