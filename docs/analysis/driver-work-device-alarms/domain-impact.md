# Domain impact

- Promote **DriverAssignment** from spec to real aggregate (open/closed intervals).
- Keep **Device** ownership on **Vehicle**.
- Alarm occurrence gains optional durable `driverId` (attribution at raise).
- Work metrics become a **read model** (driver × period), not a new source of truth over GPS.
