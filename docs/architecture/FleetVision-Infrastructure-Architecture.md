# FleetVision Infrastructure Architecture

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect, Platform Engineering Lead  

---

## 1. Infrastructure Overview

### 1.1 Cloud-Native Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FLEETVISION INFRASTRUCTURE                              │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    GLOBAL LAYER                                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │ Route 53     │  │ CloudFront  │  │ AWS WAF      │                 │  │
│  │  │ (DNS)        │  │ (CDN)       │  │ (DDoS+WAF)   │                 │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    PRIMARY REGION (us-east-1)                         │  │
│  │                                                                        │  │
│  │  ┌─── VPC (10.0.0.0/16) ────────────────────────────────────────────┐│  │
│  │  │                                                                   ││  │
│  │  │  ┌─── Public Subnets ───────────────────────────────────────────┐ ││  │
│  │  │  │  10.0.0.0/24 (AZ-a)  10.0.1.0/24 (AZ-b)  10.0.2.0/24 (AZ-c)│ ││  │
│  │  │  │  • NAT Gateways                                            │ ││  │
│  │  │  │  • ALB (API Gateway Ingress)                                │ ││  │
│  │  │  │  • Bastion (Teleport jump host, no SSH keys)              │ ││  │
│  │  │  └──────────────────────────────────────────────────────────────┘ ││  │
│  │  │                                                                   ││  │
│  │  │  ┌─── Private Subnets ──────────────────────────────────────────┐ ││  │
│  │  │  │  10.0.10.0/24 (AZ-a)  10.0.11.0/24 (AZ-b) 10.0.12.0/24   │ ││  │
│  │  │  │  • EKS Cluster (Control Plane managed by AWS)           │ ││  │
│  │  │  │  • RDS PostgreSQL (Multi-AZ)                                 │ ││  │
│  │  │  │  • ElastiCache Redis (Cluster Mode)                         │ ││  │
│  │  │  │  • MSK (Managed Kafka, 6 brokers, 3 AZs)                   │ ││  │
│  │  │  │  • OpenSearch (Cluster, 3 nodes)                             │ ││  │
│  │  │  └──────────────────────────────────────────────────────────────┘ ││  │
│  │  │                                                                   ││  │
│  │  │  ┌─── Database Subnets ────────────────────────────────────────┐ ││  │
│  │  │  │  10.0.20.0/24 (AZ-a)  10.0.21.0/24 (AZ-b) 10.0.22.0/24   │ ││  │
│  │  │  │  • RDS instances only                                       │ ││  │
│  │  │  │  • No direct internet access                                │ ││  │
│  │  │  │  • Security Group: only app tier + bastion access             │ ││  │
│  │  │  └──────────────────────────────────────────────────────────────┘ ││  │
│  │  │                                                                   ││  │
│  │  │  ┌─── Pod Subnets ─────────────────────────────────────────────┐ ││  │
│  │  │  │  10.0.100.0/16 (per AZ, /20 blocks)                        │ ││  │
│  │  │  │  • Kubernetes pods                                          │ ││  │
│  │  │  │  • Security Group: only within cluster + service mesh     │ ││  │
│  │  │  └──────────────────────────────────────────────────────────────┘ ││  │
│  │  │                                                                   ││  │
│  │  └───────────────────────────────────────────────────────────────────┘│  │
│  │                                                                        │  │
│  │  ┌─── EKS Cluster ───────────────────────────────────────────────────┐ │  │
│  │  │                                                                   │ │  │
│  │  │  Node Pools:                                                     │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐          │ │  │
│  │  │  │ system (3x)   │ │ general (5x)  │ │ memory (3x)  │          │ │  │
│  │  │  │ m6i.xlarge    │ │ m6i.2xlarge   │ │ r6i.2xlarge  │          │ │  │
│  │  │  │ System pods   │ │ App services  │ │ Redis,       │          │ │  │
│  │  │  │ Monitoring    │ │ API GW,       │ │ Analytics    │          │ │  │
│  │  │  │               │ │ Core services │ │ Ingestion    │          │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────┘          │ │  │
│  │  │                                                                   │ │  │
│  │  │  Namespaces:                                                      │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐          │ │  │
│  │  │  │ platform-infra│ │ fleet-core   │ │ fleet-data   │          │ │  │
│  │  │  │ (istio,       │ │ (identity,    │ │ (telemetry,  │          │ │  │
│  │  │  │  monitoring,  │ │  fleet-mgmt,  │ │  analytics,  │          │ │  │
│  │  │  │  cert-mgr)   │ │  tracking,    │ │  reporting)  │          │ │  │
│  │  │  │               │ │  trip, driver, │ │              │          │ │  │
│  │  │  │               │ │  maintenance, │ │              │          │ │  │
│  │  │  │               │ │  compliance,  │ │              │          │ │  │
│  │  │  │               │ │  fuel, asset) │ │              │          │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────┘          │ │  │
│  │  │                                                                   │ │  │
│  │  │  Resource Quotas per Namespace:                                   │ │  │
│  │  │  • CPU limits, Memory limits, Pod count limits                    │ │  │
│  │  │  • LimitRanges for default pod sizing                             │ │  │
│  │  │  • PriorityClass for graceful preemption                           │ │  │
│  │  └───────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    DR REGION (us-west-2) — Active-Passive             │  │
│  │  • Standby EKS cluster (scaled down)                                  │  │
│  │  • RDS read replica (promoted on failover)                             │  │
│  │  • Kafka mirror maker (near-real-time replication)                      │  │
│  │  • S3 cross-region replication                                         │  │
│  │  • Route53 health-check failover (< 60s DNS TTL)                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kubernetes Configuration

