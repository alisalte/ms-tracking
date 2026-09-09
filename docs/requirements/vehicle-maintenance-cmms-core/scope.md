# Scope

## In scope (CMMS core / F-06a v1)

- Native **work orders** for a tenant: create, list, filter, detail, status transitions.
- WO types: **corrective**, **preventive**, **inspection** (not predictive yet).
- Link WO to **vehicle** (required); optional title, description, priority, due date, assignee label/user id.
- Basic **cost fields** (estimated / actual) optional — no billing integration.
- **Preventive schedules (PM)**: per vehicle, trigger by **time (days)** or **odometer (km)**; generate or suggest a WO when due.
- Replace stub content on `/maintenance` with real board; keep partner logo links in a secondary section.
- Permissions for maintenance read/write (new or reuse fleet-admin grants).
- Tenant isolation; audit of create/complete/cancel.

## Out of scope (v1)

- Parts inventory / stock / PO.
- Full vendor CRM and SLA scoring.
- DVIR / pre-trip inspection forms (compliance context).
- Deep sync API with Pargar/Alka (OAuth, bidirectional WO).
- Predictive / ML-triggered WOs (F-06b / Q3).
- Mobile technician app.
- Changing vehicle status to “out of service” automatically (may be future event).
- Event-sourced immutability engine as in the full module doc — **v1 may use CRUD + status rules** unless analysis chooses ES.

## Future improvements

- Parts + vendors.
- Odometer/engine-hours auto from telemetry for PM due.
- Partner CMMS adapters.
- Predictive recommendations → WO.
- Attach photos / DMS evidence to WO.
- Labor time sheets.

## Changelog

- 2026-09-09: Initial from Phase 2 kickoff (build in-repo CMMS core).
