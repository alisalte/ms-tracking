# Database impact

| ID | Persistence needs | Notes |
|----|-------------------|-------|
| F-01 | `driving_events`, `driver_scores` (daily/period), optional ranking cache | Prefer Postgres first; ClickHouse later for heavy analytics |
| F-02 | `vehicle_health_snapshots` | Derived; rebuildable |
| F-03 | Fuel tables per `Fuel-Management.md` / DB architecture | New schema; device fuel events may land in Timescale/Kafka first |
| F-04 | Existing geofence + event tables; add corridor / off-route events | PostGIS already used |
| F-05 | `report_templates`, `report_schedules`, `report_jobs` | New in reporting DB |
| F-06 | Work orders, assets, PM schedules; later feature store for RUL | Large new schema |
| F-07 | Media object metadata + retention policy; link `alarm_id` | Evidence already partially file-based |
| F-08 | Twin projection table or materialized view | Cache of joins |
| F-09 | Prompt/action audit log | Mandatory for trust |
| F-10 | Trip ETA history | For accuracy measurement |
| F-11 | Optimization jobs + planned routes | Versioned plans |

Shared prerequisite: **driver assignment history** table/events (see `docs/analysis/driver-work-device-alarms/database-impact.md`).
