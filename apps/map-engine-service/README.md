# @fleetvision/map-engine-service

The FleetVision **Map Engine** (registry #21) — the GIS/spatial tier of the platform. Owns the PostGIS geometry store (POIs, geofences, addresses), spatial query services (clustering, heat maps, nearest-K), replay, and the map-provider abstraction.

Canonical spec: [`docs/specs/08_Map_Engine.md`](../../docs/specs/08_Map_Engine.md).

## Sprint 9 scope — Map Engine Core

| Feature | Where | Spec |
|---|---|---|
| **Clustering** | `domain/h3-utils.ts` + `application/cluster-service.ts` | §3.3 |
| **Heat Map** | `api/map.controller.ts` (`GET /map/heat`) | §3.4 |
| **Geofence** | `persistence/geofence.repository.ts` + `application/geofence-service.ts` | §4 |
| **Route** | `infrastructure/provider/local-provider.ts` + `api/route.controller.ts` | §6 |
| **POI** | `persistence/poi.repository.ts` + `application/poi-service.ts` | §8 |
| **Replay** | `application/replay-service.ts` + `domain/douglas-peucker.ts` | §12.5 |
| **Live Map** | (positions via GPS Engine WS; Map Engine serves clusters/layers) | §3.2, §11 |

## Live Map integration

The Map Engine does **not** push positions — the GPS Engine's Socket.IO broadcaster does (spec §3.2). The live-map data flow:
1. Frontend subscribes to the **GPS Engine WebSocket** (`position.update` events).
2. Frontend calls **Map Engine REST** for clusters, layers, and geometry.

## Run locally

```bash
pnpm stack:up   # PostGIS now enabled (timescale/timescaledb-ha:pg16)
pnpm --filter @fleetvision/map-engine-service dev
curl http://localhost:3000/health/live   # 200
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/map/clusters?bbox=&zoom=` | Server-side H3 clusters |
| GET | `/map/replay?vehicleId=&from=&to=` | Position history → GeoJSON |
| GET | `/map/heat?metric=&bbox=&zoom=` | Heat-map cells |
| GET | `/location/geocode?q=` | Forward geocode |
| GET | `/location/reverse?lat=&lng=` | Reverse geocode |
| GET | `/location/pois?bbox=&category=` | POI catalog |
| GET | `/location/nearest?lat=&lng=&radius=&k=` | Nearest-K POIs |
| GET/POST/DELETE | `/location/geofences` | Geofence CRUD |
| GET | `/location/geofences/contains?lat=&lng=` | Point-in-geofence |
| GET | `/route?waypoints=&mode=` | Route between waypoints |

## Provider abstraction

The `MapProvider` interface + `ProviderRouter` (spec §2.3) abstract all external map providers. Sprint 9 ships a **local provider** (PostGIS-based geocoding, haversine routing) as the default. External adapters (Mapbox, Google, OSRM, Amap/Baidu) are well-defined interfaces — wired when API keys land.

## Out of scope (later sprints)

- External provider adapters (Mapbox/Google/OSRM/Amap) — stubbed
- Continuous aggregates for heat-map + 1d–7d replay
- S3 Parquet cold-replay path (>7d)
- HMM/Viterbi map-matching (local snap for now)
- Vector tile proxy
