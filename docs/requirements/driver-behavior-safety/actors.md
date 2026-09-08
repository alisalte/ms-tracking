# Actors

Draft — confirm roles and permissions.

| Actor | Responsibility (expected) |
|-------|---------------------------|
| Fleet / safety manager | Views ranking & dashboards; configures notification rules; reviews coaching |
| Dispatcher / operator | Receives notifications; opens driver/event detail; may attach or view evidence |
| Driver | May receive coaching / score summary (unconfirmed whether in-app or external) |
| Tenant admin | Permissions, retention, who can see scores |
| System (platform) | Ingests telemetry/alarms; detects events; computes score; sends notifications; runs ML jobs |
| Device (MDVR / tracker) | Emits speed, motion, idle-related signals / alarms; may capture media |

## Permission themes (unconfirmed)

- Who can see another driver’s score and video evidence.
- Whether drivers see their own ranking relative to peers.
