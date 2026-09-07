# Architecture Summary

**Canonical:** `docs/specs/01_Master_Architecture.md`, `docs/specs/22_Codebase_Architecture.md`

## Shape

- Monorepo, Clean Architecture per NestJS service (API → Application → Domain; Infrastructure implements ports).
- Event backbone: Kafka. Device TCP/UDP terminated at `device-gateway-service`, decoded to canonical `DeviceMessage`, published to Kafka.
- Multi-tenant (ADR-003). Cross-service contracts via Kafka / gRPC, not sibling `src` imports.

## MD300 / MDVR media path (implemented)

```
MD300 --GPRS TCP 6180/5023--> device-gateway --Kafka--> fleet-management / notification
MD300 --RTMP 1935--> MediaMTX --HLS--> nginx /media-hls --> web-dashboard
```

Live: command **AB2**. Playback from SD: **AB8** list → **AB4** publish to `<stream>/pb`. Photo: **D03** capture, **D01** list, **D00** download.

## Alarm path (implemented)

Event 126 CCE → gateway maps DMS/ADAS type → notification-service raises catalog type `dms` → dashboard alarm drawer. Evidence UI is opt-in (operator clicks to load).

## Web dashboard shell

`apps/web-dashboard` is a React + Tailwind (TailAdmin-inspired) SPA. The authenticated shell is `AppLayout` (navy sidebar + header). The home screen is `FleetDashboard`: live KPIs from fleet/gps queries, reporting widgets gated on `report.read`, MapLibre preview, and an honest CMMS placeholder until vehicle-maintenance-service lands.

## Changelog

- 2026-09-07: Initial summary.
- 2026-09-07: Dashboard UI redesigned to a FleetVision operations layout (welcome banner, 7 live KPIs, status/trend/health row, map roster, maintenance placeholder, navy activity rail) without changing API contracts.
