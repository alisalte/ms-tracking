# @fleetvision/gps-engine-service

The FleetVision **GPS Engine** (registry #7b, bounded context: Tracking & Monitoring). The real-time position-processing tier that consumes position events from Kafka, validates and assigns quality codes, persists to TimescaleDB, caches last-position in Redis, pushes live updates over WebSocket, and tracks device online/offline status.

Canonical spec: [`docs/specs/07_GPS_Engine.md`](../../docs/specs/07_GPS_Engine.md).

## Sprint 7 scope — Position Engine

| Component | Where | Spec |
|---|---|---|
| **Kafka Consumer** | `infrastructure/kafka/kafka-consumer.ts` (repo's first) | §3.1 |
| **Position Pipeline** | `application/position-pipeline.ts` (validate→dedupe→persist→cache→broadcast) | §2, §3 |
| **Quality Gates** | `domain/quality.ts` (VALID/STALE/REJECTED) | §3.3, §3.4 |
| **Position Storage** | `persistence/position.repository.ts` + TimescaleDB hypertable migration | §9.2 |
| **Redis Last-Position** | `cache/redis-position-cache.ts` (`tenant:<tid>:vehicle:<vid>:pos`) | §13.5 |
| **WebSocket Updates** | `websocket/realtime.gateway.ts` (Socket.IO + Redis adapter) | §11 |
| **Device Status** | `application/device-status-pipeline.ts` + `cache/redis-device-status-cache.ts` | §12.1 |

## Run locally

```bash
# 1. Bring up the lean stack (Postgres+Timescale, Redis, Kafka)
pnpm stack:up

# 2. Run the GPS engine (tsx watch).
pnpm --filter @fleetvision/gps-engine-service dev

# 3. Verify
curl http://localhost:3000/health/live   # 200 — process is up
```

Kafka/Redis/Postgres are **non-fatal at boot**: the service starts even when they are down and reconnects lazily.

## Environment

Reads from `infra/docker/.env`. GPS-engine-specific keys:

| Var | Example | Notes |
|---|---|---|
| `GPS_KAFKA_BROKERS` | `localhost:9092` | Kafka cluster |
| `GPS_KAFKA_GROUP_ID` | `gps-engine-service` | Consumer group (per-partition ordering) |
| `GPS_KAFKA_POSITION_TOPIC` | `fleetvision.telemetry.position.raw` | Position input |
| `GPS_KAFKA_SESSION_TOPIC` | `fleetvision.telemetry.session.lifecycle` | Device online/offline |
| `GPS_WS_PORT` | `3001` | Socket.IO port |
| `GPS_WS_ENABLED` | `true` | Graceful disable for headless testing |
| `GPS_STALE_AFTER_SECONDS` | `300` | Position older than this → STALE (not pushed live) |

## API

| Method | Path | Description |
|---|---|---|
| GET | `/positions/:vehicleId/latest` | Last known position (Redis → DB fallback) |
| GET | `/positions/:vehicleId?from=&to=&limit=` | Position history (hypertable scan) |
| GET | `/devices/:deviceId/status` | Device online/offline/stale (Redis → DB) |

All endpoints take a `tenant-id` header (JWT middleware wires in a later sprint).

## Out of scope (later sprints)

- Derivation (speed/heading/distance from successive positions)
- Trip/stop/idle/geofence detection (FSM segmentation)
- Continuous aggregates (5-min/hourly rollups)
- Avro/Schema Registry (JSON for now, matching the gateway)
- OPA authorization on WebSocket room joins
