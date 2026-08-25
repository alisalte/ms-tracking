-- Import generated fleet history CSVs into FleetVision tracking tables.
-- Run inside the fleetvision-postgres container:
--   docker exec -i fleetvision-postgres psql -U fleetvision -d fleetvision \
--     -v ON_ERROR_STOP=1 < tools/import-history.sql  < /tmp/csv/*.csv handled via \copy below
SET app.current_tenant_id = '50096a74-3a5d-4c9f-a5ed-4895fa19e8ae';

BEGIN;

CREATE TEMP TABLE tmp_positions (
  event_id uuid, vehicle_id uuid, tenant_id uuid, captured_at timestamptz, ingested_at timestamptz,
  latitude float8, longitude float8, altitude_m float4, heading_deg float4, speed_kmh float4,
  accuracy_m float4, odometer_km float8, ignition_on boolean, source_device uuid, quality smallint,
  session_id uuid, metadata jsonb
);
\copy tmp_positions FROM '/tmp/csv/positions.csv' WITH (FORMAT csv)

INSERT INTO tracking.vehicle_positions (
  event_id, vehicle_id, tenant_id, captured_at, ingested_at, geom, latitude, longitude,
  altitude_m, heading_deg, speed_kmh, accuracy_m, odometer_km, ignition_on, source_device,
  quality, session_id, metadata
)
SELECT event_id, vehicle_id, tenant_id, captured_at, ingested_at,
       ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
       latitude, longitude, altitude_m, heading_deg, speed_kmh, accuracy_m, odometer_km,
       ignition_on, source_device, quality, session_id, metadata
FROM tmp_positions;

CREATE TEMP TABLE tmp_trips (
  id uuid, tenant_id uuid, vehicle_id uuid, status text, started_at timestamptz, ended_at timestamptz,
  start_lat float8, start_lng float8, end_lat float8, end_lng float8, distance_km float8,
  duration_s int, max_speed_kmh float4, stop_count int, created_at timestamptz,
  updated_at timestamptz, source_event_id uuid
);
\copy tmp_trips FROM '/tmp/csv/trips.csv' WITH (FORMAT csv)
INSERT INTO tracking.trip_events SELECT * FROM tmp_trips;

CREATE TEMP TABLE tmp_parking (
  id uuid, tenant_id uuid, vehicle_id uuid, status text, started_at timestamptz, ended_at timestamptz,
  duration_s int, lat float8, lng float8, created_at timestamptz
);
\copy tmp_parking FROM '/tmp/csv/parking.csv' WITH (FORMAT csv)
INSERT INTO tracking.parking_periods (id, tenant_id, vehicle_id, status, started_at, ended_at, duration_s, lat, lng, created_at)
SELECT id, tenant_id, vehicle_id, status, started_at, ended_at, duration_s, lat, lng, created_at FROM tmp_parking;

CREATE TEMP TABLE tmp_idle (
  id uuid, tenant_id uuid, vehicle_id uuid, started_at timestamptz, ended_at timestamptz,
  duration_s int, alerted boolean, created_at timestamptz
);
\copy tmp_idle FROM '/tmp/csv/idle.csv' WITH (FORMAT csv)
INSERT INTO tracking.idle_periods (id, tenant_id, vehicle_id, started_at, ended_at, duration_s, alerted, created_at)
SELECT id, tenant_id, vehicle_id, started_at, ended_at, duration_s, alerted, created_at FROM tmp_idle;

CREATE TEMP TABLE tmp_engine (
  id uuid, tenant_id uuid, vehicle_id uuid, window_start timestamptz, window_end timestamptz,
  duration_s int, engine_hours numeric, source_event_id uuid, created_at timestamptz
);
\copy tmp_engine FROM '/tmp/csv/engine_hours.csv' WITH (FORMAT csv)
INSERT INTO tracking.engine_hours (id, tenant_id, vehicle_id, window_start, window_end, duration_s, engine_hours, source_event_id, created_at)
SELECT id, tenant_id, vehicle_id, window_start, window_end, duration_s, engine_hours, source_event_id, created_at FROM tmp_engine;

CREATE TEMP TABLE tmp_devstatus (
  device_id uuid, tenant_id uuid, state text, protocol_id text, reason text,
  last_seen_at timestamptz, updated_at timestamptz
);
\copy tmp_devstatus FROM '/tmp/csv/device_status.csv' WITH (FORMAT csv)
INSERT INTO tracking.device_status (device_id, tenant_id, state, protocol_id, reason, last_seen_at, updated_at)
SELECT device_id, tenant_id, state, protocol_id, reason, last_seen_at, updated_at FROM tmp_devstatus
ON CONFLICT (device_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, state = EXCLUDED.state;

-- Keep fleet.devices.last_seen_at in sync with the backfilled telemetry.
UPDATE fleet.devices d
SET last_seen_at = s.last_seen_at
FROM (SELECT source_device AS dev, max(captured_at) AS last_seen_at FROM tracking.vehicle_positions GROUP BY 1) s
WHERE d.id = s.dev AND (d.last_seen_at IS NULL OR d.last_seen_at < s.last_seen_at);

COMMIT;

SELECT 'positions' k, count(*) FROM tracking.vehicle_positions
UNION ALL SELECT 'trips', count(*) FROM tracking.trip_events
UNION ALL SELECT 'parking', count(*) FROM tracking.parking_periods
UNION ALL SELECT 'idle', count(*) FROM tracking.idle_periods
UNION ALL SELECT 'engine_hours', count(*) FROM tracking.engine_hours
UNION ALL SELECT 'device_status', count(*) FROM tracking.device_status;
