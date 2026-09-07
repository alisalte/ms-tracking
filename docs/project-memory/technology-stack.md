# Technology Stack

**Canonical:** `docs/specs/21_Technology_Decision_Record.md`

| Layer | Choice |
|---|---|
| Runtime | Node.js LTS + NestJS + TypeScript (18/20 services); Python 3.12 for two ML tiers |
| Monorepo | pnpm workspaces, Node >= 22 |
| DB | PostgreSQL 16 (+ PostGIS, TimescaleDB); Redis 7; S3/MinIO |
| Events | Kafka; RabbitMQ for task queues |
| Realtime UI | Socket.IO |
| Video | MediaMTX (RTMP ingest, HLS out); nginx `/media-hls` |
| Frontend | React dashboards (web-dashboard, tenant-admin) |
| Lint | Biome |

## Changelog

- 2026-09-07: Initial stack snapshot.
