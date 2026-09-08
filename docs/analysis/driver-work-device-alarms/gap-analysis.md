# Gap analysis

| Need | Spec / intent | Today | Gap |
|------|---------------|-------|-----|
| Current device | via vehicle | Join driver→vehicle→device | Small (UI polish / deep links) |
| Historical device/vehicle | `DriverAssignment` | Only current FK | **Large** — need history |
| How much worked | trips / meters / HOS | Report proxies **current** vehicle meters | **Large** — attribution by assignment intervals |
| Alarms received | alarm linked to driver | Vehicle alarms; weak driver stamp | **Medium–Large** — resolve assignment at `raisedAt` or stamp `driverId` |
| Driver profile hub | Driver Mgmt BC | Registry + drawer | **Medium** — timeline sections |

## Honest limitation

Without assignment **history** (or ignition-time identity), “چقدر کار کرده” and “چه هشدارهایی گرفته” for past periods cannot be answered correctly if drivers share or rotate vehicles.
