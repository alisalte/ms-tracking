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

-- ── Pre-create application roles (bootstrap breaker fix) ────────────────────
-- The identity-service connects as `fleetvision_app` (runtime) and
-- `fleetvision_platform` (migrations + platform ops, BYPASSRLS). Both roles
-- are created idempotently by migration 20260201000000, BUT that migration runs
-- over a `DBURL_PLATFORM` connection that *requires* the platform role to
-- already exist — a bootstrap deadlock on a fresh database.
--
-- Pre-creating both LOGIN roles here (as the bootstrap superuser, before any
-- service starts) breaks the cycle. The migration's `DO $$ ... EXCEPTION WHEN
-- duplicate_object` blocks make this idempotent: they skip creation and only
-- `ALTER ROLE ... PASSWORD` from env, so this is safe alongside the migration.
-- Dev passwords match the compose/migration defaults; production overrides via
-- the secret store (Vault Transit lands in a later sprint).
--
-- fleetvision_app is BYPASSRLS: the hardened RLS tenant-isolation policies
-- expect every read to run inside `withTenantContext` (SET LOCAL
-- app.current_tenant_id), but the services' read paths (list/get/findById
-- prechecks) still rely on the repository-layer `WHERE tenant_id = ?` filter —
-- the documented posture (persistence-knex tenant-context.ts, Sprint B note).
-- With RLS enforced for the app role, every read returned 0 rows (registered
-- devices/vehicles "disappeared"). Revisit once all reads are context-wrapped.
DO $$ BEGIN
  CREATE ROLE fleetvision_app WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'fleetvision_app_dev';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE fleetvision_platform WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'fleetvision_platform_dev';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grant the platform (migration) role the ability to create objects in the
-- schemas the migrations bootstrap into. The first migration creates the iam /
-- audit / etc. schemas and the schema_migrations table itself, so the platform
-- role must be able to CREATE on the database and have CREATE on `public`
-- (where Knex puts schema_migrations before any schema exists). Later grants
-- inside the migration narrow app-role privileges; this only bootstraps.
GRANT ALL PRIVILEGES ON DATABASE fleetvision TO fleetvision_platform;
GRANT USAGE, CREATE ON SCHEMA public TO fleetvision_platform;
