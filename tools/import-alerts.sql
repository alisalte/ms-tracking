SET app.current_tenant_id = 'c6213758-9f71-460e-a66e-1da2ba6b25b4';
SET app.is_platform = 'true';

BEGIN;

CREATE TEMP TABLE tmp_alerts (
  id uuid, tenant_id uuid, rule_id uuid, type text, severity text, status text, vehicle_id uuid,
  lat float8, lng float8, message text, detail jsonb, source_events jsonb, raised_at timestamptz,
  acknowledged_at timestamptz, acknowledged_by text, resolved_at timestamptz, resolved_by text,
  resolution_reason text
);
\copy tmp_alerts FROM '/tmp/csv/alerts.csv' WITH (FORMAT csv)

INSERT INTO notification.alerts (
  id, tenant_id, rule_id, type, severity, status, vehicle_id, lat, lng, message, detail,
  source_events, raised_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by, resolution_reason
)
SELECT
  id, tenant_id, rule_id, type, severity, status, vehicle_id, lat, lng, message, detail,
  source_events, raised_at,
  acknowledged_at,
  CASE WHEN acknowledged_by <> '' THEN acknowledged_by::uuid ELSE NULL END,
  resolved_at,
  CASE WHEN resolved_by <> '' THEN resolved_by::uuid ELSE NULL END,
  resolution_reason
FROM tmp_alerts;

CREATE TEMP TABLE tmp_notifs (
  id uuid, tenant_id uuid, user_id uuid, category text, severity text, title varchar(256),
  body text, link text, read boolean, read_at timestamptz, source_type text, source_id uuid,
  created_at timestamptz, event_type varchar(64), vehicle_id uuid, metadata jsonb, priority varchar(16)
);
\copy tmp_notifs FROM '/tmp/csv/notifications.csv' WITH (FORMAT csv)

INSERT INTO notification.notifications (
  id, tenant_id, user_id, category, severity, title, body, link, read, read_at,
  source_type, source_id, created_at, event_type, vehicle_id, metadata, priority
)
SELECT id, tenant_id, user_id, category, severity, title, body, link, read, read_at,
       source_type, source_id, created_at, event_type, vehicle_id, metadata, priority
FROM tmp_notifs;

CREATE TEMP TABLE tmp_events (
  id text, tenant_id uuid, vehicle_id uuid, device_id uuid, event_type text,
  occurred_at timestamptz, received_at timestamptz, severity text, metadata jsonb
);
\copy tmp_events FROM '/tmp/csv/fleet_events.csv' WITH (FORMAT csv)

INSERT INTO notification.fleet_events (id, tenant_id, vehicle_id, device_id, event_type, occurred_at, received_at, severity, metadata)
SELECT id, tenant_id, vehicle_id, device_id, event_type, occurred_at, received_at, severity, metadata FROM tmp_events;

COMMIT;

SELECT 'alerts' k, count(*) FROM notification.alerts
UNION ALL SELECT 'notifications', count(*) FROM notification.notifications
UNION ALL SELECT 'fleet_events', count(*) FROM notification.fleet_events
UNION ALL SELECT 'geofences', count(*) FROM tracking.geofences;
