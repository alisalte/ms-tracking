# Database impact

## New table (recommended)

`notification.alarm_evidence` (same DB, RLS tenant):

| Column | Notes |
|--------|-------|
| id | uuid PK |
| tenant_id | RLS |
| alert_id | FK-ish to alerts.id (unique) |
| device_id, vehicle_id | denormalized for cooldown queries |
| alarm_type | catalog / DMS detail type for FR-13 |
| status | enum |
| photo_name | from device |
| photo_bytes / photo_content_type | v1 store; later object_key |
| video_object_key | nullable until Slice 2 |
| video_window_from / to | ISO timestamps (5+10) |
| error | text |
| created_at, updated_at, expires_at | expires_at = created + 30d |

## Index

- `(tenant_id, device_id, alarm_type, created_at DESC)` for cooldown
- `(expires_at)` for sweeper
- unique `(alert_id)`

## No change

`notification.alerts` schema optional: denormalized `evidence_status` for list badges (nice-to-have).
