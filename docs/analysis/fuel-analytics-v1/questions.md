# Questions (analysis)

Defaults recommended — confirm or override before implement.

| # | Question | Default |
|---|----------|---------|
| 1 | Schema `fuel.fuel_events` vs `fleet.fuel_events`? | **`fuel.fuel_events`** |
| 2 | Report gate: `fuel.read` only vs also `report.read`? | **`fuel.read`** (and show section if has it) |
| 3 | Ingest consumer in fleet-service vs notification-service side-effect? | **fleet-service** consumer |
| 4 | L/100km = liters_in / distance only (ignore drops)? | **Yes** for v1 |
| 5 | CSV export in Slice 3? | **Yes** (Should) |

Reply **«شروع پیاده‌سازی»** / **Analysis Approved** (optionally with overrides) to unlock coding.
