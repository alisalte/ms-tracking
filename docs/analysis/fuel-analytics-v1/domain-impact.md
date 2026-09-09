# Domain impact

| Area | Impact |
|------|--------|
| Fuel (new thin) | `FuelEvent` aggregate; anomaly as flag or read-model |
| Fleet vehicle | Must exist / same tenant for every event |
| Notification | Unchanged alarm path; fuel UI **links** to `fuel-theft` |
| Reporting | New fuel report read model joining events + distance |
| Full Fuel Management module | Explicitly **not** introduced (cards/stations out) |

No change to trip FSM or CMMS.
