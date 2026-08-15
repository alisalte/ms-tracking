# Sprint F — Real Map Engine & Geospatial Tracking

> **Status:** COMPLETE (verified 2026-08-15)
> Vertical: Real GPS Position → Geospatial Services → Real Map → Vehicle Tracking →
> Track History → Trip Visualization → Geospatial Queries.
> Prerequisites Sprints A–E verified complete. GPS Engine was NOT redesigned;
> TimescaleDB/PostGIS remain the store; no proprietary map dependency was added.

---

## 1. Map Architecture

The map-engine-service keeps its bounded context (geo services only) and gains
real provider integration behind the **existing** `MapProvider` port:

```
Controllers (route / location / map)
        │
ProviderRouter  ── capability-aware selection (§2)
   ├── LocalProvider   (geo.addresses / geo.pois — PostGIS, always registered)
   ├── OsrmProvider    (OSRM_URL configured → routing / match / snap)
   └── NominatimProvider (NOMINATIM_URL configured → geocode / reverse / places)
        │
RedisGeoCache (geo:rev / geo:fwd / geo:route keys, TTL-bounded)
```

gps-engine-service (owner of the positions hypertable) gains the track/trips/
spatial read APIs — telemetry stays in TimescaleDB (§15).

## 2. Provider Abstraction (§4/§5)

- `MapProvider` (`domain/map-provider.ts`) now declares **`capabilities`** — a
  set of the operations a provider actually serves; methods outside the set
  throw controlled errors. `ProviderRouter.selectFor(op)` resolves per
  operation: region pin → configured default (when capable) → first other
  capable provider → `MapProviderUnavailableError`. A deployment can mix OSRM
  (routing) + Nominatim (geocoding) + local DB (reverse geocode).
- **Selection is configuration-driven** (`MAP_DEFAULT_PROVIDER`,
  `MAP_PROVIDER_REGION`, `OSRM_URL`, `OSRM_PROFILE`, `NOMINATIM_URL`,
  `NOMINATIM_USER_AGENT`); providers register only when their URL is set. No
  API keys in code; nothing committed. HTTP uses Node 22's built-in `fetch`
  (10 s timeout) — **no new dependency, no SDK**.
- **LocalProvider de-stubbed:** `geocode`/`searchPlaces` now return REAL
  coordinates (ST_Y/ST_X from `geo.addresses`/`geo.pois` — previously 0,0);
  `route()` **throws** `RouteUnavailableError` — the straight-line + 50 km/h
  fabrication is gone.

## 3. Routing (§12)

`OsrmProvider.route` calls `GET {OSRM_URL}/route/v1/{profile}?overview=full&geometries=geojson`
and maps distance/duration/geometry onto `RouteResult`; results cached in Redis
(`geo:route:*`). `matchRoute` uses `/match/v1`, `snapPoint` uses `/nearest/v1`
(with road names). `NoRoute`/HTTP errors/network failures become
`RouteUnavailableError`/`MapProviderUnavailableError`, mapped by the controllers
to **HTTP 503 with the reason** — the client never receives fabricated
geometry. No OSRM configured → 503 ("configure OSRM_URL"), not a straight line.

## 4. Geocoding / Reverse Geocoding (§13/§14)

- `NominatimProvider.reverseGeocode/geocode` (OSM Nominatim, self-hostable;
  UA identification per usage policy). Redis cache: `geo:rev:<lat>:<lng>`
  (rounded to ~1 m) and `geo:fwd:<sha>` with `MAP_CACHE_TTL_SECONDS` — bounded,
  never unbounded.
- The local provider remains the fallback for reverse geocoding against
  `geo.addresses` (nearest within 500 m).
- Geocoding happens ONLY on justified events: the frontend reverse-geocodes the
  **selected vehicle's drawer** and explicit route-planner lookups — never per
  GPS packet.
- Frontend: `DevicePopup` shows the reverse-geocoded address with honest
  loading / unavailable states (never a fake address).

## 5. PostGIS & Spatial Queries (§15–§18)

