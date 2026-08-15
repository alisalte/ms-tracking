import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * Position pipeline — the staged processor for each inbound position
 * (07 §2, §3, §9.2).
 *
 *   validate → dedupe → persist → trip-engine → cache → broadcast
 *
 *   1. VALIDATE     — range + timestamp gates → quality code (07 §3.3). REJECTED
 *                     positions are dropped.
 *   2. DEDUPE       — skip if (vehicleId, messageId) already seen/persisted
 *                     (07 §3.5; idempotency contract 06 §8.4).
 *   3. PERSIST      — append to TimescaleDB (idempotent on conflict).
 *   4. TRIP ENGINE  — run the trip/idle/parking FSMs + mileage + engine-hours
 *                     (Sprint 8, 07 §5). Runs BEFORE the cache/broadcast gates
 *                     so the FSMs see STALE positions too (a stale gap may
 *                     close a trip). Sprint D §21: an OUT-OF-ORDER position
 *                     (older than the last processed one) is skipped here and
 *                     also skips cache + broadcast — it must not regress the
 *                     latest-position view nor hit the live map.
 *   5. CACHE        — write-through Redis last-position (07 §13.5), only for
 *                     in-order positions.
 *   6. BROADCAST    — emit to the signal bus → WS broadcaster. STALE positions are
 *                     persisted + cached but NOT broadcast (07 §3.4 — stale
 *                     misleads the live map).
 *
 * Sprint D §9 — device liveness: last-seen is flushed to
 * tracking.device_status at most once per GPS_LAST_SEEN_FLUSH_SECONDS per
 * device (throttled, never per packet), so the ONLINE→STALE sweeper and the
 * status API see fresh data without per-position writes.
 *
 * The pipeline throws to the consumer only on PERSIST failure (the consumer's
 * bounded retry + DLQ take over — Sprint D §15); every other stage degrades
 * gracefully so a single bad position never blocks the partition.
 */
import { Logger } from '@nestjs/common';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import type { PositionEvent } from '../domain/position-event.js';
import { validatePosition } from '../domain/quality.js';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import type { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';
import type { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import type { SignalBus } from './signal-bus.js';
import type { TripEngine } from './trip-engine.js';

export interface PositionPipelineDeps {
  readonly config: GpsEngineConfig;
  readonly positions: PositionRepository;
  readonly cache: RedisPositionCache;
  readonly signalBus: SignalBus;
  /** Sprint 8 trip/segmentation engine. */
  readonly tripEngine: TripEngine;
  /** Sprint D §9 — throttled last-seen flush target (optional in tests). */
  readonly deviceStatus?: DeviceStatusRepository | null;
  /** Telemetry metrics (optional). */
  readonly metrics?: TelemetryMetrics | null;
}

export class PositionPipeline {
  private readonly logger = new Logger('PositionPipeline');
  private readonly metrics: TelemetryMetrics | null;
  /** In-process dedupe window ((vehicleId, messageId) awaiting confirmation). */
  private readonly seen = new Set<string>();
  private readonly maxSeen = 10_000;
  /** Per-device last-seen flush throttle (ms epoch → last flush time). */
  private readonly lastSeenFlushedAt = new Map<string, number>();

  constructor(private readonly deps: PositionPipelineDeps) {
    this.metrics = deps.metrics ?? null;
  }

  public async process(event: PositionEvent): Promise<void> {
    // 1. Validate → quality.
    const result = validatePosition(event.latitude, event.longitude, event.capturedAt, new Date(), {
      staleAfterSeconds: this.deps.config.GPS_STALE_AFTER_SECONDS,
      futureThresholdSeconds: this.deps.config.GPS_FUTURE_THRESHOLD_SECONDS,
    });
    if (!result.accepted) {
      this.metrics?.positions.inc({ result: 'rejected' });
      this.logger.debug(`Rejected position ${event.messageId}: ${result.reason}`);
      return;
    }
    const validated = event.withQuality(result.quality);
    if (result.quality === 'STALE') {
      this.metrics?.positions.inc({ result: 'stale' });
    } else {
      this.metrics?.positions.inc({ result: 'accepted' });
    }

    // 2. Dedupe (fast path) — key is (vehicleId, messageId) per 06 §8.4.
    const dedupeKey = `${validated.vehicleId}:${validated.messageId}`;
    if (this.alreadySeen(dedupeKey)) {
      this.metrics?.positions.inc({ result: 'duplicate' });
      this.metrics?.kafkaConsumed.inc({ topic: 'position', result: 'duplicate' });
      this.logger.debug(`Deduped position ${validated.messageId}.`);
      return;
    }

    // 3. Persist (idempotent on the composite event PK). Failures bubble to the
    //    consumer for bounded retry + DLQ (Sprint D §15) — never silent loss.
    try {
      await this.deps.positions.insert(validated);
    } catch (err) {
      this.logger.warn(`Persist failed for ${validated.messageId}: ${(err as Error).message}`);
      throw err;
    }
    this.markSeen(dedupeKey);

    // Sprint D §9 — throttled device last-seen flush (one write per device per
    // GPS_LAST_SEEN_FLUSH_SECONDS; the lifecycle pipeline owns row creation).
    this.flushLastSeenThrottled(validated);

    // 4. Trip engine — run the FSMs + mileage + engine-hours (Sprint 8, 07 §5).
    //    The engine catches its own errors; it reports the §21 out-of-order skip.
    const outcome = await this.deps.tripEngine.process(validated);

    // 5. Cache (best-effort, never throws) — only in-order positions: an older
    //    packet must not regress the latest-position view (Sprint D §21).
    //    (`outcome?.` — a void-returning engine degrades to in-order.)
    if (outcome?.skipped !== 'OUT_OF_ORDER') {
      await this.deps.cache.setLatest(validated);
    }

    // 6. Broadcast — NOT for STALE positions (07 §3.4) nor OUT-OF-ORDER ones
    //    (Sprint D §21 — an old packet must not hit the live map).
    if (validated.quality !== 'STALE' && outcome?.skipped !== 'OUT_OF_ORDER') {
      this.deps.signalBus.emitPosition(validated);
    }
  }

  /** Throttled last-seen update (§9): one DB write per device per window. */
  private flushLastSeenThrottled(position: PositionEvent): void {
    const repo = this.deps.deviceStatus;
    if (!repo) return;
    const now = Date.now();
    const windowMs = this.deps.config.GPS_LAST_SEEN_FLUSH_SECONDS * 1000;
    const key = `${position.tenantId}:${position.vehicleId}`;
    const last = this.lastSeenFlushedAt.get(key) ?? 0;
    if (now - last < windowMs) return;
    this.lastSeenFlushedAt.set(key, now);
    // Bounded map: drop stale throttle entries when large.
    if (this.lastSeenFlushedAt.size > 50_000) {
      const cutoff = now - windowMs;
      for (const [k, t] of this.lastSeenFlushedAt) {
        if (t < cutoff) this.lastSeenFlushedAt.delete(k);
      }
    }
    void repo
      .touchLastSeen(position.tenantId, position.vehicleId, position.capturedAt)
      .catch((err) => {
        this.logger.debug(`last-seen flush failed: ${(err as Error).message}`);
      });
  }

  private alreadySeen(key: string): boolean {
    return this.seen.has(key);
  }

  private markSeen(key: string): void {
    this.seen.add(key);
    // Bounded eviction: drop the oldest entries when the set fills.
    if (this.seen.size > this.maxSeen) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
  }
}
