# FleetVision CI/CD Pipeline & Deployment Strategy

**Version:** 1.0.0  
**Status:** Approved  
**Date:** 2026-08-02  
**Author:** Chief Software Architect, DevOps Lead  

---

## 1. CI/CD Pipeline Architecture

### 1.1 Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FLEETVISION CI/CD PIPELINE                               │
│                                                                              │
│  ┌──── DEVELOPER ────────────────────────────────────────────────────┐    │
│  │  Local Dev (Kind/Minikube + Docker Compose)                         │    │
│  │  • Hot reload (Skaffold / Docker Compose watch)                     │    │
│  │  • Local Kafka (confluent/cp-all-in-one)                            │    │
│  │  • Local PostgreSQL (Docker)                                        │    │
│  │  • Testcontainers for integration tests                             │    │
│  └──────────────────────────┬──────────────────────────────────────────┘    │
│                              │                                                │
│                    git push to feature branch                                │
│                              │                                                │
│                              ▼                                                │
│  ┌──── CONTINUOUS INTEGRATION ──────────────────────────────────────────┐   │
│  │  GitHub Actions (per PR)                                              │   │
│  │                                                                       │   │
│  │  Stage 1: Build & Compile                                            │   │
│  │  ├── Gradle build (Kotlin/Java) or Go build                         │   │
│  │  ├── Python poetry install                                           │   │
│  │  └── Dependency resolution                                            │   │
│  │                                                                       │   │
│  │  Stage 2: Quality Gates                                              │   │
│  │  ├── Unit Tests (80% coverage minimum)                                │   │
│  │  ├── Integration Tests (Testcontainers)                             │   │
│  │  ├── SAST (SonarQube — quality gate: A rating)                       │   │
│  │  ├── Dependency Scan (Snyk — no critical/high vulnerabilities)      │   │
│  │  ├── Linting (ktlint, golangci-lint, ruff, eslint)                  │   │
│  │  └── Architecture Tests (ArchUnit — DDD boundary verification)     │   │
│  │                                                                       │   │
│  │  Stage 3: Build Artifacts                                            │   │
│  │  ├── Docker build (multi-stage)                                     │   │
│  │  ├── Container scan (Trivy — no critical CVEs)                      │   │
│  │  ├── SBOM generation (Syft)                                          │   │
│  │  ├── Image signing (Cosign)                                          │   │
│  │  └── Push to ECR (dev tag + PR SHA tag)                              │   │
│  │                                                                       │   │
│  │  Stage 4: IaC Validation                                             │   │
│  │  ├── Terraform validate + plan                                       │   │
│  │  ├── Helm lint + helm template                                       │   │
│  │  └── Kubernetes manifest validation (kubeval)                       │   │
│  └──────────────────────────┬──────────────────────────────────────────┘   │
│                              │                                                │
│                  PR merged to main branch                                    │
│                              │                                                │
│                              ▼                                                │
│  ┌──── CONTINUOUS DELIVERY ────────────────────────────────────────────┐   │
│  │  GitHub Actions → ArgoCD (GitOps)                                     │   │
│  │                                                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  DEV ENVIRONMENT (auto-deploy on merge)                       │   │   │
│  │  │  • ArgoCD auto-syncs from Git                                  │   │   │
│  │  │  • Deploy to dev namespace                                     │   │   │
│  │  │  • Smoke tests (curl health endpoints)                          │   │   │
│  │  │  • Feature flag configuration                                  │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                        │   │
│  │                    Manual promote / auto on main merge              │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  STAGING ENVIRONMENT (auto-deploy on main)                     │   │   │
│  │  │  • ArgoCD syncs staging overlay                                │   │   │
│  │  │  • Full integration tests (across services)                   │   │   │
│  │  │  • Performance tests (k6 load testing)                         │   │   │
│  │  │  • E2E tests (Playwright for web, Appium for mobile)           │   │   │
│  │  │  • DAST scan (OWASP ZAP against staging)                       │   │   │
│  │  │  • Data validation (anonymized production data)               │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                        │   │
│  │                    Manual approval gate (2 reviewers)                │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  PRODUCTION (Canary + Progressive Rollout)                   │   │   │
│  │  │                                                               │   │   │
│  │  │  Step 1: Canary (5% traffic) — 5 minutes                      │   │   │
│  │  │  ├── Monitor: error rate, latency P99, saturation             │   │   │
│  │  │  ├── Auto-rollback if error rate > 1% or P99 > 2x baseline     │   │   │
│  │  │  └── Argo Rollouts handles traffic shifting                    │   │   │
│  │  │                                                               │   │   │
│  │  │  Step 2: Progressive (25% → 50% → 100%)                       │   │   │
│  │  │  ├── Each step: 5-minute observation window                   │   │   │
│  │  │  ├── Same monitoring gates                                     │   │   │
│  │  │  └── Full rollback on any metric breach                       │   │   │
│  │  │                                                               │   │   │
│  │  │  Step 3: Full Rollout                                         │   │   │
│  │  │  ├── 100% traffic on new version                              │   │   │
│  │  │  ├── Cleanup old replicas                                     │   │   │
│  │  │  └── Post-deployment verification tests                        │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Pipeline Stages Detail

