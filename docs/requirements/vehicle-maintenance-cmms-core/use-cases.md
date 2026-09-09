# Use cases

## UC-01 — Create corrective work order

1. Manager opens `/maintenance`, clicks Create.
2. Selects vehicle, enters title/priority, saves.
3. WO appears in list as OPEN.

## UC-02 — Progress and complete

1. Manager opens WO, sets ASSIGNED or IN_PROGRESS.
2. Work finishes; status → COMPLETED (optional actual cost).
3. WO no longer editable except read-only history.

## UC-03 — Cancel

1. Open WO is cancelled with reason (optional).
2. Status CANCELLED; terminal.

## UC-04 — Preventive schedule due

1. Manager defines oil-change every 10_000 km (or every 90 days).
2. System marks schedule due.
3. Manager (or system) creates preventive WO linked to schedule.

## UC-05 — Filter board

1. User filters OPEN + one vehicle.
2. Only matching WOs shown.

## UC-06 — Partner escape hatch

1. User still opens Pargar/Alka from secondary links when needed.
2. Native board remains primary.