- Audit: `tracking.vehicle_positions` already stores `geom geography(Point,4326)`
  per insert but had **no spatial index**. New migration
  `20260815100000_add_positions_gist_index.js` adds
  `ix_positions_geom_gist ON tracking.vehicle_positions USING GIST (geom)`
  (propagates to all hypertable chunks; the only new index — no redundant ones).
- `GET /positions/nearby?lat&lng&radius&limit` — one SQL:
  `DISTINCT ON (vehicle_id)` latest-per-vehicle + `ST_DWithin` on the GiST
  index, ordered by `ST_Distance`; tenant from the JWT; radius 1..100 000 m;
  **no application-level loops**.
- `GET /positions/in-bounds?north&south&east&west&limit` — same projection with
  `geom && ST_MakeEnvelope`-style bbox overlap; ordered/validated bounds.
- Both under `tracking.read` (RBAC), tenant-scoped, declared before the
  `:vehicleId` routes. POI nearest/bbox and geofence `ST_Covers` queries
  already existed and now return real coordinates (POI mapper bug fixed).

## 6. Historical Tracks (§8–§10, §20–§21)

- Backend `GET /positions/:vehicleId?from=&to=&limit=` (gps-engine, raw wire):
  hardened this sprint — invalid timestamps → 400, `from < to` enforced, max
  range **31 days**, limit clamp 1..10 000. Tenant-scoped via the verified
  principal; the query is index-matched (`ix_positions_tenant_vehicle_time`).
- **Simplification strategy (§10, documented):** bounded window + server-side
  LIMIT + time-ordered scan; the client then drops sub-10 m redundant points
  (`lib/track-utils.ts`) before rendering. No millions of points reach the
  browser, and the strategy needs no server geometry code.
- Frontend `MapPage` gains **LIVE/HISTORY modes (§20)**: LIVE merges WebSocket
  deltas; HISTORY fetches the selected vehicle's real track for a bounded
  preset (1 h/6 h/24 h/7 d) and renders a **gap-aware MultiLineString polyline**
  (§9 — segments split at >10 min temporal gaps, invalid points filtered; no
  straight-line bridging of unrelated data). The two data models are never
  mixed. Loading / error(retry) / point-count / no-selection states are shown.
- MapLibre markers are now **diffed by id** (§7/§27): a live delta moves one
  marker via `setLngLat`; icons rebuild only on visual-identity change; the map
  is never recreated.

## 7. Trip Visualization (§11)

- New gps-engine `GET /trips?vehicleId&from&to&limit` + `GET /trips/:id`
  (tracking.read): reads the EXISTING Sprint A/D `tracking.trip_events`
  projections (the Trip Engine was not rebuilt). Detail composes: trip record +
  real waypoints (positions between start/end, capped 2 000) + idle/parking
  events from the existing period tables + derived avg speed.
- Frontend: `useTrips`/`useTripDetail` now hit the real endpoints and map onto
  the existing `Trip`/`TripDetail` shapes (the full replay UI — timeline, speed
  graph, animated marker — is finally data-fed in real mode). Honest mappings:
  origin/destination render as coordinates (addresses not fabricated), list
  `idleMin` is omitted when the projection lacks it (detail sums it from
  events), idle events without coordinates stay on the timeline only.

## 8. Heatmap & Layers (§19)

- `/map/heat` is now a **minimal real** implementation: position-density cells
  over the hypertable (bbox + window default 24 h / max 7 d, scan capped at
  20 000 rows, single `position_count` metric, Redis-cached). Deliberately not
  an analytics platform.
- `/map/layers` returns only layers the engine actually serves
  (`base, vehicles, tracks, geofences, pois`) — the fabricated
  traffic/satellite/weather entries are gone.

## 9. Frontend Map (§6/§22–§24)

- Existing maplibre-gl rendering kept (zoom/pan/markers/clustering/popup/
  selection/fit-bounds all already real); added: history polyline overlay with
  camera fit, **RoutePlannerDialog** (origin/destination as lat,lng or geocoded
  text → real `/route` → geometry rendered on the map with distance/duration;
  provider failures show honest errors), DevicePopup **History** quick-action
  wired to history mode, reverse-geocoded address with unavailable state.
