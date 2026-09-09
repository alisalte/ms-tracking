# Requirements (analysis mirror)

From approved SRS + stakeholder lock:

1. Persist fuel events: refill, sudden drop, manual.
2. Consumption summary; L/100km when distance available.
3. Rapid-drop / theft aligned with `FUEL_*` (`FUEL_THEFT`, `FUEL_FILLING`, `FUEL_LOW`, `FUEL_FULL`).
4. UI under Reports (fuel section); no fuel cards, stations, WEX, billing.
5. Tenant isolation; EN/FA; empty state when no data.

Phase 2 after this: Geofence corridor → ETA → Behavior Sprint 3. CMMS skipped.