| Stage | Trigger | Duration (Target) | Gate Criteria |
|---|---|---|---|
| Build & Compile | PR push | 3 min | Compilation succeeds |
| Unit Tests | PR push | 5 min | 80% coverage, 0 failures |
| Integration Tests | PR push | 8 min | 0 failures |
| SAST + Dep Scan | PR push | 3 min | No critical/high vulnerabilities |
| Container Build + Scan | PR push | 4 min | No critical CVEs, image < 500MB |
| IaC Validation | PR push | 1 min | No validation errors |
| Dev Deploy | Main merge | 3 min | Auto-deploy via ArgoCD |
| Staging Deploy | Main merge | 5 min | Auto-deploy + integration tests pass |
| Production Canary | Manual approval | 5 min (observation) | Error rate < 1%, P99 < 2x baseline |
| Production Full | Canary pass | 15 min (progressive) | All monitoring gates green |

---

## 2. GitOps Configuration

### 2.1 ArgoCD Application Manifest

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: identity-service
  namespace: argocd
  labels:
    app.kubernetes.io/name: identity-service
    fleetvision.tier: core
spec:
  project: fleet-core
  source:
    repoURL: https://github.com/fleetvision/platform.git
    targetRevision: main
    path: kubernetes/apps/identity-service
    helm:
      valueFiles:
        - helm-values/values.yaml
        - helm-values/values-production.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: fleet-core
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=false
      - PrunePropagationPolicy=foreground
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### 2.2 Argo Rollouts (Canary)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: identity-service
  namespace: fleet-core
spec:
  replicas: 3
  strategy:
    canary:
      canaryService: identity-service-canary
      stableService: identity-service-stable
      trafficRouting:
        istio:
          virtualServices:
            - name: identity-service-vs
              routes:
                - primary
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - analysis:
            templates:
              - templateName: error-rate-check
            args:
              - name: service-name
                value: identity-service
        - setWeight: 25
        - pause: { duration: 5m }
        - analysis:
            templates:
              - templateName: error-rate-check
              - templateName: latency-check
        - setWeight: 50
        - pause: { duration: 5m }
        - analysis:
            templates:
              - templateName: error-rate-check
        - setWeight: 100
      rollbackWindow:
        revisions: 3
      analysis:
        templates:
          - templateName: success-rate
```

---

## 3. Quality Gates

### 3.1 SonarQube Quality Gate

| Metric | Threshold |
|---|---|
| Overall Rating | A |
| Security Rating | A |
| Reliability Rating | A |
| Maintainability Rating | A |
| Coverage | > 80% (new code), > 60% (overall) |
| Duplicated Lines | < 3% |
| Security Hotspots Reviewed | 100% |
| Technical Debt Ratio | < 5% |

### 3.2 Container Image Requirements

| Requirement | Threshold |
|---|---|
| Base image | `eclipse-temurin:21-jre-alpine` (Java), `golang:1.22-alpine` (Go), `python:3.12-slim` (Python) |
| Max image size | 500 MB (Java), 100 MB (Go), 300 MB (Python) |
| Critical CVEs | 0 |
| High CVEs | 0 (or approved exception) |
| SBOM | Generated (Syft in CycloneDX format) |
| Image signing | Signed with Cosign (keyless, Fulcio) |
| Non-root user | Must run as non-root (UID 1000) |

### 3.3 Architecture Tests (ArchUnit)

```java
@ArchTest
static final ArchRule domain_layer_no_external_dependencies =
    classes().that().resideInAPackage("..domain..")
        .should().onlyDependOnClassesThat()
        .resideInAPackage("..domain..");