### 2.1 Namespace Strategy

| Namespace | Purpose | Resource Quota | Network Policy |
|---|---|---|---|
| `platform-infra` | Istio, Prometheus, Grafana, cert-manager, Vault | No limits (system) | Allow all intra-namespace; deny external |
| `fleet-core` | Identity, Fleet Mgmt, Tracking, Trip, Driver, Maintenance, Compliance, Fuel, Asset | CPU: 100 cores, Mem: 200Gi, Pods: 500 | Allow intra-namespace + specific cross-namespace |
| `fleet-data` | Telemetry Ingestion, Analytics Engine, Report Gen | CPU: 80 cores, Mem: 300Gi, Pods: 200 | Allow intra-namespace + fleet-core read-only |
| `gateway` | Kong API Gateway, MQTT Gateway, WebSocket | CPU: 40 cores, Mem: 64Gi, Pods: 100 | Allow all inbound; restrict outbound |
| `certificates` | cert-manager, External Secrets | CPU: 4 cores, Mem: 8Gi | Allow all |
| `monitoring` | Prometheus, Grafana, Loki, Jaeger, OTel Collector | CPU: 20 cores, Mem: 40Gi, Pods: 50 | Allow all |
| `argocd` | ArgoCD controller, ApplicationSets | CPU: 4 cores, Mem: 8Gi | Allow all |
| `tenant-{id}` | Enterprise tenant dedicated resources (optional) | Per contract | Isolated |

### 2.2 Pod Sizing

| Service | CPU Request | CPU Limit | Memory Request | Memory Limit | Min Replicas | Max Replicas |
|---|---|---|---|---|---|---|
| identity-service | 500m | 2 | 512Mi | 1Gi | 2 | 10 |
| fleet-management-service | 500m | 2 | 512Mi | 1Gi | 2 | 10 |
| tracking-service | 1000m | 4 | 1Gi | 2Gi | 3 | 20 |
| telemetry-ingestion-service | 1000m | 4 | 1Gi | 2Gi | 5 | 50 |
| vehicle-maintenance-service | 500m | 2 | 512Mi | 1Gi | 2 | 8 |
| driver-management-service | 500m | 2 | 512Mi | 1Gi | 2 | 8 |
| fuel-management-service | 500m | 2 | 512Mi | 1Gi | 2 | 8 |
| trip-management-service | 500m | 2 | 512Mi | 1Gi | 2 | 10 |
| compliance-service | 500m | 2 | 512Mi | 1Gi | 2 | 8 |
| analytics-engine | 2000m | 8 | 4Gi | 8Gi | 2 | 15 |
| notification-service | 250m | 1 | 256Mi | 512Mi | 2 | 10 |
| billing-service | 500m | 2 | 512Mi | 1Gi | 2 | 5 |
| audit-log-service | 500m | 2 | 512Mi | 1Gi | 2 | 8 |
| api-gateway (Kong) | 1000m | 4 | 1Gi | 2Gi | 3 | 15 |
| device-management-service | 500m | 2 | 512Mi | 1Gi | 2 | 8 |

