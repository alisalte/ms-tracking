# API impact

| ID | Likely owners | New / extended surfaces |
|----|---------------|-------------------------|
| F-01 | `fleet-service`, `notification-service`, `reporting-service` | Driving events ingest, score GET, ranking |
| F-02 | `fleet-service` or `reporting-service` | Health score GET / rollup |
| F-03 | New `fuel-service` (or fleet module) | Transactions, exceptions, summaries |
| F-04 | `map-engine-service`, `gps-engine-service`, `reporting-service` | Corridor CRUD, off-route alarms, richer geofence report |
| F-05 | `reporting-service` | Templates, schedules, job status, download |
| F-06 | New `vehicle-maintenance-service` + optional CMMS adapters | Work orders CRUD; later predictive endpoints |
| F-07 | `device-gateway` / `fleet-management` / media / notification | Auto evidence attach; alarm payload enrichment |
| F-08 | BFF or fleet read API | `GET /vehicles/:id/twin` |
| F-09 | New assistant BFF | Chat + tool-calling over existing APIs |
| F-10 | `gps-engine-service`, `map-engine-service` | Live ETA stream/query |
| F-11 | Trip/route service (new or map) | `POST /optimize`, plan apply |

Kafka: expect new event types for driving events, fuel exceptions, ETA updates, maintenance predictions — align with future event catalog.
