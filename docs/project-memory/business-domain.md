# Business Domain

**Canonical:** `docs/specs/00_Project_Vision.md`, `docs/specs/02_Domain_Model.md`

## Core concepts

| Term | Meaning |
|---|---|
| Tenant | Isolated fleet customer |
| Vehicle | Asset tracked by one or more devices |
| Device | Hardware unit (e.g. Meitrack MD300 MDVR) identified by IMEI |
| Alarm / Alert | Actionable safety or operations event after rule/engine processing |
| DMS | Driver Monitoring System — cabin AI (fatigue, phone, smoking, absence, …) |
| ADAS | Forward-looking driver assistance (FCW, LDW, …); on MD300 shares event 126 with DMS |
| Evidence | Photo and/or video proving what happened at alarm time |
| Driver assignment | Driver ↔ vehicle link (current FK today; history planned). Device is reached only via the vehicle. |
| Driver work (ops) | Moving/idle/distance attributed to a driver by intersecting assignment intervals with vehicle telemetry — not the same as regulatory HOS unless explicitly required. |
| Driver Score | Composite safety score from behavior events (hard brake, overspeed, idle, …) — requirements draft: `docs/requirements/driver-behavior-safety/`. |

## Safety policy already stated

Driver-facing frames are not persisted unless an alert is raised; then only the event clip/snapshot. See `docs/modules/VideoPlatform.md` and `docs/specs/10_Live_Video.md`.

## Changelog

- 2026-09-08: Driver Score / behavior-safety backlog noted.
- 2026-09-07: Initial domain notes.