### 2.3 HPA Configurations

```yaml
# Example: telemetry-ingestion-service (KEDA-triggered)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: telemetry-ingestion-scaler
  namespace: fleet-data
spec:
  scaleTargetRef:
    name: telemetry-ingestion-service
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka-0.kafka:9092
        consumerGroup: telemetry-ingestion-group
        topic: telemetry.device.raw-data.v1
        lagThreshold: "10000"
        offsetResetPolicy: latest
  minReplicaCount: 5
  maxReplicaCount: 50
  cooldownPeriod: 60
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 20
              periodSeconds: 60
        scaleUp:
          stabilizationWindowSeconds: 30
          policies:
            - type: Pods
              value: 5
              periodSeconds: 60
```

### 2.4 Pod Disruption Budgets

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: identity-service-pdb
  namespace: fleet-core
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: identity-service
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: tracking-service-pdb
  namespace: fleet-core
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: tracking-service
```

---

## 3. Infrastructure as Code

### 3.1 Repository Structure

```
infrastructure/
├── terraform/
│   ├── modules/
│   │   ├── vpc/
│   │   ├── eks/
│   │   ├── rds/
│   │   ├── redis/
│   │   ├── msk/
│   │   ├── s3/
│   │   ├── monitoring/
│   │   └── security/
│   ├── environments/
│   │   ├── dev/
│   │   ├── staging/
│   │   ├── production/
│   │   └── dr/
│   └── global/
│       ├── dns/
│       ├── waf/
│       └── certificates/
│
├── kubernetes/
│   ├── base/
│   │   ├── namespace-definitions/
│   │   ├── network-policies/
│   │   ├── resource-quotas/
│   │   └── limit-ranges/
│   ├── components/
│   │   ├── istio/
│   │   ├── cert-manager/
│   │   ├── external-secrets/
│   │   ├── prometheus-stack/
│   │   ├── loki/
│   │   ├── jaeger/
│   │   ├── kafka/
│   │   └── vault/
│   ├── apps/
│   │   ├── identity-service/
│   │   │   ├── helm-values/
│   │   │   ├── kustomization.yaml
│   │   │   └── argocd-app.yaml
│   │   ├── fleet-management-service/
│   │   ├── tracking-service/
│   │   ├── telemetry-ingestion-service/
│   │   └── ... (per service)
│   └── overlays/
│       ├── dev/
│       ├── staging/
│       ├── production/
│       └── dr/
│
└── helm-charts/
    └── fleetvision-service/  (generic microservice chart)
```

### 3.2 Terraform State Management

- **Backend:** S3 + DynamoDB (state locking)
- **State separation:** One state file per module per environment
- **Workspace strategy:** One workspace per environment
- **State encryption:** AES-256 (SSE-S3)

---

## 4. Network Architecture

### 4.1 Network Security Groups

| Security Group | Inbound Rules | Outbound Rules |
|---|---|---|
| `sg-alb` | 443/TCP from 0.0.0.0/0, 80/TCP redirect to 443 | All to sg-app-tier on 8080/443 |
| `sg-bastion` | 22/TCP from Teleport bastion IPs only | All to private subnets on 22/TCP (Teleport tunnel) |
| `sg-app-tier` | 8080/443 from sg-alb, mTLS from Istio sidecars | PostgreSQL 5432 to sg-db, Redis 6379 to sg-redis |
| `sg-db` | 5432/TCP from sg-app-tier only | None |
| `sg-redis` | 6379/TCP from sg-app-tier only | None |
| `sg-kafka` | 9092/TCP from sg-app-tier, 9093/TCP inter-broker | None |
| `sg-monitoring` | 9090/TCP from Prometheus in monitoring namespace | All within monitoring namespace |

### 4.2 Kubernetes Network Policies

```yaml
# Default deny all ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: fleet-core
spec:
  podSelector: {}
  policyTypes:
    - Ingress

