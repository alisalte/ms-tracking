# Analytics & Reporting Context — Module Design Document

**Version:** 1.0.0
**Status:** Implementation Ready
**Date:** 2026-08-02
**Author:** FleetVision Architecture Team
**Services:** `analytics-engine`, `report-generation-service`
**Bounded Context:** Analytics & Reporting
**Primary Language:** Python 3.12 (Faust + FastAPI), ML Pipeline (scikit-learn, XGBoost)

---

## Table of Contents

1. [Module Overview & Context Mapping](#1-module-overview--context-mapping)
2. [Clean Architecture Layers](#2-clean-architecture-layers)
3. [Aggregate / Domain Model Designs](#3-aggregate--domain-model-designs)
4. [Repository & Data Access Interfaces](#4-repository--data-access-interfaces)
5. [API Endpoints](#5-api-endpoints)
6. [Kafka Event Contracts](#6-kafka-event-contracts)
7. [Stream Processing Pipeline (Faust)](#7-stream-processing-pipeline-faust)
8. [ML Model Registry](#8-ml-model-registry)
9. [Dependencies & External Integrations](#9-dependencies--external-integrations)
10. [Configuration Properties](#10-configuration-properties)
11. [Resilience Patterns](#11-resilience-patterns)
12. [Test Strategy](#12-test-strategy)

---

## 1. Module Overview & Context Mapping

### 1.1 Purpose

The Analytics & Reporting context is the platform's intelligence layer, consuming all domain events to produce real-time dashboards, on-demand reports, and predictive ML models. It uses Python/Faust for high-throughput stream processing and maintains pre-aggregated data in ClickHouse for OLAP queries. This module also manages ML model lifecycle for predictive maintenance, fuel optimization, and driver risk scoring.

### 1.2 Context Map Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                ANALYTICS & REPORTING CONTEXT                     │
│                                                                  │
│  Services:                                                       │
│  ┌──────────────────┐  ┌───────────────────────┐              │
│  │  analytics-engine │  │ report-generation-svc  │              │
│  │  (Python/Faust)   │  │ (Python/FastAPI)       │              │
│  └────────┬─────────┘  └──────────┬────────────┘              │
│           │                        │                             │
│  ┌────────┴────────────────────────┴──────────┐               │
│  │  Domain Models / Read Models                │               │
│  │  • DashboardWidget, ReportTemplate           │               │
│  │  • KPIDefinition, MetricSeries               │               │
│  │  • MLModelVersion, PredictionResult         │               │
│  └─────────────────────────────────────────────┘               │
│                                                                  │
│  Stream Processors (Faust Agents):                               │
│  • FleetPositionAggregator                                      │
│  • FuelConsumptionAggregator                                    │
│  • ComplianceMetricsAggregator                                   │
│  • DriverBehaviorScoreProcessor                                  │
│  • PredictiveMaintenanceModel                                    │
│  • RealTimeDashboardStreamer                                     │
│                                                                  │
└────────┬──────────┬──────────────┬─────────────┬────────────────┘
         │          │              │             │
    Consumes from ALL other contexts (domain events)               │
    ┌────┴─────┐                                                  │
    │  All     │                                                  │
    │ Services │                                                  │
    └──────────┘                                                  │
```

**Upstream (produces events consumed by):**
- `notification-service` — Predictive alerts (maintenance due, anomaly detected)
- `driver-management-service` — Driver behavior scores

**Downstream (consumes events from):**
- ALL services — Every domain event is consumed for aggregation
- `telemetry-ingestion-service` — Raw telemetry data for ML model training

### 1.3 Ubiquitous Language

| Term | Definition |
|---|---|
| **DashboardWidget** | A self-contained visualization component (chart, KPI card, map) with its own data source and refresh policy |
| **ReportTemplate** | A parameterized report definition that generates PDF/CSV/Excel output |
| **KPIDefinition** | A named metric with computation logic, thresholds, and target values |
| **MetricSeries** | A time-ordered sequence of numeric data points for charting |
| **MLModelVersion** | A registered, versioned machine learning model with training metadata |
| **PredictionResult** | The output of an ML model inference (e.g., failure probability, risk score) |
| **StreamProcessor** | A Faust agent that consumes Kafka topics and produces aggregated output |

---

## 2. Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│              analytics-engine (Python/Faust) + report-gen       │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  INTERFACE LAYER                                          │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐   │  │
│  │  │  REST (FastAPI)   │  │  WebSocket (Socket.IO)      │   │  │
│  │  │  Routers:        │  │  Real-time dashboard feeds   │   │  │
│  │  │  • DashboardRtr │  │  • MetricStreamHandler       │   │  │
│  │  │  • ReportRtr     │  │  • AlertStreamHandler        │   │  │
│  │  │  • KPIRtr        │  │                              │   │  │
│  │  │  • MLModelRtr    │  │                              │   │  │
│  │  │  • PredictionRtr │  │                              │   │  │
│  │  └────────┬────────┘  └──────────────────────────────┘   │  │
│  │           │                                                 │  │
│  │  ┌────────┴────────┐  ┌──────────────────────────────┐    │  │
│  │  │  Schemas (Pydantic)│  Kafka Event Publishers       │    │  │
│  │  │  • Request/Resp  │  │  • PredictionEventPublisher   │    │  │
│  │  │  DTOs            │  │  • AlertEventPublisher        │    │  │
│  │  └─────────────────┘  └──────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  APPLICATION (USE CASES) / PIPELINE ORCHESTRATION          │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Report Generation Service                         │    │  │
│  │  │  • GenerateReportUseCase                           │    │  │
│  │  │  • ScheduleReportUseCase                           │    │  │
│  │  │  • ExportReportUseCase                             │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Dashboard Service                                 │    │  │
│  │  │  • GetDashboardUseCase                             │    │  │
│  │  │  • RefreshWidgetUseCase                            │    │  │
│  │  │  • StreamMetricsUseCase                            │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  ML Service                                         │    │  │
│  │  │  • TrainModelUseCase                               │    │  │
│  │  │  • PredictUseCase                                 │    │  │
│  │  │  • EvaluateModelUseCase                            │    │  │
│  │  │  • DeployModelUseCase                              │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  KPI Computation Service                            │    │  │
│  │  │  • ComputeKPIUseCase                               │    │  │
│  │  │  • EvaluateKPIAgainstTargetUseCase                 │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  DOMAIN (ENTITIES)        │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Domain Entities                                   │    │  │
│  │  │  • Dashboard, DashboardWidget, WidgetConfig       │    │  │
│  │  │  • ReportTemplate, ReportSchedule                 │    │  │
│  │  │  • KPIDefinition, KPIValue, KPIThreshold           │    │  │
│  │  │  • MetricSeries, MetricDataPoint                  │    │  │
│  │  │  • MLModelVersion, FeatureVector, PredictionResult │    │  │
│  │  │  • ReportExecution, ReportFormat                  │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Value Objects                                      │    │  │
│  │  │  • TimeRange, Granularity, AggregationType         │    │  │
│  │  │  • ChartType, ColorPalette                         │    │  │
│  │  │  • ModelType, ModelStatus, FeatureImportance       │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                     │
│  ┌───────────────────────────┼─────────────────────────────────┐  │
│  │  INFRASTRUCTURE           │                                 │  │
│  │                           │                                 │  │
│  │  ┌───────────────────────┴───────────────────────────┐    │  │
│  │  │  Stream Processing (Faust Agents)                 │    │  │
│  │  │  • fleet_position_aggregator                       │    │  │
│  │  │  • fuel_consumption_aggregator                      │    │  │
│  │  │  • compliance_metrics_aggregator                     │    │  │
│  │  │  • driver_behavior_scorer                           │    │  │
│  │  │  • predictive_maintenance_agent                    │    │  │
│  │  │  • real_time_dashboard_streamer                      │    │  │
│  │  │  • anomaly_detector                                 │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Data Stores                                        │    │  │
│  │  │  • ClickHouse (OLAP analytics)                      │    │  │
│  │  │  • Redis (real-time metric cache)                  │    │  │
│  │  │  • PostgreSQL (report templates, schedules,       │    │  │
│  │  │    model registry metadata)                         │    │  │
│  │  │  • MinIO/S3 (report artifacts, model artifacts)     │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  ML Infrastructure                                 │    │  │
│  │  │  • Model Registry (PostgreSQL + S3)                │    │  │
│  │  │  • Feature Store (Redis + ClickHouse)              │    │  │
│  │  │  • Training Pipeline (prefect/DAG)                │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────┐    │  │
│  │  │  Report Generation                                  │    │  │
│  │  │  • PDF Generator (WeasyPrint)                        │    │  │
│  │  │  • CSV/Excel Generator (pandas + openpyxl)          │    │  │
│  │  │  • Chart Renderer (matplotlib/plotly)              │    │  │
│  │  └────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Package Structure

```
fleetvision/analytics/
├── api/
│   ├── routers/
│   │   ├── dashboard_router.py
│   │   ├── report_router.py
│   │   ├── kpi_router.py
│   │   ├── ml_model_router.py
│   │   └── prediction_router.py
│   ├── schemas/
│   │   ├── dashboard_schemas.py
│   │   ├── report_schemas.py
│   │   ├── kpi_schemas.py
│   │   ├── ml_schemas.py
│   │   └── prediction_schemas.py
│   └── websocket/
│       ├── metric_stream_handler.py
│       └── alert_stream_handler.py
├── application/
│   ├── use_cases/
│   │   ├── report/
│   │   │   ├── generate_report.py
│   │   │   ├── schedule_report.py
│   │   │   └── export_report.py
│   │   ├── dashboard/
│   │   │   ├── get_dashboard.py
│   │   │   ├── refresh_widget.py
│   │   │   └── stream_metrics.py
│   │   ├── ml/
│   │   │   ├── train_model.py
│   │   │   ├── predict.py
│   │   │   ├── evaluate_model.py
│   │   │   └── deploy_model.py
│   │   └── kpi/
│   │       ├── compute_kpi.py
│   │       └── evaluate_kpi_target.py
│   └── ports/
│       ├── inbound/ (abstract base classes for use case inputs)
│       └── outbound/
│           ├── analytics_repository.py
│           ├── model_registry_repository.py
│           ├── feature_store_repository.py
│           └── report_generator_port.py
├── domain/
│   ├── entities/
│   │   ├── dashboard.py
│   │   ├── widget.py
│   │   ├── report_template.py
│   │   ├── kpi_definition.py
│   │   ├── metric_series.py
│   │   ├── ml_model_version.py
│   │   └── prediction_result.py
│   ├── value_objects/
│   │   ├── time_range.py
│   │   ├── granularity.py
│   │   ├── model_type.py
│   │   └── chart_type.py
│   └── events/
│       ├── prediction_event.py
│       └── anomaly_detected_event.py
├── infrastructure/
│   ├── stream_processing/
│   │   ├── app.py (Faust app entrypoint)
│   │   ├── agents/
│   │   │   ├── fleet_position_aggregator.py
│   │   │   ├── fuel_consumption_aggregator.py
│   │   │   ├── compliance_metrics_aggregator.py
│   │   │   ├── driver_behavior_scorer.py
│   │   │   ├── predictive_maintenance_agent.py
│   │   │   ├── real_time_dashboard_streamer.py
│   │   │   └── anomaly_detector.py
│   │   ├── models/ (Faust Record schemas)
│   │   │   ├── position_event.py
│   │   │   ├── fuel_event.py
│   │   │   └── telemetry_event.py
│   │   └── tables/
│   │       ├── vehicle_metrics_table.py
│   │       ├── driver_scores_table.py
│   │       └── fleet_kpis_table.py
│   ├── persistence/
│   │   ├── clickhouse/
│   │   │   └── clickhouse_analytics_repository.py
│   │   ├── postgresql/
│   │   │   ├── report_template_repository.py
│   │   │   └── model_registry_repository.py
│   │   └── redis/
│   │       └── real_time_metric_cache.py
│   ├── ml/
│   │   ├── registry/
│   │   │   └── mlflow_registry_adapter.py
│   │   ├── models/
│   │   │   ├── predictive_maintenance.py
│   │   │   ├── fuel_optimization.py
│   │   │   ├── driver_risk_scorer.py
│   │   │   └── anomaly_detection.py
│   │   ├── feature_engineering/
│   │   │   └── feature_pipeline.py
│   │   └── training/
│   │       └── training_pipeline.py
│   └── report_generation/
│       ├── pdf_generator.py
│       ├── csv_generator.py
│       └── chart_renderer.py
├── config/
│   └── settings.py
└── main.py
```

---

## 3. Aggregate / Domain Model Designs

### 3.1 Dashboard (Entity)

**Purpose:** Represents a configurable analytics dashboard composed of widgets, shared across users within a tenant.

#### Fields

| Field | Type | Description |
|---|---|---|
| `dashboard_id` | `UUID` | Unique identifier |
| `tenant_id` | `UUID` | Owning tenant |
| `name` | `str` | Dashboard name |
| `description` | `str` | Dashboard description |
| `layout` | `List[WidgetPlacement]` | Ordered widget layout configuration |
| `refresh_interval_seconds` | `int` | Global refresh interval |
| `shared_with` | `List[UUID]` | User IDs with access |
| `created_by` | `UUID` | Creator user ID |
| `created_at` | `datetime` | Creation timestamp |
| `updated_at` | `datetime` | Last update timestamp |
| `version` | `int` | Optimistic locking version |

#### Behaviors

| Behavior | Parameters | Outcome |
|---|---|---|
| `add_widget()` | widget_config, position | Widget placed on dashboard |
| `remove_widget()` | widget_id | Widget removed from layout |
| `update_layout()` | layout_config | Layout reconfigured |
| `share_with_user()` | user_id, permissions | Dashboard shared |
| `duplicate()` | new_name | Creates a copy |

### 3.2 ReportTemplate (Entity)

**Purpose:** A parameterized report definition that can be scheduled or generated on-demand.

#### Fields

| Field | Type | Description |
|---|---|---|
| `template_id` | `UUID` | Unique identifier |
| `tenant_id` | `UUID` | Owning tenant |
| `name` | `str` | Report name |
| `report_type` | `ReportType` | `FLEET_SUMMARY`, `FUEL`, `COMPLIANCE`, `MAINTENANCE`, `DRIVER`, `CUSTOM` |
| `parameters_schema` | `dict` | JSON Schema for report parameters |
| `query_spec` | `dict` | ClickHouse query template |
| `format` | `ReportFormat` | `PDF`, `CSV`, `EXCEL`, `JSON` |
| `layout_template` | `str` | HTML/Jinja2 template for PDF rendering |
| `schedule` | `ReportSchedule?` | Optional recurring schedule |
| `recipients` | `List[str]` | Email recipients |
| `status` | `TemplateStatus` | `DRAFT`, `ACTIVE`, `ARCHIVED` |

#### Behaviors

| Behavior | Parameters | Outcome |
|---|---|---|
| `create_template()` | name, type, query, layout | Template created in DRAFT |
| `activate()` | — | Template activated for use |
| `schedule_report()` | cron_expression, recipients | Report added to schedule |
| `archive()` | — | Template archived |

### 3.3 KPIDefinition (Entity)

**Purpose:** Defines a named KPI with computation logic, data source, thresholds, and target values.

#### Fields

| Field | Type | Description |
|---|---|---|
| `kpi_id` | `UUID` | Unique identifier |
| `tenant_id` | `UUID` | Owning tenant |
| `name` | `str` | KPI display name (e.g., "Fleet MPG") |
| `description` | `str` | KPI description |
| `unit` | `str` | Measurement unit (e.g., "mpg", "$/gal", "%") |
| `computation_type` | `ComputationType` | `AVG`, `SUM`, `COUNT`, `RATIO`, `PERCENTILE` |
| `data_source_query` | `str` | ClickHouse query for raw data |
| `granularity` | `Granularity` | `MINUTE`, `HOUR`, `DAY`, `WEEK`, `MONTH` |
| `target_value` | `float?` | Desired target |
| `warning_threshold` | `float?` | Warning threshold |
| `critical_threshold` | `float?` | Critical threshold |
| `widget_config` | `dict?` | Visualization configuration |

### 3.4 MLModelVersion (Entity)

**Purpose:** Represents a registered, versioned ML model with training metadata, performance metrics, and deployment status.

#### Fields

| Field | Type | Description |
|---|---|---|
| `model_id` | `UUID` | Unique model version identifier |
| `model_name` | `str` | Logical model name (e.g., "predictive_maintenance_v2") |
| `model_type` | `ModelType` | `XGBOOST_CLASSIFIER`, `RANDOM_FOREST`, `ISOLATION_FOREST`, `NEURAL_NETWORK` |
| `version` | `int` | Monotonically increasing version number |
| `status` | `ModelStatus` | `REGISTERED`, `TRAINING`, `EVALUATING`, `DEPLOYED`, `DEPRECATED` |
| `artifact_path` | `str` | S3 path to serialized model artifact |
| `feature_count` | `int` | Number of input features |
| `training_dataset_id` | `str` | Training dataset reference |
| `training_timestamp` | `datetime` | When training completed |
| `metrics` | `dict` | Performance metrics (accuracy, precision, recall, F1, AUC) |
| `feature_importance` | `List[FeatureImportance]` | Top feature importance rankings |
| `deployment_endpoint` | `str?` | Inference endpoint URL |
| `deployed_at` | `datetime?` | When deployed to production |
| `created_by` | `str` | Data scientist who created this version |

#### Behaviors

| Behavior | Parameters | Outcome |
|---|---|---|
| `register()` | name, type, artifact_path | Model registered in REGISTERED status |
| `start_training()` | training_config | Status -> TRAINING |
| `complete_evaluation()` | metrics | Status -> EVALUATING |
| `deploy()` | endpoint_config | Status -> DEPLOYED |
| `deprecate()` | replacement_model_id | Status -> DEPRECATED; old version archived |

### 3.5 PredictionResult (Value Object)

```python
@dataclass(frozen=True)
class PredictionResult:
    prediction_id: UUID
    model_name: str
    model_version: int
    input_features: dict          # Feature vector
    output: dict                   # Model output (probability, class, etc.)
    confidence: float              # Confidence score (0-1)
    timestamp: datetime
    entity_type: str              # "vehicle", "driver", "route"
    entity_id: UUID               # ID of the entity being predicted
    tenant_id: UUID
```

---

## 4. Repository & Data Access Interfaces

```python
from abc import ABC, abstractmethod
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from fleetvision.analytics.domain.entities import (
    Dashboard, ReportTemplate, KPIDefinition,
    MLModelVersion, PredictionResult, MetricSeries
)
from fleetvision.analytics.domain.value_objects import TimeRange, Granularity


class AnalyticsRepository(ABC):
    """ClickHouse-backed analytics query interface."""

    @abstractmethod
    async def query_metric_series(
        self,
        tenant_id: UUID,
        metric_name: str,
        time_range: TimeRange,
        granularity: Granularity,
        filters: dict | None = None
    ) -> MetricSeries:
        """Fetch time-series data for a metric."""
        ...

    @abstractmethod
    async def query_fleet_summary(
        self,
        tenant_id: UUID,
        time_range: TimeRange,
        fleet_id: UUID | None = None
    ) -> dict:
        """Fetch aggregated fleet summary metrics."""
        ...

    @abstractmethod
    async def query_vehicle_comparison(
        self,
        tenant_id: UUID,
        vehicle_ids: List[UUID],
        metric_names: List[str],
        time_range: TimeRange
    ) -> dict:
        """Compare metrics across vehicles."""
        ...

    @abstractmethod
    async def query_driver_ranking(
        self,
        tenant_id: UUID,
        metric_name: str,
        time_range: TimeRange,
        limit: int = 20
    ) -> List[dict]:
        """Rank drivers by a metric."""
        ...


class ReportTemplateRepository(ABC):
    """PostgreSQL-backed report template CRUD."""

    @abstractmethod
    async def save(self, template: ReportTemplate) -> ReportTemplate:
        ...

    @abstractmethod
    async def find_by_id(self, template_id: UUID) -> Optional[ReportTemplate]:
        ...

    @abstractmethod
    async def find_by_tenant(
        self, tenant_id: UUID, status: str | None = None
    ) -> List[ReportTemplate]:
        ...

    @abstractmethod
    async def delete(self, template_id: UUID) -> None:
        ...


class ModelRegistryRepository(ABC):
    """PostgreSQL + S3-backed ML model registry."""

    @abstractmethod
    async def save_model(self, model: MLModelVersion) -> MLModelVersion:
        ...

    @abstractmethod
    async def find_by_name_and_version(
        self, model_name: str, version: int
    ) -> Optional[MLModelVersion]:
        ...

    @abstractmethod
    async def find_deployed(self, model_name: str) -> Optional[MLModelVersion]:
        ...

    @abstractmethod
    async def list_models(
        self, tenant_id: UUID, status: str | None = None
    ) -> List[MLModelVersion]:
        ...

    @abstractmethod
    async def get_model_artifact(self, model: MLModelVersion) -> bytes:
        """Load serialized model from S3."""
        ...


class FeatureStoreRepository(ABC):
    """Redis + ClickHouse-backed feature store."""

    @abstractmethod
    async def get_latest_features(
        self, entity_type: str, entity_id: UUID, feature_names: List[str]
    ) -> dict:
        """Get latest feature values for an entity."""
        ...

    @abstractmethod
    async def get_historical_features(
        self,
        entity_type: str,
        entity_id: UUID,
        feature_names: List[str],
        time_range: TimeRange,
        granularity: Granularity
    ) -> List[dict]:
        """Get historical feature values for training."""
        ...

    @abstractmethod
    async def update_feature(
        self, entity_type: str, entity_id: UUID, features: dict
    ) -> None:
        """Update feature values (from stream processors)."""
        ...


class RealTimeMetricCache(ABC):
    """Redis-backed real-time metric cache for dashboard streaming."""

    @abstractmethod
    async def get(self, key: str) -> Optional[float]:
        ...

    @abstractmethod
    async def set(self, key: str, value: float, ttl_seconds: int = 60) -> None:
        ...

    @abstractmethod
    async def get_range(
        self, key_pattern: str, from_ts: int, to_ts: int
    ) -> List[tuple]:
        """Get time-range values from a Redis sorted set."""
        ...


class DashboardRepository(ABC):
    """PostgreSQL-backed dashboard CRUD."""

    @abstractmethod
    async def save(self, dashboard: Dashboard) -> Dashboard:
        ...

    @abstractmethod
    async def find_by_id(self, dashboard_id: UUID) -> Optional[Dashboard]:
        ...

    @abstractmethod
    async def find_by_tenant(self, tenant_id: UUID) -> List[Dashboard]:
        ...
```

---

## 5. API Endpoints

### 5.1 REST API (FastAPI)

Base path: `/api/v1/analytics`

#### Dashboard Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/dashboards` | List dashboards for tenant | `200` `List[DashboardResponse]` |
| `POST` | `/dashboards` | Create dashboard | `201` `DashboardResponse` |
| `GET` | `/dashboards/{dashboard_id}` | Get dashboard with widget data | `200` `DashboardDetailResponse` |
| `PUT` | `/dashboards/{dashboard_id}` | Update dashboard layout | `200` `DashboardResponse` |
| `DELETE` | `/dashboards/{dashboard_id}` | Delete dashboard | `204` |
| `POST` | `/dashboards/{dashboard_id}/widgets` | Add widget to dashboard | `200` `DashboardResponse` |
| `DELETE` | `/dashboards/{dashboard_id}/widgets/{widget_id}` | Remove widget | `200` `DashboardResponse` |

#### Report Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/reports/templates` | List report templates | `200` `List[ReportTemplateResponse]` |
| `POST` | `/reports/templates` | Create report template | `201` `ReportTemplateResponse` |
| `GET` | `/reports/templates/{template_id}` | Get template details | `200` `ReportTemplateDetailResponse` |
| `POST` | `/reports/generate` | Generate report on-demand | `202` `ReportExecutionResponse` |
| `GET` | `/reports/executions/{execution_id}` | Get execution status/download | `200` `ReportExecutionDetailResponse` |
| `GET` | `/reports/executions/{execution_id}/download` | Download report artifact | `200` File (PDF/CSV/Excel) |
| `POST` | `/reports/templates/{template_id}/schedule` | Schedule recurring report | `200` `ScheduleResponse` |
| `DELETE` | `/reports/templates/{template_id}/schedule` | Cancel schedule | `204` |

#### KPI Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/kpis` | List KPI definitions | `200` `List[KPIDefinitionResponse]` |
| `GET` | `/kpis/{kpi_id}/value` | Get current KPI value | `200` `KPIValueResponse` |
| `GET` | `/kpis/{kpi_id}/history` | Get KPI historical values | `200` `KPIHistoryResponse` |
| `GET` | `/kpis/tenant/{tenant_id}/snapshot` | Get all KPIs for tenant | `200` `List[KPIValueResponse]` |

#### ML Model Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/ml/models` | List registered models | `200` `List[MLModelResponse]` |
| `POST` | `/ml/models/train` | Trigger model training | `202` `TrainingJobResponse` |
| `GET` | `/ml/models/{model_id}` | Get model details | `200` `MLModelDetailResponse` |
| `POST` | `/ml/models/{model_id}/deploy` | Deploy model to production | `200` `MLModelResponse` |
| `POST` | `/ml/models/{model_id}/deprecate` | Deprecate model | `200` `MLModelResponse` |

#### Prediction Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/predictions/maintenance` | Predict vehicle maintenance | `200` `MaintenancePredictionResponse` |
| `POST` | `/predictions/driver-risk` | Predict driver risk score | `200` `DriverRiskResponse` |
| `POST` | `/predictions/fuel-optimization` | Predict optimal fueling | `200` `FuelOptimizationResponse` |
| `GET` | `/predictions/{prediction_id}` | Get prediction result | `200` `PredictionDetailResponse` |
| `GET` | `/predictions/entity/{entity_type}/{entity_id}` | Get predictions for entity | `200` `List[PredictionSummaryResponse]` |

#### Metric Streaming (WebSocket)

| Protocol | Path | Description |
|---|---|---|
| `WSS` | `/ws/metrics/{tenant_id}` | Real-time metric streaming for dashboard widgets |

### 5.2 Pydantic Schemas

```python
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional, List
from enum import Enum


class Granularity(str, Enum):
    MINUTE = "minute"
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"


class ReportFormat(str, Enum):
    PDF = "pdf"
    CSV = "csv"
    EXCEL = "excel"
    JSON = "json"


class GenerateReportRequest(BaseModel):
    template_id: UUID
    parameters: dict = Field(default_factory=dict)
    format: ReportFormat = ReportFormat.PDF
    recipient_emails: Optional[List[str]] = None


class GenerateReportResponse(BaseModel):
    execution_id: UUID
    status: str  # "queued", "processing", "completed", "failed"
    estimated_completion_seconds: int


class MaintenancePredictionRequest(BaseModel):
    vehicle_id: UUID
    prediction_horizon_days: int = Field(default=30, ge=1, le=365)


class MaintenancePredictionResponse(BaseModel):
    prediction_id: UUID
    vehicle_id: UUID
    failure_probability: float = Field(ge=0.0, le=1.0)
    risk_level: str  # "low", "medium", "high", "critical"
    predicted_failure_components: List[str]
    recommended_action: str
    confidence: float
    model_version: int
    generated_at: datetime


class DriverRiskRequest(BaseModel):
    driver_id: UUID
    lookback_days: int = Field(default=90, ge=1, le=365)


class DriverRiskResponse(BaseModel):
    prediction_id: UUID
    driver_id: UUID
    overall_risk_score: float = Field(ge=0.0, le=100.0)
    risk_factors: List[dict]
    incident_probability: float
    behavior_score: float
    model_version: int
    generated_at: datetime


class KPISnapshotResponse(BaseModel):
    kpi_id: UUID
    name: str
    unit: str
    current_value: float
    previous_value: Optional[float]
    change_percent: Optional[float]
    target: Optional[float]
    status: str  # "on_target", "warning", "critical"
    last_updated: datetime
```

---

## 6. Kafka Event Contracts

### 6.1 Events Published (Producer)

| Topic | Event Type | Key | Partition Strategy |
|---|---|---|---|
| `analytics.prediction.maintenance.v1` | `MaintenancePredictionEvent` | `vehicleId` | By vehicle |
| `analytics.prediction.driver-risk.v1` | `DriverRiskPredictionEvent` | `driverId` | By driver |
| `analytics.prediction.fuel-optimization.v1` | `FuelOptimizationEvent` | `tenantId` | By tenant |
| `analytics.anomaly.detected.v1` | `AnomalyDetectedEvent` | `entityType_entityId` | By entity |
| `analytics.report.generated.v1` | `ReportGeneratedEvent` | `tenantId` | By tenant |
| `analytics.kpi.threshold-breached.v1` | `KPIThresholdBreachedEvent` | `tenantId` | By tenant |

### 6.2 Events Consumed (Subscriber) — All Domain Events

| Source Topic | Consuming Agent | Purpose |
|---|---|---|
| `tracking.position.updated.v1` | `fleet_position_aggregator` | Real-time fleet distribution, utilization metrics |
| `tracking.position.updated.v1` | `anomaly_detector` | Route deviation detection, unusual patterns |
| `fuel.transaction.completed.v1` | `fuel_consumption_aggregator` | Fleet fuel efficiency, cost aggregation |
| `fuel.transaction.flagged.v1` | `anomaly_detector` | Fuel fraud pattern detection |
| `compliance.hos.violation-detected.v1` | `compliance_metrics_aggregator` | HOS compliance rate tracking |
| `compliance.dvir.defect-recorded.v1` | `compliance_metrics_aggregator` | Vehicle condition metrics |
| `compliance.incident.created.v1` | `compliance_metrics_aggregator` | Incident rate metrics |
| `maintenance.workorder.*.v1` | `predictive_maintenance_agent` | Maintenance prediction model retraining trigger |
| `telemetry.diagnostic-code.v1` | `predictive_maintenance_agent` | Real-time diagnostic event processing |
| `driver.behavior.score-updated.v1` | `driver_behavior_scorer` | Aggregate driver risk scoring |
| `fleet.vehicle.created.v1` | All aggregators | Fleet composition baseline updates |
| `billing.invoice.generated.v1` | Fleet cost aggregation | Cost-per-vehicle analytics |

### 6.3 Consumer Group Configuration

```python
# Faust app configuration
FAUST_BROKERS = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
FAUST_CONSUMER_GROUP = "analytics-engine"

# Agent-specific topics and concurrency
AGENT_CONFIG = {
    "fleet_position_aggregator": {
        "topics": ["tracking.position.updated.v1"],
        "concurrency": 6,
        "processing_guarantee": "at_least_once"
    },
    "fuel_consumption_aggregator": {
        "topics": ["fuel.transaction.completed.v1"],
        "concurrency": 3
    },
    "compliance_metrics_aggregator": {
        "topics": [
            "compliance.hos.violation-detected.v1",
            "compliance.dvir.defect-recorded.v1",
            "compliance.incident.created.v1"
        ],
        "concurrency": 3
    },
    "driver_behavior_scorer": {
        "topics": ["driver.behavior.score-updated.v1"],
        "concurrency": 2
    },
    "predictive_maintenance_agent": {
        "topics": [
            "maintenance.workorder.created.v1",
            "maintenance.workorder.completed.v1",
            "telemetry.diagnostic-code.v1"
        ],
        "concurrency": 4
    },
    "anomaly_detector": {
        "topics": [
            "tracking.position.updated.v1",
            "fuel.transaction.flagged.v1"
        ],
        "concurrency": 4
    },
    "real_time_dashboard_streamer": {
        "topics": ["*"],  # Aggregates from Faust tables
        "concurrency": 2
    }
}
```

---

## 7. Stream Processing Pipeline (Faust)

### 7.1 Faust Application Configuration

```python
# infrastructure/stream_processing/app.py
import faust
from fleetvision.analytics.infrastructure.stream_processing.models.position_event import PositionEvent
from fleetvision.analytics.infrastructure.stream_processing.models.fuel_event import FuelTransactionEvent

app = faust.App(
    "analytics-engine",
    broker=os.getenv("KAFKA_BOOTSTRAP", "localhost:9092"),
    store="rocksdb://",
    topic_allow_declare=True,
    value_serializer="json",
    processing_guarantee="at_least_once",
    consumer_auto_offset_reset="latest",
)

# Kafka topics
tracking_topic = app.topic("tracking.position.updated.v1", value_type=PositionEvent)
fuel_topic = app.topic("fuel.transaction.completed.v1", value_type=FuelTransactionEvent)

# Local Faust Tables (state stores)
vehicle_metrics_table = app.Table("vehicle-metrics", default=int, partitions=64)
driver_scores_table = app.Table("driver-scores", default=float, partitions=32)
fleet_kpis_table = app.Table("fleet-kpis", default=float, partitions=16)
```

### 7.2 Stream Agent: Fleet Position Aggregator

```python
# infrastructure/stream_processing/agents/fleet_position_aggregator.py

@app.agent(tracking_topic, concurrency=6)
async def fleet_position_aggregator(positions):
    """Aggregate vehicle positions into fleet-level metrics."""
    async for position in positions:
        # Update vehicle metrics table
        vehicle_key = f"{position.tenant_id}:{position.vehicle_id}"
        vehicle_metrics_table[vehicle_key] = {
            "last_position": {
                "latitude": position.latitude,
                "longitude": position.longitude,
                "speed": position.speed,
                "heading": position.heading,
                "timestamp": position.timestamp.isoformat()
            },
            "updated_at": time.time()
        }

        # Emit to real-time dashboard stream
        dashboard_topic = app.topic("analytics.dashboard.update.v1")
        await dashboard_topic.send(
            key=position.tenant_id,
            value={
                "tenant_id": position.tenant_id,
                "vehicle_id": position.vehicle_id,
                "metric_type": "vehicle_position",
                "data": {
                    "latitude": position.latitude,
                    "longitude": position.longitude,
                    "speed": position.speed
                },
                "timestamp": position.timestamp.isoformat()
            }
        )

        # Windowed aggregation for fleet utilization (5-minute tumbling)
        fleet_key = position.tenant_id
        # ... ClickHouse batch insert for OLAP queries
```

### 7.3 Stream Agent: Anomaly Detector

```python
# infrastructure/stream_processing/agents/anomaly_detector.py

@app.agent(tracking_topic, concurrency=4)
async def route_anomaly_detector(positions):
    """Detect route deviations and unusual vehicle patterns."""
    async for position in positions.stream():
        vehicle_key = f"{position.tenant_id}:{position.vehicle_id}"
        history = vehicle_metrics_table.get(vehicle_key, {})

        # Check for route deviation
        anomaly = detect_route_deviation(
            current_position=position,
            expected_route=history.get("assigned_route"),
            deviation_threshold_miles=5.0
        )

        if anomaly:
            anomaly_topic = app.topic("analytics.anomaly.detected.v1")
            await anomaly_topic.send(
                key=f"vehicle:{position.vehicle_id}",
                value={
                    "anomaly_id": str(uuid.uuid4()),
                    "tenant_id": position.tenant_id,
                    "entity_type": "vehicle",
                    "entity_id": position.vehicle_id,
                    "anomaly_type": "route_deviation",
                    "severity": anomaly.severity,
                    "description": anomaly.description,
                    "data": anomaly.raw_data,
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
```

---

## 8. ML Model Registry

### 8.1 Supported Models

| Model Name | Type | Framework | Training Schedule | Features |
|---|---|---|---|---|
| `predictive_maintenance` | Binary Classification | XGBoost | Weekly (Sunday 02:00 UTC) | Diagnostic codes, mileage, age, usage patterns, weather, fuel consumption |
| `driver_risk_scorer` | Regression | XGBoost | Monthly (1st 03:00 UTC) | HOS violations, incidents, speed events, behavior scores, trip patterns |
| `fuel_optimization` | Multi-output Regression | Random Forest | Bi-weekly | Historical prices, route data, vehicle efficiency, station proximity |
| `anomaly_detection` | Unsupervised | Isolation Forest | Weekly | Telemetry patterns, behavior patterns, consumption patterns |

### 8.2 Model Lifecycle

```
Register -> Train -> Evaluate -> [Approve/Reject] -> Deploy -> Monitor -> [Retrain/Deprecate]
```

### 8.3 Training Pipeline Configuration

```python
TRAINING_PIPELINE_CONFIG = {
    "predictive_maintenance": {
        "schedule": "0 2 * * 0",       # Weekly, Sunday 2 AM
        "min_training_samples": 10000,
        "train_test_split": 0.8,
        "cross_validation_folds": 5,
        "hyperparameter_search": "bayesian",
        "max_search_iterations": 50,
        "min_improvement_to_deploy": 0.02,  # 2% improvement required
        "auto_deploy": True,
        "feature_window_days": 365,
        "retraining_trigger": {
            "drift_threshold": 0.15,     # 15% feature drift
            "performance_degradation": 0.05  # 5% metric drop
        }
    },
    "driver_risk_scorer": {
        "schedule": "0 3 1 * *",        # Monthly, 1st 3 AM
        "min_training_samples": 5000,
        "cross_validation_folds": 5,
        "min_improvement_to_deploy": 0.03,
        "auto_deploy": False            # Requires manual approval
    }
}
```

---

## 9. Dependencies & External Integrations

### 9.1 Internal Service Dependencies

| Dependency | Protocol | Purpose | Resilience |
|---|---|---|---|
| ALL services | Kafka (async) | Consume all domain events | Eventual consistency; consumer lag monitoring |
| `notification-service` | Kafka (async) | Send KPI alerts, prediction alerts | Fire-and-forget |
| `driver-management-service` | gRPC | Update driver behavior scores | Circuit breaker, 5s timeout |

### 9.2 External Integrations

| Integration | Protocol | Purpose |
|---|---|---|
| **ClickHouse** | TCP | OLAP query engine for analytics |
| **Redis** | TCP | Real-time metric cache, Faust state store |
| **MinIO/S3** | S3 API | Report artifacts, ML model artifacts |
| **MLflow** | REST API | Model registry, experiment tracking |
| **Weather API** | REST API | Weather data enrichment for ML features |

### 9.3 Python Dependencies

```toml
# pyproject.toml
[project]
name = "fleetvision-analytics"
version = "1.0.0"
requires-python = ">=3.12"

dependencies = [
    # Web Framework
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "pydantic>=2.7.0",
    "websockets>=12.0",

    # Stream Processing
    "faust-streaming>=2024.1.0",
    "aiokafka>=0.10.0",
    "rocksdict>=0.3.0",

    # Data
    "clickhouse-driver>=0.2.7",
    "clickhouse-sqlalchemy>=0.3.0",
    "asyncpg>=0.29.0",
    "redis[hiredis]>=5.0.0",
    "pandas>=2.2.0",
    "numpy>=1.26.0",

    # ML
    "scikit-learn>=1.5.0",
    "xgboost>=2.0.0",
    "mlflow>=2.14.0",
    "joblib>=1.4.0",

    # Report Generation
    "weasyprint>=62.0",
    "openpyxl>=3.1.0",
    "matplotlib>=3.9.0",
    "plotly>=5.22.0",
    "jinja2>=3.1.0",

    # Observability
    "opentelemetry-api>=1.24.0",
    "opentelemetry-sdk>=1.24.0",
    "opentelemetry-instrumentation-fastapi>=0.45b0",
    "structlog>=24.1.0",

    # Resilience
    "tenacity>=8.3.0",
    "circuitbreaker>=2.0.0",

    # Utilities
    "httpx>=0.27.0",
    "boto3>=1.34.0",
    "python-dotenv>=1.0.0"
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=5.0.0",
    "httpx>=0.27.0",
    "factory-boy>=3.3.0",
]
```

---

## 10. Configuration Properties

```yaml
# config/settings.yaml (loaded via pydantic-settings)

analytics:
  service:
    name: analytics-engine
    report_service_name: report-generation-service

  dashboard:
    max_widgets_per_dashboard: 20
    default_refresh_interval_seconds: 30
    max_refresh_interval_seconds: 300
    min_refresh_interval_seconds: 5

  report:
    max_generation_timeout_seconds: 300
    max_template_count_per_tenant: 50
    max_schedule_count_per_tenant: 100
    supported_formats:
      - pdf
      - csv
      - excel
      - json
    pdf:
      max_pages: 100
      page_size: A4
      orientation: portrait
    storage_bucket: fleetvision-reports

  kpi:
    max_kpis_per_tenant: 100
    evaluation_interval_seconds: 60
    alert_on_threshold_breach: true

  ml:
    model_registry:
      backend: mlflow
      tracking_uri: ${MLFLOW_TRACKING_URI:http://localhost:5000}
      artifact_bucket: fleetvision-ml-artifacts
    training:
      max_concurrent_jobs: 2
      max_training_time_minutes: 120
      auto_retrain_enabled: true
      drift_monitoring_interval_hours: 24
    inference:
      timeout_seconds: 5
      max_batch_size: 100
      fallback_to_last_version: true
    feature_store:
      default_feature_ttl_days: 90

  anomaly:
    route_deviation_threshold_miles: 5.0
    speed_anomaly_threshold_percent: 50
    fuel_consumption_anomaly_percent: 30
    idle_time_threshold_minutes: 120
    geofence_violation_grace_period_seconds: 60

  clickhouse:
    url: ${CLICKHOUSE_URL:clickhouse://localhost:9000}
    database: fleetvision_analytics
    max_execution_time_seconds: 30
    max_memory_mb: 512
    max_rows_to_read: 10000000

  redis:
    url: ${REDIS_URL:redis://localhost:6379}
    metric_ttl_seconds: 3600
    dashboard_cache_ttl_seconds: 300

  postgresql:
    url: ${DATABASE_URL:postgresql+asyncpg://postgres:postgres@localhost:5432/fleetvision_analytics}

  kafka:
    bootstrap_servers: ${KAFKA_BOOTSTRAP:localhost:9092}
    consumer_group: analytics-engine
    schema_registry_url: ${SCHEMA_REGISTRY_URL:http://localhost:8081}

server:
  host: 0.0.0.0
  port: 8092
  workers: 4

resilience:
  clickhouse:
    circuit_breaker:
      failure_threshold: 5
      recovery_timeout_seconds: 30
      half_open_max_calls: 2
    retry:
      max_attempts: 3
      backoff_seconds: 1
  redis:
    circuit_breaker:
      failure_threshold: 3
      recovery_timeout_seconds: 10
  mlflow:
    retry:
      max_attempts: 3
      backoff_seconds: 5

observability:
  tracing:
    enabled: true
    exporter: otlp
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4317}
  metrics:
    enabled: true
  logging:
    level: INFO
    format: json
```

---

## 11. Resilience Patterns

### 11.1 Circuit Breaker Configuration

| Target | Sliding Window | Failure Threshold | Open State | Half-Open Calls |
|---|---|---|---|---|
| ClickHouse | 5 calls | 5 failures | 30s | 2 |
| Redis | 3 calls | 3 failures | 10s | 2 |
| MLflow | 5 calls | 5 failures | 60s | 2 |

### 11.2 Retry Configuration

| Operation | Max Attempts | Backoff | Retryable Errors |
|---|---|---|---|
| ClickHouse queries | 3 | 1s exponential | Connection timeout, query timeout |
| Redis operations | 2 | 100ms | Connection refused |
| MLflow API | 3 | 5s fixed | HTTP 5xx |
| S3 artifact upload | 5 | 2s exponential | Network error, timeout |

### 11.3 Timeout Configuration

| Operation | Timeout | Fallback |
|---|---|---|
| ClickHouse OLAP query | 30s | Return cached data; show staleness warning |
| ML model inference | 5s | Return last known prediction; log warning |
| Report PDF generation | 300s | Fail with timeout; retry asynchronously |
| Real-time metric fetch (Redis) | 500ms | Return null; dashboard widget shows "refreshing" |

### 11.4 Graceful Degradation

- **ClickHouse unavailable:** Serve dashboard data from Redis cache (stale but available); show "data freshness" indicator.
- **Kafka consumer lag > threshold:** Pause real-time stream processing; batch-process missed events on recovery.
- **ML model inference failure:** Return predictions from previous model version; queue retraining request.
- **Redis unavailable:** Stream metrics directly to WebSocket clients without caching; reduced throughput.

---

## 12. Test Strategy

| Layer | Framework | Coverage Target | Scope |
|---|---|---|---|
| **Unit Tests** | pytest + pytest-asyncio | 85% | Domain entities, ML feature engineering, KPI computation, anomaly rules |
| **Integration Tests** | pytest + testcontainers (Kafka, ClickHouse, Redis, PostgreSQL) | 75% | Faust agents, report generation, ClickHouse queries, ML inference pipeline |
| **ML Model Tests** | pytest + scikit-learn test utilities | High | Feature importance validation, prediction sanity checks, drift detection |
| **Stream Processing Tests** | Faust test framework | Critical paths | Agent correctness, windowed aggregation accuracy, exactly-once semantics |
| **Performance Tests** | Locust + custom | SLO validation | Dashboard load time < 2s, report generation < 60s, prediction latency < 500ms |
| **Contract Tests** | Pact | 100% | REST contracts with API gateway; event schema compatibility |

### Key Test Scenarios

1. **Stream Processing:** Position events ingested -> fleet utilization metric computed -> dashboard widget updated within 5 seconds
2. **Report Generation:** Fleet summary report with 1000 vehicles -> PDF generated in < 60 seconds
3. **ML Inference:** Vehicle diagnostic codes -> maintenance prediction returned in < 500ms
4. **Anomaly Detection:** Vehicle deviates 10 miles from planned route -> anomaly event emitted within 30 seconds
5. **KPI Breach:** Fleet MPG drops below threshold -> notification event published within 60 seconds
6. **ClickHouse Failure:** OLAP query fails -> cached data served from Redis within 1 second

---

*Document Control: Version 1.0.0 | 2026-08-02 | Initial design*
