# FleetVision Monitoring, Observability & SLI/SLO Framework

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect, SRE Lead  

---

## 1. Observability Strategy

### 1.1 Three Pillars + Continuous Profiling

```
┌──────────────────────────────────────────────────────────────────┐
│                  OBSERVABILITY STACK                               │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  METRICS    │  │  TRACING    │  │  LOGGING    │             │
│  │             │  │             │  │             │             │
│  │ Prometheus  │  │ OpenTele-   │  │ OpenTele-   │             │
│  │ + Thanos    │  │ metry SDK   │  │ metry SDK   │             │
│  │             │  │ + Jaeger    │  │ + Loki      │             │
│  │ Collection: │  │             │  │             │             │
│  │ • System    │  │ Trace:      │  │ Logs:       │             │
│  │ • App       │  │ • Request   │  │ • Structured│             │
│  │ • Business  │  │ • Kafka     │  │ • JSON      │             │
│  │ • SLI/SLO   │  │ • DB Query │  │ • Corr. ID  │             │
│  │             │  │ • HTTP     │  │ • Tenant ID │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                       │
│         ▼                ▼                ▼                       │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              GRAFANA (Unified Dashboard)               │       │
│  │                                                        │       │
│  │  • System Health Dashboard                             │       │
│  │  • Service Health Dashboard (per service)              │       │
│  │  • Business KPI Dashboard                              │       │
│  │  • SLI/SLO Dashboard                                  │       │
│  │  • Kafka Dashboard                                    │       │
│  │  • Database Dashboard                                 │       │
│  │  • Cost Dashboard (Kubecost)                          │       │
│  │                                                        │       │
│  │  Correlation: Click from metric → traces → logs       │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              ALERTING (PagerDuty + Slack)             │       │
│  │                                                        │       │
│  │  SEV-1 → PagerDuty (on-call SRE + Eng Lead)           │       │
│  │  SEV-2 → PagerDuty (on-call SRE)                      │       │
│  │  SEV-3 → Slack (#fleetvision-alerts)                 │       │
│  │  SEV-4 → Slack (#fleetvision-low-priority)            │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. SLI/SLO Framework

### 2.1 Service Level Objectives

| Service | SLI Name | SLI Definition | SLO Target | Error Budget (30 days) |
|---|---|---|---|---|
| API Gateway | Availability | Successful HTTP responses / Total HTTP responses | 99.99% | 4.32 minutes |
| API Gateway | Latency | Requests < 200ms / Total requests | 99.9% | 43.2 minutes |
| Tracking Service | Availability | Successful position ingest / Total position ingest | 99.99% | 4.32 minutes |
| Tracking Service | Freshness | Vehicles with position < 10s old / Total active vehicles | 99.9% | 43.2 minutes |
| Telemetry Ingestion | Throughput | Events processed / Events received | 99.99% | 4.32 minutes |
| Telemetry Ingestion | Latency | End-to-end processing < 50ms / Total events | 99.5% | 216 minutes |
| All API Services | Availability | Non-5xx responses / Total responses | 99.95% | 21.6 minutes |
| All API Services | Latency | Requests < 150ms / Total requests (P95) | 99.0% | 432 minutes |
| Kafka Cluster | Availability | Partition leaders available / Total partitions | 99.99% | 4.32 minutes |
| PostgreSQL | Availability | Successful queries / Total queries | 99.99% | 4.32 minutes |
| Redis | Availability | Successful operations / Total operations | 99.99% | 4.32 minutes |

### 2.2 SLI Measurement (PromQL)

```promql
# API Gateway Availability
sum(rate(http_requests_total{status!~"5.."}[5m])) 
/ sum(rate(http_requests_total[5m]))

# API Gateway Latency (P99)
histogram_quantile(0.99, 
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
)

# Tracking Freshness (vehicles with position < 10s)
sum(last_position_age_seconds < 10) / sum(active_vehicles)

# Telemetry Ingestion Throughput
sum(rate(telemetry_events_processed_total[5m]))
/ sum(rate(telemetry_events_received_total[5m]))

