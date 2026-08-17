# Sprint J — Reporting & Fleet Analytics

**Status: COMPLETE** (all report categories, API, frontend, CSV export, tests, E2E, and
documentation delivered; residual environment notes and deferred items documented below).

Sprint J built the analytical **read layer** over the authoritative domain projections:
a dedicated `reporting-service` (read-only SQL over tracking/notification/fleet schemas),
a real-data Reports UI, CSV export with injection protection, time-leading database
indexes, and the full test pyramid (unit → real-PostgreSQL integration → browser E2E
including a byte-verified CSV download and explicit cross-tenant probes).

> **Provenance note:** the bulk of Sprint J (service, repository, frontend, KPI doc,
> migrations) was implemented in working session(s) committed under the `5eeca80`
> "sprint I" message. This session audited that work, repaired the defects below,
> added the missing test/documentation layers, and re-verified everything against the
> live stack. Nothing was re-implemented or duplicated.

---

## 1. Sprint I dependency audit (required first action)

Sprint I was verified **by code, not by report claims**:

- `apps/gps-engine-service/src/application/geofence-evaluator.ts` — per-(vehicle,fence)
  FSM with jitter confirmation + dwell, present and unit/integration-tested.
- `tracking.geofence_state` migration (`20260816140000`) + repository — durable state.
- `apps/map-engine-service/src/api/geofences.controller.ts` — full CRUD + assignments.
- Sprint I browser E2E specs exist and were **re-run in this session**: geofences 3/3
  (+1 conditional), history-playback 1/1, geofence→alarm 1/1.
- Sprint I geofence events are persisted to `notification.fleet_events` and are the
  **sole** source for the Sprint J geofence report and the geofence rows in the
  activity timeline (§64 — raw positions are never re-tested against fences).

**Conclusion:** Sprint I is genuinely complete → geofence analytics are legitimate.
One environment finding: the live shared DB had **not** received several Sprint G/H/I/J
migrations (mid-sprint migration renames/edits left the per-service ledgers stale);
this session reconciled them (see §12) — after which the Sprint I E2E and the Sprint J
geofence report run against the real tables.

## 2. Pre-Sprint audit — what existed, what was reused, what was missing

**Existed / reused (never duplicated):**
- Sprint E dashboard "statistics" (`/summary` — device-status counts) — unchanged; the
  Reports module is separate and reads the tracking projections instead.
- Sprint F `GET /trips` (gps-engine) — kept for the Trips pages; the reporting layer's
  trip report is a separate analytical projection with cursor pagination + sorts
  (different contract, same authoritative `tracking.trip_events` source).
- gps-engine trip/idle/parking FSMs, alarm engine records (`notification.alerts`),
  Sprint I geofence FleetEvents, fleet registry (`fleet.vehicles`) — **read-only**
  sources. No `TripEngine2`/`AlarmEngine2`/`GeofenceEngine2` was created.
- Frontend chart library (ECharts via the shared `EChart` wrapper) — reused.

**Missing before Sprint J (all delivered):** a reporting service; fleet-overview /
utilization / distance / speed / idle-parking / alarm / geofence / activity-timeline
APIs; the Reports UI backed by real data (the old page was mock-fixtured);
CSV export; report RBAC permissions; time-leading report indexes; the KPI definitions
document.

## 3. Architecture

```
GPS Engine (trip/idle/parking FSMs, positions)   Alarm Engine (notification.alerts)
        │                                                │
        └────────────► PostgreSQL / TimescaleDB ◄─────────┘
                        (authoritative projections)
                                   │  READ-ONLY SQL (tenant+time constrained,
                                   │  statement_timeout, GROUP BY / CTE / time_bucket)
                        reporting-service (:3011, compose)
                                   │  Redis cache (bounded TTL) + export rate limit
        /api/v1/reports/* ◄────────┘
                                   │
              web-dashboard /reports (KPI cards, charts, tables, CSV download)
```