@ArchTest
static final ArchRule application_layer_depends_on_domain =
    classes().that().resideInAPackage("..application..")
        .should().onlyAccessClassesThat()
        .resideInAnyPackage("..domain..", "..application..");

@ArchTest
static final ArchRule infrastructure_layer_implements_ports =
    classes().that().resideInAPackage("..infrastructure..")
        .should().implement(Interface.class)
        .orShould().beAnnotatedWith(Component.class);
```

---

## 4. Feature Flags

### 4.1 Feature Flag Strategy

- **Engine:** LaunchDarkly (managed) or Flipt (self-hosted)
- **Integration:** Spring Boot starter (Java), Go SDK, Python SDK
- **Evaluation:** Server-side only (no client-side SDK for security)
- **Flags:** Stored in version control; environment-specific overrides in config

### 4.2 Flag Categories

| Category | Lifecycle | Example |
|---|---|---|
| Release Flag | Removed after stable rollout | `feature.predictive-maintenance.enabled` |
| Ops Flag | Long-lived, toggled during incidents | `service.tracking.circuit-breaker.override` |
| Experiment Flag | Temporary, for A/B testing | `experiment.new-dashboard-layout.v2` |
| Permission Flag | Tied to tenant subscription tier | `feature.advanced-analytics.tier:professional` |

---

## 5. Secret Management

### 5.1 Vault Integration

```yaml
# External Secrets Operator — syncs Vault secrets to K8s Secrets
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: identity-service-db-credentials
  namespace: fleet-core
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: identity-service-db-credentials
    creationPolicy: Owner
  data:
    - secretKey: username
      remoteRef:
        key: secret/data/fleet-core/identity-service/database
        property: username
    - secretKey: password
      remoteRef:
        key: secret/data/fleet-core/identity-service/database
        property: password
```

### 5.2 Secret Lifecycle

| Secret Type | Rotation | Method |
|---|---|---|
| Database passwords | 90 days | Vault dynamic credentials (TTL: 24h auto-rotated) |
| JWT signing keys | 90 days | Keycloak automatic rotation |
| API keys | 90 days | Manual rotation with 30-day overlap |
| TLS certificates | 90 days | cert-manager with Let's Encrypt |
| Encryption keys | 180 days | Vault auto-rotation (envelope encryption) |
| Service account tokens | 24h | SPIFFE/SPIRE automatic rotation |

---

## 6. Deployment Runbook

### 6.1 Standard Deployment Procedure

```bash
# 1. Verify pipeline is green
gh run view --branch main --status success

# 2. Verify staging tests passed
kubectl get pods -n fleet-core-staging | grep identity-service
kubectl logs -n fleet-core-staging deployment/identity-service --tail=50

# 3. Approve production deployment (ArgoCD)
argocd app sync identity-service --prune

# 4. Monitor canary rollout
argocd rollouts get rollout identity-service -n fleet-core --watch

# 5. Verify production health
kubectl get pods -n fleet-core | grep identity-service
curl -s https://api.fleetvision.io/health | jq .
kubectl logs -n fleet-core deployment/identity-service --tail=100 | grep -i error

# 6. Check monitoring dashboards
# Grafana: FleetVision - Service Health → identity-service
# Verify: error rate, latency P99, CPU, memory, Kafka consumer lag
```

### 6.2 Rollback Procedure

```bash
# Quick rollback (Argo Rollouts)
argocd rollouts undo identity-service -n fleet-core

# Full rollback (GitOps)
git revert <commit-sha>
git push origin main
# ArgoCD auto-syncs to previous state

# Emergency rollback (manual)
kubectl rollout undo deployment/identity-service -n fleet-core
```

### 6.3 Emergency Procedures

| Scenario | Procedure |
|---|---|
| Deployment causing 5xx errors | Pause ArgoCD auto-sync; rollback via `argocd rollouts undo` |
| Database migration failure | Rollback application; restore database from WAL-G PITR |
| Kafka consumer lag > 100K | Pause consumers; scale up partitions; resume with reset offset |
| Memory leak detected | Scale down to previous replica count; trigger heap dump; rollback |