# Error Budget Remaining (30-day window)
1 - (
  (sum(increase(errors_total[30d])) / sum(increase(requests_total[30d])))
  / (1 - 0.9999)
)
```

### 2.3 Error Budget Policy

| Burn Rate | Status | Action |
|---|---|---|
| 0-50% (normal) | Green | Normal operations; continue feature development |
| 50-75% (elevated) | Yellow | Slow feature development; focus on reliability |
| 75-100% (critical) | Orange | Stop feature development; reliability work only |
| > 100% (breach) | Red | All hands on reliability; post-incident review required |

---

## 3. Dashboard Catalog

### 3.1 Core Dashboards

| Dashboard | Audience | Refresh Rate | Key Panels |
|---|---|---|---|
| **Platform Overview** | Exec/Engineering | 30s | Total vehicles, active trips, event throughput, error rate, availability |
| **Service Health** | SRE | 10s | Per-service: availability, latency P50/P95/P99, throughput, error breakdown |
| **API Gateway** | Platform | 10s | Request rate, error rate by code, latency distribution, top endpoints, rate limiting |
| **Kafka Cluster** | Platform | 30s | Consumer lag, throughput, partition distribution, under-replicated partitions |
| **Database** | SRE | 30s | Connection pool, query latency, replication lag, disk usage, lock contention |
| **Tracking Real-Time** | Fleet Ops | 5s | Active vehicles, GPS event rate, positions/sec, geofence triggers |
| **Telemetry Ingestion** | Platform | 10s | Events/sec, processing latency, device online count, back-pressure indicator |
| **SLI/SLO** | SRE/Product | 1m | All SLIs vs targets, error budget consumption, burn rate alerts |
| **Cost** | Engineering/FIN | 1h | Per-service cost, per-tenant cost, trend, forecast |
| **Security** | Security | 5m | Failed auth attempts, suspicious activity, certificate expiry, audit events |

### 3.2 Key Metrics per Service

#### Identity Service
```yaml
metrics:
  - name: identity_auth_requests_total
    type: counter
    labels: [method, status, auth_type]
  - name: identity_auth_duration_seconds
    type: histogram
    labels: [method, auth_type]
  - name: identity_active_sessions
    type: gauge
  - name: identity_token_refresh_total
    type: counter
    labels: [status]
```

#### Tracking Service
```yaml
metrics:
  - name: tracking_positions_received_total
    type: counter
    labels: [tenant_id, source]
  - name: tracking_positions_processed_total
    type: counter
  - name: tracking_geofence_evaluations_total
    type: counter
    labels: [geofence_id, result]
  - name: tracking_position_processing_duration_seconds
    type: histogram
  - name: tracking_active_vehicles
    type: gauge
    labels: [tenant_id]
```

#### Telemetry Ingestion Service
```yaml
metrics:
  - name: telemetry_events_received_total
    type: counter
    labels: [device_type, tenant_id]
  - name: telemetry_events_processed_total
    type: counter
  - name: telemetry_processing_duration_seconds
    type: histogram
  - name: telemetry_consumer_lag
    type: gauge
    labels: [topic, partition]
  - name: telemetry_devices_online
    type: gauge
```

---

## 4. Alerting Rules

### 4.1 Critical Alerts (PagerDuty — SEV-1)

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| API Gateway Down | No successful responses for 2 minutes | SEV-1 | `runbooks/api-gateway-down.md` |
| Database Primary Down | PostgreSQL primary unreachable for 30s | SEV-1 | `runbooks/database-failover.md` |
| Kafka Cluster Unavailable | > 50% partitions offline for 1 minute | SEV-1 | `runbooks/kafka-recovery.md` |
| Tenant Data Isolation Breach | Cross-tenant data access detected | SEV-1 | `runbooks/security-incident.md` |
| GPS Pipeline Stalled | No positions processed for 60 seconds | SEV-1 | `runbooks/gps-pipeline-stall.md` |
| SSL Certificate Expired | Any TLS certificate < 24h from expiry | SEV-1 | `runbooks/certificate-renewal.md` |

### 4.2 High Alerts (PagerDuty — SEV-2)

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| Service Error Rate Spike | 5xx rate > 5% for 5 minutes | SEV-2 | `runbooks/service-error-spike.md` |
| Consumer Lag Critical | Kafka consumer lag > 100K for 5 minutes | SEV-2 | `runbooks/consumer-lag.md` |
| Database Replication Lag | Replication lag > 10 seconds | SEV-2 | `runbooks/replication-lag.md` |
| High Memory Usage | Container memory > 90% limit for 5 minutes | SEV-2 | `runbooks/memory-pressure.md` |
| Redis Connection Exhaustion | Redis connections > 80% max for 3 minutes | SEV-2 | `runbooks/redis-connections.md` |

### 4.3 Warning Alerts (Slack — SEV-3)

| Alert | Condition | Severity |
|---|---|---|
| Slow Queries | PostgreSQL query > 5 seconds | SEV-3 |
| Disk Usage High | Any PVC > 80% capacity | SEV-3 |
| Pod Restart Loop | Container restarts > 3 in 10 minutes | SEV-3 |
| Certificate Expiry Warning | Certificate < 30 days from expiry | SEV-3 |
| Kafka Consumer Lag Elevated | Consumer lag > 10K for 10 minutes | SEV-3 |

---

## 5. Logging Architecture

### 5.1 Log Format (Structured JSON)

```json
{
  "timestamp": "2026-08-02T14:30:00.000Z",
  "level": "INFO",
  "service": "identity-service",
  "namespace": "fleet-core",
  "instance": "identity-service-abc123-def",
  "trace_id": "abc123def456",
  "span_id": "789ghi",
  "correlation_id": "uuid-from-api-gateway",
  "tenant_id": "tenant-uuid",
  "user_id": "user-uuid",
  "message": "User authenticated successfully",
  "context": {
    "auth_method": "oauth2",
    "auth_provider": "keycloak",
    "client_ip": "10.0.1.2"
  },
  "metadata": {
    "version": "1.2.0",
    "kubernetes": {
      "pod": "identity-service-abc123-def",
      "node": "ip-10-0-10-1.ec2.internal",
      "namespace": "fleet-core"
    }
  }
}
```

### 5.2 Log Levels

| Level | Usage | Example |
|---|---|---|
| ERROR | Unrecoverable errors requiring intervention | Database connection failure, event processing failure |
| WARN | Recoverable issues, degradation | Circuit breaker open, retry exhausted, fallback used |
| INFO | Business events, state transitions | User authenticated, vehicle registered, trip dispatched |
| DEBUG | Development debugging (disabled in production) | Request headers, method entry/exit, intermediate values |
| TRACE | Fine-grained tracing (disabled in production) | SQL queries, HTTP request/response bodies |

### 5.3 PII Redaction Rules

| Field | Redaction Pattern | Example |
|---|---|---|
| SSN | Replace with `***-**-****` | `123-45-6789` → `***-**-****` |
| License Number | Replace with `****-****` | `DL-12345678` → `****-****` |
| Email | Mask local part | `john.doe@company.com` → `j***@company.com` |
| Phone | Mask middle digits | `+1-555-123-4567` → `+1-***-***-4567` |
| VIN | Mask last 8 chars | `1HGCM82633A004352` → `1HGCM***004352` |

---

## 6. Distributed Tracing

### 6.1 Trace Context Propagation

```
API Gateway (injects trace context)
    │  trace_id: abc123, span_id: def456
    │  Headers: traceparent, tracestate, X-Correlation-Id
    │
    ▼
