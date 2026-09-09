# Functional requirements

Proposed for CMMS core v1. Implementation detail deferred to analysis.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | System SHALL allow authorized users to create a work order for a vehicle in their tenant. | Must |
| FR-02 | A work order SHALL store at least: vehicle, type, priority, status, title, created time. | Must |
| FR-03 | System SHALL list work orders with filters: status, vehicle, type, date range. | Must |
| FR-04 | System SHALL show work order detail. | Must |
| FR-05 | Authorized users SHALL transition status along the allowed lifecycle (see business rules). | Must |
| FR-06 | Completed and cancelled work orders SHALL not return to open statuses (immutable terminal). | Must |
| FR-07 | System SHALL support WO types corrective, preventive, inspection. | Must |
| FR-08 | System SHALL support priorities low / normal / high / urgent (or equivalent). | Must |
| FR-09 | Authorized users SHALL create/update/disable PM schedules per vehicle (time days and/or odometer km). | Must |
| FR-10 | System SHALL identify due PM schedules and allow generating a preventive WO (automatic or one-click — lock in questions). | Must |
| FR-11 | `/maintenance` SHALL show the native WO board as primary UI (not only UpcomingFeature). | Must |
| FR-12 | Partner CMMS links MAY remain visible as secondary actions. | Should |
| FR-13 | All APIs SHALL enforce tenant isolation from the authenticated principal. | Must |
| FR-14 | Create / complete / cancel SHALL be auditable (who, when, before/after status). | Must |
| FR-15 | Optional: estimated and actual cost on WO (no invoice posting). | Should |
| FR-16 | Optional: free-text assignee or user id on WO. | Should |

## Changelog

- 2026-09-09: Draft for Phase 2 F-06a.
