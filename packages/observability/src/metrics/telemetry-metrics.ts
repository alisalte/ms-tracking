/**
 * Telemetry metrics — minimal Prometheus counters/gauges for the telemetry
 * pipeline (Sprint D §33).
 *
 * Deliberately small: a single registry per process + the handful of metrics
 * the telemetry vertical needs (gateway connections, Kafka produce/consume
 * outcomes, GPS processing, WebSocket fan-out). No histograms-beyond-latency,
 * no exemplars, no push-gateway — the exposition endpoint is served by
 * `MetricsController` (GET /metrics).
 *
 * All labels are bounded enums (topic/result/class) — no unbounded label
 * values (IMEIs, tenant ids, vehicle ids are NEVER label values), so the
 * registry cannot cardinality-explode.
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface TelemetryMetrics {
  readonly registry: Registry;

  // --- Gateway (device connections + registry) -----------------------------
  /** Connection attempts by outcome (accepted | rejected_pool_full). */
  readonly gatewayConnections: Counter<string>;
  /** Sessions closed as duplicates (new connection replaced old). */
  readonly gatewayDuplicateConnections: Counter<string>;
  /** Device-registry resolves by outcome (hit_l1 | hit_l2 | miss | error). */
  readonly registryResolves: Counter<string>;
  /** Kafka messages produced by topic × outcome (ok | error). */
  readonly kafkaProduced: Counter<string>;

  // --- Kafka consumer (gps-engine) ------------------------------------------
  /** Messages consumed by topic × outcome (processed | duplicate | dlq | dropped). */
  readonly kafkaConsumed: Counter<string>;
  /** Processing retries by topic. */
  readonly kafkaRetries: Counter<string>;
  /** Messages sent to the DLQ by topic. */
  readonly dlqMessages: Counter<string>;
  /** Position processing latency (parse→persist→broadcast), seconds. */
  readonly processingLatency: Histogram<string>;

  // --- GPS pipeline ----------------------------------------------------------
  /** Positions by outcome (accepted | rejected | stale | out_of_order | duplicate). */
  readonly positions: Counter<string>;

  // --- WebSocket -------------------------------------------------------------
  /** Currently connected WS clients. */
  readonly wsClients: Gauge<string>;
  /** Active room subscriptions. */
  readonly wsSubscriptions: Gauge<string>;
  /** Position updates dropped by coalescing (back-pressure). */
  readonly wsDroppedUpdates: Counter<string>;
}

export interface TelemetryMetricsOptions {
  /** Metric name prefix, e.g. 'fleetvision' → fleetvision_kafka_produced_total. */
  readonly prefix?: string;
  /** Include Node.js default metrics (process/event-loop). Default true. */
  readonly defaultMetrics?: boolean;
}

const GATEWAY_TOPICS = ['position', 'alarm', 'device', 'commandAck', 'session'] as const;
const CONSUME_TOPICS = ['position', 'session'] as const;

/** Create the telemetry metric set on a fresh registry. */
export function createTelemetryMetrics(options: TelemetryMetricsOptions = {}): TelemetryMetrics {
  const prefix = options.prefix ?? 'fleetvision';
  const registry = new Registry();
  if (options.defaultMetrics !== false) {
    collectDefaultMetrics({ register: registry, prefix: `${prefix}_node` });
  }

  const labelNames = ['topic', 'result'] as const;

  const gatewayConnections = new Counter({
    name: `${prefix}_gateway_connections_total`,
    help: 'Device connection attempts by outcome.',
    labelNames: ['result'],
    registers: [registry],
  });

  const gatewayDuplicateConnections = new Counter({
    name: `${prefix}_gateway_duplicate_connections_total`,
    help: 'Sessions closed because a newer connection for the same device replaced them.',
    labelNames: ['scope'],
    registers: [registry],
  });

  const registryResolves = new Counter({
    name: `${prefix}_registry_resolves_total`,
    help: 'Device-registry resolutions by cache tier / outcome.',
    labelNames: ['result'],
    registers: [registry],
  });

  const kafkaProduced = new Counter({
    name: `${prefix}_kafka_produced_total`,
    help: 'Kafka messages produced by topic and outcome.',
    labelNames: [...labelNames],
    registers: [registry],
  });

  const kafkaConsumed = new Counter({
    name: `${prefix}_kafka_consumed_total`,
    help: 'Kafka messages consumed by topic and outcome.',
    labelNames: [...labelNames],
    registers: [registry],
  });

  const kafkaRetries = new Counter({
    name: `${prefix}_kafka_retries_total`,
    help: 'In-process message processing retries by topic.',
    labelNames: ['topic'],
    registers: [registry],
  });

  const dlqMessages = new Counter({
    name: `${prefix}_dlq_messages_total`,
    help: 'Messages routed to the dead-letter topic by original topic.',
    labelNames: ['topic'],
    registers: [registry],
  });

  const processingLatency = new Histogram({
    name: `${prefix}_processing_latency_seconds`,
    help: 'End-to-end position processing latency (consumer → pipeline).',
    labelNames: ['topic'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const positions = new Counter({
    name: `${prefix}_positions_total`,
    help: 'Positions processed by outcome.',
    labelNames: ['result'],
    registers: [registry],
  });

  const wsClients = new Gauge({
    name: `${prefix}_ws_clients`,
    help: 'Currently connected WebSocket clients.',
    registers: [registry],
  });

  const wsSubscriptions = new Gauge({
    name: `${prefix}_ws_subscriptions`,
    help: 'Active WebSocket room subscriptions.',
    registers: [registry],
  });

  const wsDroppedUpdates = new Counter({
    name: `${prefix}_ws_dropped_updates_total`,
    help: 'Position updates superseded (dropped) by coalescing back-pressure.',
    registers: [registry],
  });

  // Pre-seed the bounded label domains so early scrapes expose complete series.
  for (const result of ['accepted', 'rejected_pool_full']) gatewayConnections.inc({ result }, 0);
  for (const scope of ['local', 'cross_instance']) {
    gatewayDuplicateConnections.inc({ scope }, 0);
  }
  for (const result of ['hit_l1', 'hit_l2', 'miss', 'error']) registryResolves.inc({ result }, 0);
  for (const topic of GATEWAY_TOPICS) {
    for (const result of ['ok', 'error']) kafkaProduced.inc({ topic, result }, 0);
  }
  for (const topic of CONSUME_TOPICS) {
    for (const result of ['processed', 'duplicate', 'dlq', 'dropped']) {
      kafkaConsumed.inc({ topic, result }, 0);
    }
    kafkaRetries.inc({ topic }, 0);
    dlqMessages.inc({ topic }, 0);
    processingLatency.observe({ topic }, 0);
  }
  for (const result of ['accepted', 'rejected', 'stale', 'out_of_order', 'duplicate']) {
    positions.inc({ result }, 0);
  }

  return {
    registry,
    gatewayConnections,
    gatewayDuplicateConnections,
    registryResolves,
    kafkaProduced,
    kafkaConsumed,
    kafkaRetries,
    dlqMessages,
    processingLatency,
    positions,
    wsClients,
    wsSubscriptions,
    wsDroppedUpdates,
  };
}
