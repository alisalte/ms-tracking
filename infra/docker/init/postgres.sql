-- FleetVision Postgres bootstrap extensions (03_Database_Architecture.md §4).
-- Runs once on first container init (docker-entrypoint-initdb.d).
-- TimescaleDB is preloaded via shared_preload_libraries in the compose command.
--
-- The timescale/timescaledb image bundles timescaledb, pg_trgm, and uuid-ossp.
-- PostGIS is NOT in this image — it ships in a separate postgis image. It is
-- intentionally omitted here; add a `postgis/postgis`-based image if/when a
-- later sprint needs geo functions (the map engine, 09_Map_Engine.md).

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
