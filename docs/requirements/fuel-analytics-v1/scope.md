# Scope

## In scope (Fuel Analytics v1)

- Ingest / store **fuel events** tied to tenant + vehicle (and optional device).
- Event kinds at least: **refill**, **drop** (sudden decrease), **level sample** (optional), **manual entry**.
- **Consumption summary** per vehicle over a date range (when refill/level + distance available).
- **Anomaly list**: rapid drops flagged; reuse or link existing `fuel-theft` / device codes `FUEL_*` where applicable.
- Dashboard **Fuel** section or Reports subsection: filters by vehicle / date; EN+FA.
- Permissions `fuel.read` / `fuel.write` (or fleet-admin equivalent).
- Tenant isolation + audit for manual entries.

## Out of scope (v1)

- Fuel **cards**, WEX/Comdata, stations, quotes, price optimization (full module).
- Billing invoice lines from fuel.
- Predictive theft ML models.
- Automatic CMMS work orders from fuel issues.
- Requiring every vehicle to have a fuel sensor (UI must degrade gracefully when no data).

## Future

- Card imports; station map; trip-attributed fuel cost; tighter Meitrack C49 config UI; predictive.

## Changelog

- 2026-09-09: Draft after CMMS skip; Phase 2 → Fuel.
