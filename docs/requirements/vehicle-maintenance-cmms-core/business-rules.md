# Business rules

## Confirmed (product / architecture)

| ID | Rule |
|----|------|
| BR-01 | Work order must reference a vehicle in the same tenant. |
| BR-02 | Completed work orders are immutable (INV-M02 intent). |
| BR-03 | Partner CMMS links do not create native WOs automatically (v1). |

## Proposed for v1 (awaiting approval)

| ID | Rule | Proposed default |
|----|------|------------------|
| BR-10 | Status lifecycle | `OPEN` → `ASSIGNED` → `IN_PROGRESS` → `COMPLETED`; or `OPEN`/`ASSIGNED`/`IN_PROGRESS` → `CANCELLED`. No reopen from `COMPLETED`/`CANCELLED`. |
| BR-11 | Skip ASSIGNED | Allowed: `OPEN` → `IN_PROGRESS` directly if no assignee. |
| BR-12 | WO number | Auto-generated per tenant (e.g. `WO-2026-000123`). |
| BR-13 | PM due (time) | Due when `now >= next_due_at`. |
| BR-14 | PM due (odometer) | Due when vehicle odometer ≥ threshold (source: registry meter or last known — lock in questions). |
| BR-15 | PM generates WO | One open preventive WO per schedule at a time (no duplicates while open). |
| BR-16 | Permissions | `maintenance.read` / `maintenance.write` (fleet-admin gets both; viewer read-only optional). |

## Changelog

- 2026-09-09: Draft; BR-10–16 proposed.