Identity Service (extracts + creates child span)
    │  trace_id: abc123, span_id: ghi789, parent: def456
    │
    ├──► PostgreSQL (instrumented via pgx / Spring Data)
    │      trace_id: abc123, span_id: jkl012, parent: ghi789
    │
    ├──► Kafka Producer (injects trace context in headers)
    │      trace_id: abc123 in message headers
    │
    └──► gRPC Client (injects trace context in metadata)
           trace_id: abc123 in grpc metadata
```

### 6.2 Sampling Strategy

| Service | Sampling Rate | Rationale |
|---|---|---|
| API Gateway | 100% (head-based) | Entry point — all traces captured |
| API Services | 100% (inherits from gateway) | Critical path — full observability |
| Telemetry Ingestion | 10% (tail-based, only errors + slow) | High volume — sample for debugging |
| Background Jobs | 100% | Low volume — full capture |
| Stream Processors | 10% | High volume — sample |

---

## 7. Chaos Engineering

### 7.1 Chaos Testing Strategy

| Experiment | Frequency | Target | Expected Behavior |
|---|---|---|---|
| Pod Kill | Weekly (random) | Random pod in fleet-core | Auto-restart; no user impact |
| Network Partition | Monthly | Service-to-service | Circuit breaker activates; graceful degradation |
| CPU Stress | Monthly | Random service | HPA scales up; latency within SLO |
| Memory Leak Simulation | Monthly | Random service | OOMKilled; replaced by healthy pod |
| AZ Failure | Quarterly | Terminate all nodes in one AZ | Pods reschedule to healthy AZs; SLO maintained |
| Kafka Broker Kill | Monthly | Random broker | Partition re-replication; consumer lag < 10K |
| Database Failover | Monthly | RDS primary | Patroni failover; < 30s downtime |
| DNS Failure | Quarterly | Route53 health check | DR region failover |

### 7.2 Tools

- **Chaos Mesh** or **LitmusChaos** for Kubernetes-native chaos engineering
- **Chaos Monkey** for random instance termination
- **Toxiproxy** for network fault injection in tests
- **Gremlin** for advanced scenarios (multi-AZ, region-level)

---

## 8. On-Call Rotation

### 8.1 On-Call Structure

| Role | Scope | Escalation |
|---|---|---|
| Primary On-Call SRE | All platform services | → Secondary SRE (15 min) |
| Secondary On-Call SRE | All platform services | → Engineering Lead (30 min) |
| Domain On-Call (per team) | Team-owned services | → Team Lead (30 min) |
| Security On-Call | Security incidents | → CISO (15 min) |

### 8.2 Incident Response Timeline

| Time | Action |
|---|---|
| T+0 | Alert fires → PagerDuty page |
| T+5 | Acknowledge page → begin investigation |
| T+10 | Initial assessment → declare severity level |
| T+15 | Communicate status to stakeholders (Slack) |
| T+30 | For SEV-1: Incident commander + bridge call |
| T+60 | For SEV-1: Status page update |
| Resolution | Deploy fix → verify → close incident |
| T+24h | Post-incident review scheduled |
| T+48h | Post-incident report published |
