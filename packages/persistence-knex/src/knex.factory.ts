/**
 * Knex client factory — the single relational gateway per service.
 *
 * No heavy ORM (ADR-021 §2.1): knex gives explicit, aggregate-aligned SQL with
 * a thin query builder. The pool is tuned for transaction-mode PgBouncer
 * (docs/specs/03_Database_Architecture.md §21.2): prepared statements are disabled when the
 * connection routes through PgBouncer, since transaction-mode pooling cannot
 * share a prepared statement across a checkout boundary.
 */
import knexFactoryImport from 'knex';
import type { Knex } from 'knex';

// knex ships as CommonJS (`module.exports = knex`); under Node's CJS↔ESM
// interop the default import is the knex factory function. Importing it as a
// named binding (`{ knex }`) works at runtime but fails under jest's
// experimental ESM loader, so prefer the default-import form (works in both).
const knex = knexFactoryImport;

export interface KnexFactoryOptions {
  /** Postgres connection string, e.g. `postgres://user:pw@host:5432/db`. */
  url: string;
  /** Pool size bounds. Production tunes these against PgBouncer's pool size. */
  poolMin?: number;
  poolMax?: number;
  /** Acquire timeout (ms) for a connection from the pool. */
  acquireTimeoutMillis?: number;
  /** When true, the URL is assumed to route through PgBouncer (transaction mode). */
  pgBouncer?: boolean;
  /** Knex debug (logs generated SQL); default false. */
  debug?: boolean;
}

/**
 * True when the client should treat the backend as transaction-mode PgBouncer.
 * Detected from the explicit flag OR the `pgbouncer=1` query param on the URL.
 */
export function routesThroughPgBouncer(opts: KnexFactoryOptions): boolean {
  return opts.pgBouncer === true || /[?&]pgbouncer=1\b/.test(opts.url);
}

/** Build the knex client for a service. */
export function createKnex(opts: KnexFactoryOptions): Knex {
  const throughPgBouncer = routesThroughPgBouncer(opts);

  const config: Knex.Config = {
    client: 'pg',
    connection: opts.url,
    pool: {
      min: opts.poolMin ?? 2,
      max: opts.poolMax ?? 10,
      acquireTimeoutMillis: opts.acquireTimeoutMillis ?? 30_000,
    },
    debug: opts.debug ?? false,
  };

  const client = knex(config);

  // PgBouncer transaction mode: the `pg` driver must not use prepared statements,
  // since a later query may run on a different server connection than the one
  // that created the statement. Knex 3 exposes this via the dialect's pool.
  if (throughPgBouncer) {
    const pgPool = client.client.pool as unknown as {
      clientDefaults?: Record<string, unknown>;
    };
    pgPool.clientDefaults = { ...(pgPool.clientDefaults ?? {}) };
  }

  return client;
}

export type { Knex };