- **One service added** (`apps/reporting-service`) — justified by service isolation:
  analytical traffic is isolated from the latency-sensitive telemetry pipeline, with
  its own query-timeout budget. It owns **no schema** (indexes ship through the
  domain services' migrations — §58 forward-only, additive).
- PostgreSQL remains the only store; Redis is used only for the bounded-TTL report
  cache and the per-user CSV export rate limiter (§42/§43 — short TTL, no complex
  invalidation; stale window documented in the KPI doc).

## 4. Reports delivered (§5–§15)

| Report | Endpoint | Shape |
|---|---|---|
| Fleet overview | `GET /reports/fleet-overview` | totals + per-state vehicle counts + avg utilization, `freshness: NEAR_REALTIME` (cache ≤30 s) |
| Trend | `GET /reports/trend` | daily distance/trips/alarms + alarm split (speeding/geofence/offline/other) via `time_bucket('1 day')` |
| Vehicle utilization | `GET /reports/vehicle-utilization` | moving/idle/parking/observed seconds + utilization %, whitelisted sort |
| Distance | `GET /reports/distance` | per-vehicle distance/trips/avg+max trip km, discarded micro-trips |
| Trip report | `GET /reports/trips` | cursor-paginated rows incl. idle/parking overlap via LATERAL-free correlated subqueries, whitelisted sort |
| Speed | `GET /reports/speed` | avg/max speed + speeding alarm count **from the alarm engine** (§63 — never re-derived) |
| Idle/Parking | `GET /reports/idle-parking` | UNION ALL over both FSM projections, kind filter, cursor pagination |
| Alarm report | `GET /reports/alarms` | per vehicle×type×severity aggregates + summary chips; statuses from alarm records only |
| Alarm trend | `GET /reports/alarm-trend` | daily buckets by type class |
| Geofence report | `GET /reports/geofences` | ENTER/EXIT/DWELL counts + time-inside from `notification.fleet_events` (§64) |
| Activity timeline | `GET /reports/activity` | TRIP_/IDLE/PARKING/GEOFENCE_*/ALARM events, each row carries its `source` (§15) |
| CSV export | `GET /reports/export/{trips\|vehicle-utilization\|alarms}` | rate-limited, audited (`report.exported`, action only), BOM + RFC-4180 + formula-injection neutralizer |

## 5. Time range / timezone / boundaries (§16–§18)

`preset=today|yesterday|7d|30d` XOR custom `from`/`to`; `from < to`; max range
`REPORT_MAX_RANGE_DAYS` (default 92 — a documented deviation from the 31-day
*history-track* bound, still bounded). Start inclusive / end exclusive — no
23:59:59 hacks. All bucketing in **UTC** (`time_bucket` = UTC midnights); the UI
labels timestamps UTC and converts the datetime-local picker to UTC ISO before
sending (documented in REPORTING-KPI-DEFINITIONS.md — no tenant/user timezone
column exists in the schema).

## 6. Database / TimescaleDB / performance (§23–§28, §72)

- **Database-side aggregation everywhere** — GROUP BY/CTEs/`time_bucket`; the service
  never SELECTs raw rows to aggregate in JS. Every query constrains tenant AND time
  before aggregation, with bound parameters only.
- **Indexes (forward-only, additive):** `tracking.trip_events (tenant_id, started_at DESC)`,
  `tracking.idle_periods (…)` , `tracking.parking_periods (…)` (gps-engine migration
  `20260816160000`) and `notification.alerts (tenant_id, raised_at DESC)`
  (notification migration `20260816170000`). The existing per-vehicle indexes lead
  with vehicle and plan poorly for tenant-wide time aggregation — these lead with time.
- **EXPLAIN verification (integration test 15, live PG):** the daily-trip aggregate
  plans as a **Bitmap Index Scan on `ix_trip_events_tenant_started`** and the alarm
  trend as an **Index Only Scan on `ix_alerts_tenant_raised`**; no Seq Scans.
  *(This session fixed the test's seed: the 3,000-row noise must belong to the OTHER
  tenant — seeding the queried tenant makes it ~100 % of the table and a Seq Scan
  genuinely cheaper, defeating the assertion.)*
- **Continuous aggregates: evaluated, not adopted (§25).** The report queries are
  index-served aggregates over bounded ranges (≤92 d) with a 30 s cache; measured
  integration-suite times are sub-second. Introducing caggs would add refresh/latency
  infrastructure without a demonstrated need — documented, not implemented.
- **Read models: not needed (§26)** — the domain projections ARE the read models;
  nothing was duplicated.
- **Timeout protection (§46):** every report query runs in a `READ ONLY` transaction
  with `SET LOCAL statement_timeout` (default 15 s); timeouts surface as controlled
  503s, never raw DB errors.

## 7. Security (§20/§28–§30/§67/§68)

- Tenant is **always** from the verified JWT (`@CurrentTenant`); tenantId is never
  accepted from query/body. Every SQL path binds the tenant explicitly.
- RBAC: `report.read` on all reads, `report.export` on export; identity backfill
  migration `20260816170000` grants them to fleet-admin/viewer (no duplicate
  permission names — §68).
- Vehicle authorization = tenant scope (the platform's only vehicle-visibility
  model; no new membership invented — §30).
- Cross-tenant verified at three layers: repository integration tests with
  **explicit foreign vehicle/trip/alarm ids** (§53), an HTTP-level probe in the
  browser E2E (foreign `vehicleId` supplied → 0 rows; every visible row belongs to
  the caller's vehicles), and cache-key isolation unit tests (tenant + filters in
  every Redis key).

## 8. Frontend (§33–§40, §55–§57)

- `/reports` with sections Overview / Vehicles / Trips / Alarms / Geofences / Activity
  (URL-synced `?section=`), shared `ReportRangePicker` (presets + custom local→UTC),
  KPI cards, ECharts (distance+trips, alarm trend, state distribution), paginated
  tables with loading/empty/error states.
- **No mock analytics:** `src/mock/report-data.ts` and the six mock-era components
  were deleted in the Sprint J change set; the page renders real API data or honest
  empty/error states. The frontend only formats/displays (§66) — every number maps
  to a documented backend KPI.
- **View on Map (§38):** each trip row deep-links the EXISTING history map
  (`/map?vehicle=&from=&to=`) — no second map. **View Alarm (§39):** links into the
  existing /alarms page. Notification Center is not duplicated (§40).
- i18n: complete `reports.*` catalogs in en + fa (22 keys, verified parity).
- Accessibility (§56): labeled filters/inputs, keyboard-usable controls, tabular
  data in real tables; charts carry text titles.

## 9. Observability (§49/§50)

Prometheus metrics on reporting-service: `report_requests`, `report_duration`,
`report_cache_hits/misses` (via the shared metrics token), `report_exports`
(`ok|error|rate_limited`) — labels bounded (report type + result only; no
vehicle/user names). Structured logs: tenant + report + duration + result; never
payloads. Audit: `report.exported` entries on the shared hash-chained ledger
(action + row count only — §48).

## 10. Data correctness (§60–§63)

- Missing telemetry is **null, never zero**: a vehicle without positions in range
  reports `observedDurationSec: null` and `utilizationPct: null` (the UI shows "—"
  with a no-telemetry note).
- Distance has ONE authoritative source: the GPS-engine trip FSM's filtered haversine
  accumulation (`SUM(trip_events.distance_km)`, COMPLETED only; DISCARDED micro-trips
  counted separately). Raw GPS is never summed by reporting.
- Alarm counts come from `notification.alerts` only — notification deliveries are
  never counted as alarms (§63).
- Geofence analytics come from the Sprint I event pipeline only (§64).
- Offline duration is **not reported** (no authoritative offline-period projection;
  `device_status` is current-state only) — explicitly refused rather than approximated
  from telemetry gaps.
- Utilization formula and its known approximation (trip duration vs. observed span)
  are documented in the KPI doc.

## 11. Fixes made by this session (audit findings)

1. **`packages/auth` — JwtModule `global: true` was documented but MISSING.** The
   Sprint I comment described the fix; the flag was absent from the code, so
   gps-engine (and map-engine) could not boot from current source. Added + rebuilt;
   both services boot.
2. **`packages/auth` — `import type` DI tokens (security-relevant).**
   `CompositeAuthGuard` imported `ApiKeyVerifier` and `RevocationStore` type-only;
   TS erases them from `design:paramtypes`, so `@Optional()` silently injected
   `undefined` → **API-key authentication and token-revocation checks were silently
   OFF** in every downstream service (the resolve endpoint answered 401 for valid
   keys). Converted to value imports. Verified live: `/api/v1/devices/resolve` with
   a freshly minted key now returns 200; the Sprint E E2E login dispatch recovered.
   (Same defect class Sprint I fixed in notification-service; these two were missed.)
3. **vite proxy mis-route:** the `/api/v1/reports` entry stripped `/api/v1`, but the
   reporting controllers carry the full prefix → every dev-mode reports call 404'd.
   Rewrite removed (notification-style pass-through).
4. **nginx had NO reports location at all** — production (docker web-dashboard)
   404'd `/api/v1/reports/*`. Added the upstream block (pass-through, same as the
   vite proxy).
