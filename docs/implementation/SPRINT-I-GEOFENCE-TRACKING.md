# Sprint I — Advanced Geofence & Tracking Experience

**Status: COMPLETE** (all Definition-of-Done items delivered and verified; deferred items documented below)

Sprint I upgraded the Sprint F/G/H baseline to a production-oriented geofence +
tracking experience: full geofence CRUD with real map drawing, an event-driven
ENTER/EXIT/DWELL engine with GPS jitter protection and durable state, custom
historical ranges with real playback, and best-effort OSRM map matching with an
explicit fallback.

---

## 1. Pre-Sprint Audit

**What existed (reused, never duplicated):**
- `tracking.geofences` table (map-engine-owned DDL: `geography(Polygon,4326)` boundary, center, `radius_m`, `alert_on`, `dwell_sec`, GiST `ix_geofences_boundary`), `GeofenceRepository`/`GeofenceService` with create/list/`containsPoint` (ST_Covers)/hard-delete, and legacy routes `GET/POST/DELETE /location/geofences`, `GET /location/geofences/contains` (Sprint F).
- Sprint G `GeofenceDrawMap` (click-vertices polygon, circle via form radius) + `GeofencePage` card grid (Sprint G).
- `MapProvider`/`ProviderRouter`/`OsrmProvider`/`NominatimProvider`/`LocalProvider`, `POST /route/match` (Sprint F), OSRM/Nominatim/map-engine compose services under profiles `routing`/`geocoding` (Sprint G G-0).
- Sprint G alarm engine: `fleetvision.tracking.events` topic + `FleetEventEnvelope`, `TrackingEventProducer`, notification-service Kafka consumer, `fleet_events` history, rule evaluator registry, dedup gates.
- Sprint H notification center + WS gateway + Playwright E2E harness.
- gps-engine position pipeline (validate→dedupe→persist→trip-engine→cache→broadcast), WebSocket `RealtimeGateway`, Redis FSM caches, `GET /positions/:vehicleId?from=&to=&limit=` with 31-day cap, trips API.
- Frontend: MapLibre map components, `splitTrackIntoSegments` gap-aware rendering (10-min gap, dedupe, simplification), history presets (client-side), MUI + Tailwind design system, react-query, i18n (en/fa), Playwright config.

**What was missing:** geofence lifecycle (status/description/update/assignment/pagination/ST_IsValid validation), ENTER/EXIT/DWELL FleetEvents (geofence alarms were evaluated inline per-position in notification-service), jitter protection, durable geofence state, custom history ranges (server-side presets + `from`/`to` XOR), track playback, OSRM tracepoint-correct matching + frontend use, i18n for the drawing UI, permission gates on the geofence page.

