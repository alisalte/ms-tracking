# Assumptions

| # | Assumption | Status |
|---|------------|--------|
| A1 | Phase 2 starts with **CMMS core**, build **in-repo** (not vendor API first) | Proposed default from kickoff |
| A2 | v1 does not need full event sourcing; CRUD + status guards enough | Proposed |
| A3 | New service `vehicle-maintenance-service` (or equivalent Nest app) owns `maintenance` schema | Proposed (matches architecture docs) |
| A4 | Odometer for PM can initially use fleet vehicle meter / reporting meters | Proposed |
| A5 | Partner portals stay as external links only | Proposed |
| A6 | Predictive maintenance is out until WO history exists | Confirmed by portfolio plan |

Never treat proposed assumptions as approved until stakeholder locks them.
