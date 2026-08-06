-- FleetVision Postgres bootstrap extensions (03_Database_Architecture.md §4).
-- Runs once on first container init (docker-entrypoint-initdb.d).
-- TimescaleDB is preloaded via shared_preload_libraries in the compose command.
--
-- The timescale/timescaledb-ha image bundles timescaledb, postgis, pg_trgm,
-- uuid-ossp, and more. PostGIS is required by the Map Engine (08_Map_Engine.md)
-- for spatial queries (geofences, POIs, clustering) and by the GPS Engine's
-- vehicle_positions hypertable (geography columns).

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
