# Requirements — capability definitions

Source backlog (user labels). Definitions below are the **product meaning** assumed for gap analysis; confirm in `questions.md`.

## Phase A labels (user: “ارزش سریع”)

| ID | Capability | Operator outcome |
|----|------------|------------------|
| F-01 | **Driver Behavior** | Detect hard brake / overspeed / idle (and related), compute Driver Score, ranking, optional coaching + evidence |
| F-02 | **Fleet Health Score** | Per-vehicle and fleet-level composite health (connectivity + faults + maintenance risk), not only online/offline counts |
| F-03 | **Fuel Analytics** | Consumption, efficiency, refill anomalies / theft signals, reports and alerts |
| F-04 | **Geofence Intelligence** | Beyond CRUD enter/exit: dwell analytics, route/corridor compliance, zone performance |
| F-05 | **Report Builder** | Custom report composition, schedule/delivery, multi-format export (not only fixed sections + CSV) |

## Phase B labels (user: Phase 2)

| ID | Capability | Operator outcome |
|----|------------|------------------|
| F-06 | **Predictive Maintenance + CMMS** | Work orders / inspections + failure probability / RUL; integrate or replace partner CMMS |
| F-07 | **AI Video Events** | Reliable DMS/ADAS event pipeline with auto evidence; optional cloud AI beyond on-device |
| F-08 | **Digital Twin** | Continuously synced virtual vehicle/fleet state for simulation, what-if, and ops mirror |

## Phase C labels (user: Phase 3)

| ID | Capability | Operator outcome |
|----|------------|------------------|
| F-09 | **AI Fleet Assistant** | Natural-language ops assistant over fleet data (ask / act with guardrails) |
| F-10 | **ETA Prediction** | Live en-route ETA with traffic/history/driver factors, not static plan duration |
| F-11 | **Optimization Engine** | Multi-stop / fleet dispatch optimization (VRP-class), not point-to-point OSRM |

## Alignment to canonical vision

| ID | Vision catalogue (`00_Project_Vision.md` §5.2) | Vision phase |
|----|-----------------------------------------------|--------------|
| F-01 | Driver behavior scoring | P2 |
| F-02 | Live fleet dashboard & health (narrower than “score”) | P1 precursor |
| F-03 | Fuel management & fraud | P3 |
| F-04 | Geofences, POIs & zones (+ analytics stretch) | P1 + stretch |
| F-05 | Operational & executive analytics / scheduled reports | P4 (scheduled); fixed reports earlier |
| F-06 | PM work orders P2; predictive maintenance P4 | P2 → P4 |
| F-07 | AI dashcam events | P3 |
| F-08 | Not named in vision | Unscoped |
| F-09 | Not named in vision | Unscoped |
| F-10 | Implied under tracking / trip / map | Design-only |
| F-11 | Implied under trip/route management | Design-only |
