/**
 * ioredis client factory — the shared cache/coordination layer per service.
 *
 * One client per service connects to the platform Redis (01 §4.2). The client is
 * lazy: it reconnects automatically with a capped backoff, so a transient Redis
 * outage degrades (cache misses) rather than crashing the service.
 */
import { Redis, type RedisOptions } from 'ioredis';

export interface RedisFactoryOptions {
  /** Redis connection URL, e.g. `redis://host:6379/0`. */
  url: string;
  /** Optional per-instance key prefix (namespace by service/environment). */
  keyPrefix?: string;
  /** Enable ioredis auto-pipelining for high-throughput workloads. */
  autoPipelining?: boolean;
  /** Connect/retry overrides forwarded to ioredis. */
  connectTimeoutMillis?: number;
  maxRetriesPerRequest?: number;
}

/** Build a configured ioredis client. */
export function createRedisClient(opts: RedisFactoryOptions): Redis {
  const options: RedisOptions = {
    lazyConnect: false,
    maxRetriesPerRequest: opts.maxRetriesPerRequest ?? 3,
    connectTimeout: opts.connectTimeoutMillis ?? 10_000,
    enableAutoPipelining: opts.autoPipelining ?? false,
    keyPrefix: opts.keyPrefix,
  };

  const client = new Redis(opts.url, options);

  client.on('error', (err: Error) => {
    // ioredis emits errors asynchronously; swallow here so an unhandled
    // EventEmitter error never crashes the process. Health checks surface the
    // real connectivity state (see @fleetvision/health).
    void err;
  });

  return client;
}

export type { Redis } from 'ioredis';