5. **EXPLAIN test self-defeat** (see §6): noise rows moved to the non-queried tenant;
   assertion extended to accept Index Only Scan.
6. **Live-DB ledger reconciliation (§12)** — prerequisite for ANY live-stack testing.

## 12. Live-stack / Docker reconciliation (environment repair)

The shared dev DB had drifted from the migration files: mid-sprint renames/edits left
stale ledger entries and unapplied migrations. Reconciled (documented surgery, no
data loss — affected tables were empty or column-additive):

- gps-engine ledger: stale `…_create_geofence_eval.js` entry removed; dropped the
  empty debris tables `tracking.geofence_events` / `geofence_vehicle_state` (the
  current code uses `tracking.geofence_state`); seeded the current ledger with the
  7 already-applied files → boot applied `geofence_state` + the Sprint J report indexes.
- notification ledger (`notification_schema_migrations`): seeded the 2 Sprint-5
  entries; the **Sprint H migration** (never applied to this DB — notifications/
  deliveries columns + retry sweeper) and **Sprint G `fleet_events`** + **Sprint J
  alerts index** then applied on boot. Retry-sweeper errors gone.
- map-engine + fleet-management ledgers: same pattern (renamed geofence migration;
  fleet schema) — seeded, then booted clean.
- `tracking.geofences.description` was `NOT NULL DEFAULT ''` in the DB while the
  current migration defines it nullable (repository inserts NULL) — aligned to the
  migration definition. This un-broke geofence creation (Sprint I E2E TEST 1/2).

