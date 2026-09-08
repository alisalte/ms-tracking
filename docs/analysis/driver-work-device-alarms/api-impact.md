# API impact

| API | Slice |
|-----|-------|
| Keep assign/unassign; write history rows | B |
| `GET /fleet/drivers/:id/assignments` | B |
| `GET /fleet/drivers/:id/work-summary?from&to` (or reporting-service) | C |
| `GET /notification/alerts?driverId=&from&to` and/or stamp on create | D |
| Driver detail aggregate endpoint (optional BFF-style) | C+D |

Wire shapes stay camelCase read / existing snake_case write conventions of fleet-service.
