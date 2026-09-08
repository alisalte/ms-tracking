# Roadmap (working)

**Canonical product phases:** `docs/specs/00_Project_Vision.md` §7.

## In progress / requested (not approved for implementation)

- **Fleet Intelligence portfolio** (Driver Behavior, Fleet Health Score, Fuel, Geofence Intel, Report Builder, Predictive+CMMS, AI Video, Digital Twin, AI Assistant, ETA, Optimization) — inventory shows **none fully shipped**; closest: geofence dwell/reports, fixed reports+CSV, DMS decode+opt-in evidence, OSRM plan duration, connectivity health panel. Analysis + re-phasing Q0–Q4: `docs/analysis/fleet-intelligence-roadmap/`. Status: **waiting on product questions**.
- **Driver Behavior & Safety Score** — Sprint 1: hard brake / overspeed / idle + Driver Score; Sprint 2: ranking, driver dashboard, notifications; Sprint 3: video evidence, AI coaching, ML risk. Requirements: `docs/requirements/driver-behavior-safety/`. Status: **draft SRS**; waiting on critical questions + approval.
- **MD300 DMS alarm media capture** — all DMS + ADAS: driver photo + 15 s cabin video (5+10, with audio), auto platform ingest (sync if offline), 1 min/type cooldown, 30-day retention, click-to-load UI. Requirements: `docs/requirements/md300-dms-alarm-media-capture/`. Status: SRS complete; waiting for approval before analysis.
- **Driver work / device / alarms** — which device a driver uses(d), how much they worked, which alarms they got. Analysis: `docs/analysis/driver-work-device-alarms/`. Status: analysis drafted; waiting on product questions.
- **MDVR device-app Parameter config in FleetVision** — Alarm (incl. Input I/O events) | Network | Tracking | Alerts | Media | AI/C90 shipped. Next candidate: Network+ (A25/ABB). Requirements: `docs/requirements/mdvr-device-app-parameter-config/` (**Approved**). Analysis: `docs/analysis/mdvr-device-app-parameter-config/`.

## Related already in product

- DMS/ADAS alarm decode (event 126) and notification catalog type `dms`.
- Opt-in alarm evidence UI (D00 photo, AB4 clip, nearby AB8 listing).
- Manual D03 photo from alarm drawer.
- Geofence enter/exit/dwell + geofence analytics report; fixed operational reports + CSV.
- Fleet Dashboard connectivity “health” panel (not composite health score).
- Map Route Planner OSRM distance/duration (not live ETA).

## Changelog

- 2026-09-08: Fleet Intelligence portfolio analysis + recommended Q0–Q4 re-phasing recorded (`docs/analysis/fleet-intelligence-roadmap/`).
- 2026-09-08: Driver Behavior & Safety Score draft SRS recorded (3-sprint backlog).
- 2026-09-08: Recorded MDVR device-app Parameter config request (SRS draft).
- 2026-09-08: Driver work / device / alarms analysis recorded.
- 2026-09-07: Recorded DMS capture request.
