# Actors

| Actor | Responsibility |
|-------|----------------|
| Fleet admin / maintenance manager | Create WO, assign, complete, cancel; manage PM schedules |
| Dispatcher / supervisor | View open WOs; update status |
| Technician (optional v1) | View assigned WOs; mark in progress / complete (if given permission) |
| Viewer | Read-only list/detail if granted `maintenance.read` |
| System | Due-PM checker creates or flags due WOs |
| External CMMS (Pargar/Alka) | Optional manual use via links — not an integrated actor in v1 |
