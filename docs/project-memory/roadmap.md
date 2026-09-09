# Roadmap (working)

**Canonical product phases:** `docs/specs/00_Project_Vision.md` §7.

## In progress / requested

- **Fleet Intelligence portfolio Phase 1 (Q0+Q1)** — **Complete** (assignment history, Behavior S1–2, Geofence polish, Health Score v1, Report schedule v1, AI video evidence Slice 1–2). MinIO durable video + schedule email deferred.
- **Phase 2 (Q2)** — Active: **Fuel Analytics v1** — Requirements Approved; analysis `docs/analysis/fuel-analytics-v1/` (waiting implement). CMMS skipped. Then: Geofence corridor → ETA → Behavior Sprint 3.
- **Driver Behavior & Safety Score** — Sprint 1–2 **implemented**. Sprint 3 deferred to Q2.
- **MD300 DMS alarm media capture** — Slice 1–2 implemented; MinIO archive optional follow-up. Requirements: `docs/requirements/md300-dms-alarm-media-capture/`.
- **Driver work / device / alarms** — Analysis: `docs/analysis/driver-work-device-alarms/`. Assignment history shipped; work aggregation still pending.
- **MDVR device-app Parameter config in FleetVision** — Alarm | Network | Tracking | Alerts | Media | AI/C90 shipped. Next candidate: Network+ (A25/ABB). Requirements: `docs/requirements/mdvr-device-app-parameter-config/` (**Approved**). Analysis: `docs/analysis/mdvr-device-app-parameter-config/`.

## Related already in product

- DMS/ADAS alarm decode (event 126) and notification catalog type `dms`.
- Opt-in alarm evidence UI (D00 photo, AB4 clip, nearby AB8 listing).
- Manual D03 photo from alarm drawer.
- Geofence enter/exit/dwell + geofence analytics report; fixed operational reports + CSV.
- Fleet Dashboard “health” panel now includes a **rule-based Fleet Health Score** (connectivity + open alarms). No snapshot persistence / maintenance-backed score yet.
- Map Route Planner OSRM distance/duration (not live ETA).

## Changelog

- 2026-09-09: CMMS skipped by stakeholder; Phase 2 active item → Fuel Analytics v1 SRS draft.
- 2026-09-09: Phase 2 kickoff — CMMS core SRS draft (`docs/requirements/vehicle-maintenance-cmms-core/`); later deferred.
- 2026-09-09: Phase 1 (Q0+Q1) marked complete; Phase 2 (Q2) ready — CMMS first candidate.
- 2026-09-09: Fleet Health Score v1 (60% presence + 40% open-alarm headroom) on FleetHealthPanel.
- 2026-09-09: Geofence report polish (vehicle/geofence filters, avg dwell, dwell-only, map/alarms links).
- 2026-09-09: Driver Behavior Sprint 2 (ranking API/UI, score delta, needsAttention ≤70).
- 2026-09-09: Phase 1 (Q0+Q1) approved; Q0 assignment history + Driver Behavior Sprint 1 implemented.
- 2026-09-08: Fleet Intelligence portfolio analysis + recommended Q0–Q4 re-phasing recorded (`docs/analysis/fleet-intelligence-roadmap/`).
- 2026-09-08: Driver Behavior & Safety Score draft SRS recorded (3-sprint backlog).
- 2026-09-08: Recorded MDVR device-app Parameter config request (SRS draft).
- 2026-09-08: Driver work / device / alarms analysis recorded.
- 2026-09-07: Recorded DMS capture request.