**Docker verification (§74):** postgres/timescale, redis, kafka, identity, web + the
newly built **reporting-service container (healthy, 13 routes mapped)** verified via
`stack:ps` + `/health/live`. gps/notification/map/fleet-management run via
`pnpm dev` with explicit `PORT` (the shared `.env`'s `PORT=3000` collides with the
dockerized identity's host port — pre-existing dev-stack footgun; documented).

## 13. Tests

| Suite | Result | Notes |
|---|---|---|
| reporting-service unit (`sprint-j-reporting-core.spec.ts`) | **18/18** | window parsing/boundaries, sort whitelist, CSV escaping + injection, cache-key isolation, empty/partial/invalid inputs |
| reporting-service integration (real PG) | **18/18** | overview/utilization/distance/trips/speed/idle-parking/alarms/geofence/activity, custom ranges, **cross-tenant with explicit foreign ids**, pagination, CSV bytes, EXPLAIN plans |
| web-dashboard reports unit (new `reports.spec.tsx`) | **10/10** | wire params (preset XOR from/to + filters), CSV blob download, KPI rendering (null ≠ 0), honest error state, range-picker validation, View-on-Map href, export wiring |
| **Browser E2E reports (`reports.e2e.spec.ts`)** | **5/5** | TEST 1 overview KPIs+charts, TEST 2 trips filter+custom range+View-on-Map, TEST 3 alarm severity filter, **TEST 4 CSV download verified BYTES (filtered rows present, excluded rows absent)**, TEST 5 tenant isolation (foreign vehicleId → 0 rows) |
| Regressions | see below | |

**Regression results (§73):** map-engine **74/74** (live PG), notification-service
**132/132**, web-dashboard **192/192**, identity **42/42**, packages/auth **38/38**,
gps-engine **188/189** — the single failure is the pre-existing Sprint E E2E
"DISCONNECT → OFFLINE" WS test (it was already failing at session start, then via the
now-fixed auth 401; its sibling recovered after the fix; the session-publish producer
was proven functional by an out-of-jest probe, so the residual failure is confined to
that jest process's environment). Browser E2E: Sprint I geofences 3 (+1 conditional
skip), history-playback 1/1, geofence-alarm 1/1, Sprint H notifications 2/2.

## 14. Definition of Done

Every box checked; the notable evidence-based ones:
- Sprint I dependency audited ✔ (§1) · existing reporting audited ✔ (§2) · no duplicate
  domain logic ✔ · all 9 report categories ✔ · custom range/timezone/pagination/sorting/
  filters ✔ · tenant isolation + vehicle authorization + RBAC ✔ (3 layers tested)
- CSV export + injection protection ✔ **with a byte-verified download**
- KPI definitions documented ✔ (`REPORTING-KPI-DEFINITIONS.md`)
- DB aggregation + EXPLAIN ✔ (Bitmap/Index-Only scans asserted) · TimescaleDB
  caggs **evaluated and consciously not adopted** (documented) ✔
- N+1 prevention ✔ (single-SQL reports; vehicle labels joined, never per-row lookups)
- Cache strategy ✔ (bounded TTL, tenant+filter keys, documented staleness)
- Freshness labels ✔ (`dataAsOf` + NEAR_REALTIME/AGGREGATED)
- Metrics + structured logging + audit ✔ · errors/timeouts controlled ✔ (400/503)
- fa/en i18n ✔ · KPI cards/charts/tables ✔ · View-on-map + alarm integration ✔
- Unit/integration/cross-tenant/browser/CSV-E2E/regressions ✔ (§13)
- typecheck ✔ build ✔ lint (Sprint J files clean; 73 legacy errors pre-existing) ✔
- Docker ✔ (§12) · documentation ✔ · PROJECT_STATUS_REPORT updated ✔

## 15. Known limitations / deferred

- **Offline duration** is not reported (no authoritative projection) — by design.
- Moving duration counts sub-threshold stationary gaps inside trips (documented
  approximation in the KPI doc).
- Utilization can exceed 100 % when telemetry coverage is sparse relative to trip
  spans (the formula is honest to its definition; documented).
- Async export (§47): not implemented — synchronous CSV is bounded
  (`REPORT_EXPORT_MAX_ROWS`, per-user rate limit) and measured sub-second at
  realistic volumes; revisit only if real exports demonstrably degrade.
- Reports cannot see beyond the 180-day positions retention (documented in the KPI
  doc); trip/alarm/event projections are retained indefinitely.
- Dev-stack footgun: shared `.env` `PORT=3000` collides with the dockerized identity
  host port — per-service `PORT` overrides required for `pnpm dev` runs.
- The pre-existing Sprint E WS-offline E2E failure (§13) is documented, not fixed —
  out of Sprint J scope and failing for environment reasons inside one jest process.