**What was broken (found and fixed during Sprint I):**
1. map-engine container crash-looped since Sprint G: shared `schema_migrations` ledger (identity's), a CJS-only migration knex's ESM loader cannot run, missing `CREATE SCHEMA tracking` for compose-only installs, and an RLS policy referencing a nonexistent `geo.speed_limits.tenant_id` column. Now healthy, all 3 migrations applied.
2. notification-service could not boot: four controllers imported DI-injected repositories as `import type` (no runtime class → unresolvable dependencies). Fixed with value imports.
3. `AuthModule`'s `JwtModule.register` was not `global`, so gps-engine's `RealtimeGateway` (JwtService injection) crashed at bootstrap. Fixed in `packages/auth`.
4. Frontend stored the login-form tenant NAME as the `X-Tenant-Id` sent on every request → identity's tenant-mismatch guard 403'd `/auth/me` → no permissions → React crash loop (`useSyncExternalStore` unstable `?? []` selector). Both fixed.
5. map-engine geofence wire returned boundary as WKB hex (added `ST_AsGeoJSON`), and `repo.update` wrote a camelCase `alertOn` column (nonexistent) — update with alertOn always failed.
6. Sprint H integration spec used non-hex/non-uuid-shaped fixture ids and never ran against a live DB (all scenarios failed at HEAD); restored to 8/8 green.
7. gps-engine/fleet-management shared identity's migration ledger — per-service ledgers added (map-engine + gps-engine + fleet-management conventions).

**Sprint F deferred classification:** geofence drawing UI PARTIAL (upgraded), custom ranges MISSING (implemented), map-match coverage PARTIAL (tracepoint rework + frontend + fallback), OSRM/Nominatim compose ALREADY DONE (Sprint G), speed heat map still DEFERRED (see §17).

## 2. Geofence Architecture (incl. documented change)

Boundary per the brief: Map Engine owns the geometry store + CRUD; GPS Engine owns position processing; the geofence evaluator generates membership FleetEvents; the Sprint G alarm engine stays authoritative; notification-service never does spatial math.

**Architectural change (documented per Sprint I §3): geofence detection moved from
notification-service to gps-engine.** Sprint G evaluated `geofence_enter`/`geofence_exit`
inline on every raw position (PostGIS ST_Covers inside the alarm engine + Redis inside-set).
Sprint I implements the brief's mandated flow:

```
Position → GeofenceEvaluator (gps-engine, jitter-protected, dwell-aware)
         → SignalBus geofence.event → TrackingEventProducer
         → fleetvision.tracking.events (geofence.entered|exited|dwell, deterministic eventId)
         → AlarmKafkaConsumer → AlarmEvaluator.processGeofence (rule matching only)
         → alarm → notification dispatcher → WebSocket → bell
```

The notification-service inline path and `GeofenceQuery` were REMOVED (no double
evaluation); geofence alarms now match on events (rule `conditions.geofenceId`
optional = any fence; `geofence_dwell` optionally requires `dwellSec`).
Geofence events are persisted to `notification.fleet_events` (the previous
not-alarm-relevant gate returned null for them).

## 3. Circle Geofences
Input `latitude/longitude/radiusMeters` validated in JS (±90/±180 inclusive bounds, radius > 0 and ≤ 5,000 km cap) and evaluated with the EXACT spherical `ST_DWithin(center, point, radius_m)` — never a JavaScript approximation. The 48-gon boundary remains the indexed spatial footprint for candidate lookups; the API keeps center/radius explicit (radius never silently reinterpreted).

## 4. Polygon Geofences
GeoJSON single-ring input (no holes); structural validation (≥4 positions incl. closure, closed ring, coordinate bounds, ≤2,000 positions) in `domain/geofence-validation.ts`, GEOMETRIC validity (self-intersection) authoritative via PostGIS `ST_IsValid` + `ST_IsValidReason` before any persist → controlled 4xx `INVALID_GEOMETRY`; never silently repaired. Verified live: the E2E edit test initially drew a self-intersecting ring and the backend rejected it with `Self-intersection[...]`.

## 5. CRUD
New `GeofencesController` (`/geofences`): list (filters status/type/search/vehicleId + cursor pagination, ARCHIVED hidden by default), detail, create, update (geometry re-validated, `version` bump), DELETE = archive (soft delete — references stay resolvable), `POST /:id/status` (ACTIVE|INACTIVE|ARCHIVED), `GET/PUT/POST/DELETE /:id/vehicles` assignments. Legacy `/location/geofences*` routes unchanged for backward compatibility (the legacy DELETE remains a hard delete). Audit entries appended to the shared hash-chained `audit.audit_entries` (ported pattern; best-effort).

## 6. Map Drawing
`GeofenceDrawMap` upgraded: POLYGON — click to add vertices, drag vertex markers to move, right-click a vertex to delete, `− Vertex`/Clear controls, live vertex count + area (shoelace); CIRCLE — click center then DRAG to set the radius (haversine readout, bidirectional sync with the numeric field), draggable center; EDIT — seeds the saved geometry (`initial`, mount-safe), no delete+recreate. Accessible status via an `aria-live` region outside the map; all controls are labeled buttons. `GeofenceFormDialog` (create + edit) with name/description/alerts/dwell and vehicle assignment multi-select; `GeofencePage` = filterable DataTable + detail dialog with `GeofencePreviewMap` + lifecycle actions.

## 7–9. Assignment / Activation / Spatial Queries
`tracking.geofence_vehicles` (PK geofence+vehicle, tenant-scoped). A fence WITH assignments applies only to those vehicles; a fence with NO assignments stays tenant-wide (legacy Sprint F/G semantics preserved). Status ACTIVE/INACTIVE/ARCHIVED: only ACTIVE fences are evaluated; INACTIVE stay stored/visible. Spatial queries are set-based: candidate narrowing with the GiST `&&` operator (`boundary && ST_Expand(point, buffer)`) then exact `ST_Covers`/`ST_DWithin`; the far-state refresh re-checks specific fences exactly (bounded by active occupancies).

## 10. Spatial Indexes (EXPLAIN evidence)
- map-engine integration test 14: seeded 2,000 fences, `ANALYZE`, `EXPLAIN (COSTS OFF)` on the candidate query → `Bitmap Index Scan using ix_geofences_boundary`, NO `Seq Scan on tracking.geofences`.
- gps-engine integration test 10: same assertion for the evaluator's exact query text (tenant + status + assignment EXISTS + `&&`).
Both run against the live docker Postgres.

## 11. ENTER / EXIT / DWELL / 12. Jitter Protection / 13. State Persistence
Evaluator = per-(vehicle, geofence) FSM `OUTSIDE→CANDIDATE_IN→INSIDE→CANDIDATE_OUT` with **consecutive-observation confirmation** (`GEOFENCE_CONFIRMATION_POINTS`, default 2): a single noisy point can never flip state; a bounce-back before confirmation emits nothing. Chosen over a geometric boundary buffer because exact distance-to-ring on geography polygons isn't natively supported without geometry casts; confirmation achieves the same anti-flapping with persisted state (rationale documented in the evaluator header). DWELL fires ONCE per occupancy when `capturedAt − enteredAt ≥ dwell_sec ?? GEOFENCE_DWELL_SECONDS (600s)` and `alert_on` includes DWELL. State is DURABLE in `tracking.geofence_state` (PG authoritative — worker restarts rehydrate it; a fresh evaluator over persisted state emits nothing new, proven by test). Kafka redeliveries dedupe via deterministic `eventId = <messageId>:<eventType>:<geofenceId>` + downstream Redis NX. Deleted/INACTIVE fences reset state silently (no phantom EXIT). Multiple simultaneous geofences: independent FSMs (tested).

## 14–15. Alarm / Notification Integration
`geofence.entered/exited/dwell` map to a new `geofence` InputSignal (envelope-validated); `processGeofence` matches rules (enter/exit/dwell, optional geofenceId, optional dwell threshold); Sprint G dedup (window + one-open-alarm) and Sprint H dispatch (per-user fan-out, preferences, WS + in-app) are unchanged downstream. The geofence code never sends notifications. Browser-verified end-to-end (E2E TEST 4): event → Kafka → alarm → notification → bell badge in the real browser.

## 16. Custom History / 17. Track / 18. Playback
`GET /positions/:vehicleId` now accepts `preset=1h|6h|24h|7d|30d` XOR `from`/`to` (both → 400 AMBIGUOUS), validated ISO, `from < to`, max `HISTORY_MAX_RANGE_DAYS` (default 31 — the documented Sprint F bound, configurable but never silently increased); metrics `history_queries_total{result}`. Frontend: custom datetime-local range + Load, presets retained; gap-aware rendering unchanged. Playback = `useTrackPlayback` (requestAnimationFrame, time-based 60× compression, speeds 1/2/4/8×, play/pause/stop/prev/next, timeline slider + current/start/end timestamps, seek): React state emits at ≤10 Hz; the marker updates imperatively (`setLngLat` + CSS rotation, no map re-creation). GAPS ARE NEVER INTERPOLATED — the sample snaps to the pre-gap point and the cursor teleports across (>10-min) gaps (unit-tested).

## 19. Trip Visualization
Existing `GET /trips`/`GET /trips/:id` untouched; TripDetailPage gained "Show on map" → `/map?vehicle=&from=&to=` deep link (MapPage preselects history + custom range; the popup inspector stays closed so the toolbar is reachable — popup visibility is now decoupled from selection).

## 20–22. OSRM Map Matching / Fallback / Router
`OsrmProvider.matchRoute` reworked to the OSRM `tracepoints` array (aligned 1:1 with inputs; unmatched → RAW point, confidence 0 — the old index-pairing against route geometry was approximate). Results cached (`geo:match:*`, quantized points, standard bounded TTL). `POST /route/match` validates 2..500 finite points, goes through the ProviderRouter (never direct from the browser), maps failures to controlled 503 with `map_match_requests_total{success|failure}`. Frontend toggle applies matching to the loaded track and on any failure shows the explicit `map.matching.unavailable` chip while keeping the RAW track (never claims matched). Historical positions are never rewritten (§57 — matching is display-only).

## 23. Frontend
New/extended: GeofencePage (filters/pagination/detail/lifecycle), GeofenceFormDialog, GeofenceDrawMap (drag radius, vertex editing, i18n), GeofencePreviewMap, MapToolbar custom range + map-matching toggle, PlaybackControls, useTrackPlayback, FleetMap playback marker, trip→map link. All strings in en/fa. `/geofences` route + nav gated on `maps.read`; mutations gated on `maps.write` (PermissionGate). MUI + existing design system only; no second framework.

## 24. RBAC / 25. Tenant Isolation
Reused `maps.read`/`maps.write` (no duplicate permission names). Identity backfill `20260816150000` grants them to fleet-admin/viewer on existing tenants. Tenant ALWAYS from the verified JWT (`@CurrentTenant`); body/query/header tenant never read. Cross-tenant impossible: verified for findById/update/archive/assignments/list/containsPoint (integration test 13) and evaluator visibility (integration test 8) + browser TEST 5.

## 26–27. Observability / Logging
New bounded-label counters: `geofence_mutations_total{action}`, `geofence_events_total{type}`, `geofence_eval_errors_total`, `history_queries_total{result}`, `map_match_requests_total{result}` (no id labels). map-engine now exposes `/metrics` (`MAP_METRICS_ENABLED`). Logs carry tenantId/vehicleId/geofenceId/messageId via existing pino conventions; evaluator failures warn-and-continue (never break the position pipeline).

## 28. Database / Migrations
Forward-only, deterministic, ESM: map-engine `20260816120000` (description/status/created_by + check, `ix_geofences_tenant_status`, `tracking.geofence_vehicles` + RLS) and gps-engine `20260816140000` (`tracking.geofence_state` + check + indexes + RLS); identity `20260816150000` (role grants). Clean-install verified by the containers themselves (map-engine applied 3/3 on an empty schema set).

## 29. Docker
map-engine rebuilt + healthy (restarts 0). `docker-compose.e2e-ports.yml` publishes identity for host-run E2E. OSRM/Nominatim remain optional profiles (`routing`/`geocoding`) — core verified without them (map-matching fallback chip exercised in unit tests; OSRM itself was NOT running — see Verification).

## 30. Test Counts (all executed)
- **Unit (new):** 56 — evaluator FSM 14 (gps), history window 9 (gps), geofence validation 12 (map), OSRM match 6 (map), geofence envelopes 6 (notification), playback 9 (web/vitest).
- **Integration (new):** 21 — map-engine CRUD/spatial/EXPLAIN 13, gps-engine evaluator 8 (real PostGIS, no spatial mocks).
- **Browser E2E (new):** 5/5 passed (create, edit, history+playback, alarm→notification→bell, tenant isolation); Sprint H spec 2/2 (regression).
- **Full suites after all changes:** map-engine 74/74; gps-engine 185 passed + 4 self-skipped (sprint-e full-stack leg needs sibling dists); notification 132/132; web-dashboard 190/190 (vitest).

## 31. Verification (honest)
- typecheck: PASS (workspace-wide `pnpm -r typecheck`).
- build: PASS (observability, auth, map/gps/notification/identity services; web `tsc -b && vite build` via typecheck+dev usage).
- unit tests: PASS (counts above).
- integration: PASS (live docker Postgres 15432 / Redis / Kafka 9092).
- browser E2E: PASS (5/5 Sprint I, 2/2 Sprint H, msedge channel, live stack).
- lint: biome run on the repo — pre-existing Windows CRLF noise unchanged; no new violations introduced (formatting-only diffs in a few touched files).
- docker: PASS — map-engine container healthy with all migrations; full stack (postgres/redis/kafka/identity/map-engine + host gps/notification/fleet-management/web) drove the E2E.
- OSRM was NOT running (no `osrm-data` PBF mounted): map matching is implemented + unit-tested against a mocked OSRM HTTP contract, and the LIVE fallback path was verified (503 → raw track + "unavailable" chip logic). No claim is made that a real OSRM server was exercised. Nominatim: not configured/not tested.

## 32. Known Limitations / Technical Debt
- identity throttles logins (10/min per IP): serial E2E suites that log in per test trip the limiter — the shared `e2e/helpers/login.ts` now creates ONE session per run via the real UI flow and injects it into each page (the app's own localStorage hydration path; no test-only auth).
- OSRM live-run untested (above); map-match cache TTL uses the shared geo default.
- The evaluator's far-state refresh issues one exact check per active occupancy outside the candidate bbox (bounded, but not batched).
- `CORRIDOR` type remains schema-supported but has no dedicated drawing UX (pre-existing).
- Frontend geofence list uses "Load more" (cursor) — no virtualization for very large tenants.
- Identity's local permission catalog (`apps/identity-service/src/domain/permissions.ts`) remains a stale IAM-only subset of the shared catalog (pre-existing; provisioning of brand-new tenants may miss downstream perms — the backfill covers existing tenants).
- Dev-stack flake: on a cold map-engine the first geofence save can exceed a 15 s dialog wait (E2E asserts on the durable list state instead).

## 33. Deferred Features
- **Speed-metric heat map** (Sprint F carry-over): still only `position_count` density. Deferred — implementing speed-weighted cells + a dedicated frontend layer is a self-contained feature that would compete with the geofence/playback core for verification time (brief §67 permits deferral with documentation).
- SMS/push providers, email SMTP config (Sprint H carry-overs) — unchanged.

## 34. Recommended Next Sprint
1. Mount an OSRM PBF and run the routing profile end-to-end (turn the map-match unit contract into a live verification). 2. Fleet-scoped alarm rules (membership from fleet-management). 3. Speed heat map. 4. Geofence schedule support (`schedule jsonb` exists, unevaluated). 5. Batch far-state refresh + Redis hot-state cache for the evaluator at very high fleet sizes.

## 35. Files Changed (new unless noted)
- packages: `observability/src/metrics/telemetry-metrics.ts` (M), `auth/src/auth.module.ts` (M — JwtModule global fix).
- map-engine: migrations `20260816120000`; `domain/geofence-validation.ts`; `domain/geo-types.ts` (M); `infrastructure/persistence/geofence.repository.ts` (M), `audit.repository.ts`; `application/geofence-service.ts` (M); `api/geofences.controller.ts`, `tokens.ts` (M), `map-engine.module.ts` (M), `app.module.ts` (M: MetricsModule + per-service ledger), `location.controller.ts` (M), `route.controller.ts` (M), `config/map-engine.config.ts` (M), `infrastructure/provider/osrm-provider.ts` (M), `infrastructure/cache/redis-geo-cache.ts` (M); migrations `20260806120000` (M: CREATE SCHEMA tracking) + `20260813120000` (M: ESM + speed_limits policy fix); tests: validation/osrm specs, integration db.ts + CRUD spec.
- gps-engine: migration `20260816140000`; `application/geofence-evaluator.ts`; `infrastructure/persistence/geofence-definitions.repository.ts`, `geofence-state.repository.ts`; `application/signal-bus.ts` (M), `position-pipeline.ts` (M), `infrastructure/kafka/tracking-event-producer.ts` (M), `infrastructure/websocket/realtime.gateway.ts` (M), `api/positions.controller.ts` (M) + `application/history-window.ts`; `config` (M), `api/gps-engine.module.ts` (M), `app.module.ts` (M: ledger); tests: evaluator + history specs, evaluator integration spec (+ afterAll timeouts in 3 integration suites, M).
- notification-service: `infrastructure/kafka/envelope-validation.ts` (M), `alarm-kafka-consumer.ts` (M), `application/evaluators/rule-evaluator.ts` (M), `application/alarm-evaluator.service.ts` (M — inline geofence path removed), `api/notification.dto.ts` (M), `api/notification.module.ts` (M), controllers ×4 (M — import-type DI fixes); deleted `infrastructure/persistence/geofence-query.ts`; cache `alarm-state-cache.ts` (M); tests: envelope spec, sprint-g alarm-engine/pipeline + sprint-h integration + validation specs updated/restored (M), integration db.ts (M).
- identity-service: migration `20260816150000`.
- web-dashboard: `types/geofence.types.ts` (M), `api/geofence.api.ts` (M), `api/client.ts` (M: apiPostRaw/apiPutRaw), `api/map.api.ts` (M), `components/geofences/GeofenceDrawMap.tsx` (M), `GeofenceFormDialog.tsx`, `GeofencePreviewMap.tsx`, `pages/GeofencePage.tsx` (M), `components/map/MapToolbar.tsx` (M), `PlaybackControls.tsx`, `useTrackPlayback.ts`, `components/map/FleetMap.tsx` (M), `pages/MapPage.tsx` (M), `pages/TripDetailPage.tsx` (M), `auth/permissions.tsx` (M), `auth/auth.store.ts` (M), `auth/permissions.tsx` selector fix, `components/shell/nav.config.tsx` (M), `router/index.tsx` (M), `vite.config.ts` (M), i18n en/fa (M), `package.json` (M: kafkajs devDep); tests `sprint-i-playback.spec.tsx`; e2e `helpers/login.ts`, `geofences.e2e.spec.ts`, `history-playback.e2e.spec.ts`, `geofence-alarm.e2e.spec.ts`.
- infra: `docker/docker-compose.e2e-ports.yml`.

## 36. Commands Executed (key)
- `pnpm --filter <pkg> typecheck|build` (observability, auth, map/gps/notification/identity services, workspace `-r`).
- jest (per service): `node --experimental-vm-modules node_modules/jest/bin/jest.js` with `MAP_TEST_DBURL|GPS_TEST_DBURL|NOTIF_TEST_DBURL=postgres://fleetvision:fleetvision@localhost:15432/fleetvision`, `NOTIF_KAFKA_BROKERS=localhost:9092`.
- vitest: `npx vitest run` (web-dashboard).
- Playwright: `E2E_BROWSER_CHANNEL=msedge … npx playwright test e2e/<spec>` (live stack: docker compose + identity/map-engine containers, host gps/notification/fleet-management + vite).
- docker: `docker compose -f docker-compose.yml [-f docker-compose.e2e-ports.yml] up -d [--build] <svc>`; `EXPLAIN` evidence captured inside the two integration specs.
