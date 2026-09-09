# Business problem

## Why

Fleet operators need to plan and track **vehicle maintenance** inside FleetVision. Today `/maintenance` is an **UpcomingFeature stub** that only deep-links to partner CMMS sites (Pargar / Alka). There is **no** work-order board, schedule, or history in-product.

## Problem

1. Maintenance work is invisible next to live fleet / alarms / trips.
2. Partner portals are disconnected — no vehicle deep-link, no shared status, no health-score / predictive feed.
3. Predictive maintenance (Q3) cannot start without work-order history.

## Who requested

Fleet Intelligence Phase 2 (Q2) kickoff — stakeholder «شروع فاز 2» (2026-09-09). Default: **CMMS core first, build in-repo**.

## Current limitations

- No `vehicle-maintenance-service` in the apps tree.
- Dashboard maintenance card / page wait on backend.
- Full module design exists on paper (`docs/modules/Vehicle-Maintenance.md`) but is not implemented.