# Allow fleet-core pods to communicate within namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-intra-namespace
  namespace: fleet-core
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector: {}

# Allow fleet-core to talk to fleet-data (for event consumers)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-fleet-core-to-fleet-data
  namespace: fleet-data
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: fleet-core
```

---

## 5. Environment Strategy

### 5.1 Environment Matrix

| Environment | Cluster | Purpose | Data | Deploy Approval | Cost Control |
|---|---|---|---|---|---|
| `local` | Kind/Minikube | Developer | In-memory/stub | Auto (merge) | N/A |
| `ci` | Ephemeral K3s | Integration tests | Ephemeral | Auto (CI) | Auto-destroy post-test |
| `dev` | Shared EKS | Feature dev | Synthetic | 1 approval | Budget alert |
| `staging` | Dedicated EKS | Pre-prod validation | Anonymized prod subset | 2 approvals | Budget alert |
| `production` | EKS Multi-AZ | Live traffic | Real data | 2 approvals + manual gate | Reserved instances |
| `dr` | EKS (passive) | Disaster recovery | Replicated | Auto (mirror production) | Reserved instances |

### 5.2 Environment Promotion Pipeline

```
Developer PR → CI (build + test + scan) → Dev (auto-deploy)
                                             │
                                    Feature Flag Gate
                                             │
                                    Staging (auto-deploy on merge to main)
                                             │
                                    Integration + E2E Tests
                                             │
                                    Manual Approval Gate
                                             │
                                    Production (canary 5% → 25% → 100%)
                                             │
                                    Monitoring Gate (error rate < threshold)
                                             │
                                    Full Rollout
```

---

## 6. Cost Architecture

### 6.1 Cost Optimization Strategy

| Strategy | Description | Estimated Savings |
|---|---|---|
| **Reserved Instances** | 1-year reserved for steady-state workloads | 30-40% |
| **Spot Instances** | Workload nodes for telemetry ingestion, analytics | 60-70% |
| **Graviton (ARM)** | Use m7g/r7g instances where compatible | 20% |
| **Intelligent Tiering** | S3 lifecycle policies for older data | 30-50% on storage |
| **Kafka Tiered Storage** | Move older segments to S3 | 40% on Kafka storage |
| **TimescaleDB Compression** | Compress time-series data after 7 days | 70% on time-series |
| **ClickHouse TTL** | Automatic data expiration to cold storage | 50% on analytics |

### 6.2 Per-Tenant Cost Attribution

- **Kubecost** for Kubernetes resource attribution per namespace/label
- **AWS Cost Explorer** with tag-based cost allocation
- **Tenant billing tag:** All resources tagged with `fleetvision:tenant-id`
- **Monthly cost report** generated per tenant and included in billing dashboard

---

## 7. Disaster Recovery

### 7.1 DR Runbook Summary

| Scenario | Procedure | Automation |
|---|---|---|
| Single node failure | Kubernetes auto-reschedules pods | Automatic |
| AZ failure | Pods rescheduled to healthy AZs; RDS failover | Automatic |
| Region failure | Route53 health check → DNS failover to DR | Semi-automatic (5 min) |
| Database corruption | PITR via WAL-G to specific timestamp | Manual with playbook |
| Kafka cluster failure | Broker auto-recovery; partition re-replication | Automatic |
| Full platform failure | DR region activation with latest backups | Manual (RTO < 15 min) |

### 7.2 DR Testing Schedule

| Test Type | Frequency | Scope |
|---|---|---|
| Component failover | Monthly | RDS, Redis, Kafka (single broker) |
| AZ simulation | Quarterly | Terminate all instances in one AZ |
| Full DR failover | Semi-annually | Complete region failover + failback |
| Chaos Engineering | Weekly | Random pod kills, latency injection, network partitions (Chaos Monkey/Litmus) |
