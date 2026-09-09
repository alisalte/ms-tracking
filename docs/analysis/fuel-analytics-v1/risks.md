# Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| No tank liters from device | L/100km empty unless manual | Document; UX prompts manual refill; KPI “events only” when no volumes |
| All `FUEL_*` → one alarm type `fuel-theft` | UX confusion for FILLING/LOW | Fuel events keep precise `device_code`; report labels by code |
| Kafka double-ingest | Duplicate events | Idempotency key |
| Cross-schema reads for reporting | Deploy friction | Grant SELECT; or colocate table in accessible schema |
| Operators expect true burn rate | Misread L/100km | Label as “liters recorded / 100 km” when source=manual |
