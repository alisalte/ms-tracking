# Open questions

## Locked (2026-09-09)

| # | Decision |
|---|----------|
| 1 | Data source: device `FUEL_*` + manual refill |
| Scope | Events + summary + L/100km + anomaly; Reports UI; no cards/stations/billing |
| Phase order | Fuel → Geofence corridor → ETA → Behavior Sprint 3 |

## Remaining (analysis / implement)

| # | Question | Recommended |
|---|----------|-------------|
| A | Without tank liters in Meitrack decode, treat `FUEL_THEFT`/`FUEL_FILLING` as **zero-volume event markers** and rely on **manual liters** for L/100km? | **Yes** for v1 |
| B | Auto-raise notification when ingesting `FUEL_THEFT` if alarm already exists? | **Reuse existing alarm**; fuel UI links to it |
| C | Permissions: new `fuel.read`/`fuel.write` vs reuse `report.read` + `fleet.vehicle.read`? | **`fuel.read` / `fuel.write`** (fleet-admin both) |

Reply **«ادامه تحلیل»** is already in progress; reply **«شروع پیاده‌سازی»** after reviewing analysis.