- Error states (§24): provider unavailable (503 surfaced), route unavailable,
  geocoding unavailable, invalid coordinates (validated), no historical data
  (point-count chip / empty track), WS disconnected (existing chip). No fake
  routes or addresses anywhere.

## 10. Security (§25)

All new endpoints sit behind the global JWT guards: `tracking.read`
(gps-engine track/trips/nearby/in-bounds) and `maps.read` (map-engine). Tenant
is derived from the verified principal — cross-tenant queries return nothing
(tenant predicate precedes the spatial filter) and cross-tenant trip ids 404
without an enumeration oracle. Explicitly tested (controller specs assert the
tenant passed to the repositories and 404 behavior).

## 11. Performance (§26)

`src/__tests__/integration/sprint-f-spatial-explain.integration.spec.ts`
(EXPLAIN against real TimescaleDB+PostGIS; skips gracefully without Docker):
asserts latest/history queries avoid seq scans
(`ix_positions_tenant_vehicle_time`), nearby/in-bounds use
`ix_positions_geom_gist`, and both indexes exist. N+1-free by construction:
latest-per-vehicle, nearby, and in-bounds are single queries; track queries are
window+limit bounded; no unbounded track queries (validated ranges + caps).

## 12. Testing (§28)

- **map-engine** (7 suites / 43 tests): new `osrm-provider.spec` (routing
  mapping, caching, NoRoute/HTTP/unreachable failures, snap, unsupported caps),
  `nominatim-provider.spec` (reverse/geocode mapping, caching, null result,
  unreachable, unsupported caps), extended `provider-router.spec`
  (capability resolution + controlled failure).
- **gps-engine** (20 suites / 129 tests): new `sprint-f-spatial-trips.spec`
  (nearby/in-bounds/track validation + tenant propagation, trips list/detail
  composition, cross-tenant 404) + the EXPLAIN integration suite.
- **web-dashboard** (23 suites / 174 tests): new `track-utils.spec` (gap
  splitting, invalid filtering, simplification, bounds), `map-history.spec`
  (LIVE/HISTORY toggle, track fetch + polyline rendering, honest error/loading
  chips, route planner success/failure/geocode legs),
  `trips-api.spec` (wire mapping, honest defaults, 404 propagation).
- **E2E (§29)**: the live legs (login → WS → marker movement) are proven by the
  Sprint E e2e; the history legs are covered end-to-end at the API-mock
  boundary by `map-history.spec`, and at the SQL level by the integration
  suites. The single remaining full-stack leg (real login → real track →
  rendered polyline in one browser session) needs the live docker stack and is
  documented as a limitation below.

## 13. Known Limitations

- **OSRM/Nominatim are not in docker-compose** — routing/geocoding 503
  (controlled) until `OSRM_URL`/`NOMINATIM_URL` point at a server (e.g.
  `osrm/osrm-backend` + self-hosted Nominatim containers, future infra work).
- map-engine itself is still not in docker-compose (same as Sprint E services);
  dev runs it via `pnpm --filter @fleetvision/map-engine-service dev` (now
  defaulting to **port 3009**, matched by the vite proxy + nginx).
- History mode ships preset windows only (no custom datetime picker yet).
- Heat map is density-only (no speed metric) and has no dedicated frontend
  layer yet.
- Geofence creation UI is still form-based (no map drawing); backend CRUD +
  containment were already real.
- `GET /iam`-style cursor pagination for trips is fixed-limit (200 max).
- The §29 full-stack E2E leg (see §12) awaits the live stack in CI.

## 14. Verification (2026-08-15)

- `pnpm --filter @fleetvision/map-engine-service typecheck && test` — 7 suites / 43 tests ✅
- `pnpm --filter @fleetvision/gps-engine-service typecheck && test` — 20 suites / 129 tests ✅ (integration suites skip without Docker)
- `pnpm --filter @fleetvision/web-dashboard typecheck && test && build` — 23 suites / 174 tests ✅, build ✅
- `npx biome check` — clean on all touched files
