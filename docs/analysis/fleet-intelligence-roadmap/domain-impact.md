# Domain impact

| ID | Primary contexts | Notes |
|----|------------------|-------|
| F-01 | Driver Management, Analytics, Alarms | Needs `DrivingEvent`, `BehaviorScore`; assignment history |
| F-02 | Fleet / Telemetry, Maintenance, Alarms | Score is a projection over multiple contexts |
| F-03 | Fuel Management (new in code) | Module design exists; app does not |
| F-04 | Tracking / Map / GPS Engine | Extend geofence + trip adherence |
| F-05 | Reporting | Extend Reporting aggregate with Schedule/Template |
| F-06 | Vehicle Maintenance, CMMS, Analytics | Split “CMMS core” vs “predictive” |
| F-07 | Video Platform, Alarms, Device Gateway | Evidence + DMS policy |
| F-08 | Cross-cutting read model | Not a vision-named context; treat as projection |
| F-09 | Analytics + IAM | Assistant is UX over domain APIs |
| F-10 | GPS Engine, Map Engine, Trip/Route | Live ETA events |
| F-11 | Trip/Route Management | Optimization = planning BC |

Canonical inventory: `docs/specs/00_Project_Vision.md` §6; designs under `docs/modules/`.
