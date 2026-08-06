/**
 * Position pipeline — the staged processor for each inbound position
 * (07 §2, §3, §9.2).
 *
 *   validate → dedupe → persist → cache → trip-engine → broadcast
 *
 *   1. VALIDATE     — range + timestamp gates → quality code (07 §3.3). REJECTED
 *                     positions are dropped.
 *   2. DEDUPE       — skip if (vehicleId, messageId) already seen/persisted
 *                     (07 §3.5; idempotency contract 06 §8.4).
 *   3. PERSIST      — append to TimescaleDB (idempotent on conflict).
 *   4. CACHE        — write-through Redis last-position (07 §13.5).
 *   5. TRIP ENGINE  — run the trip/idle/parking FSMs + mileage + engine-hours
 *                     (Sprint 8, 07 §5). Runs BEFORE the broadcast gate so the
 *                     FSMs see STALE positions too (a stale gap may close a trip).
 *   6. BROADCAST    — emit to the signal bus → WS broadcaster. STALE positions are
 *                     persisted + cached but NOT broadcast (07 §3.4 — stale
 *                     misleads the live map).
 *
 * The pipeline never throws on a single bad position; errors are caught and
 * logged so the Kafka consumer advances its offset. Persistence failures bubble
 * (the consumer's eachMessage re-drives on the next poll after back-off).
 */
import { Logger } from '@nestjs/common';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import type { PositionEvent } from '../domain/position-event.js';
import { validatePosition } from '../domain/quality.js';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
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
}

export class PositionPipeline {
  private readonly logger = new Logger('PositionPipeline');
  /** In-process dedupe window (messageIds awaiting DB persistence confirmation). */
  private readonly seen = new Set<string>();
  private readonly maxSeen = 10_000;

  constructor(private readonly deps: PositionPipelineDeps) {}

  public async process(event: PositionEvent): Promise<void> {
    // 1. Validate → quality.
    const result = validatePosition(event.latitude, event.longitude, event.capturedAt, new Date(), {
      staleAfterSeconds: this.deps.config.GPS_STALE_AFTER_SECONDS,
      futureThresholdSeconds: this.deps.config.GPS_FUTURE_THRESHOLD_SECONDS,
    });
    if (!result.accepted) {
      this.logger.debug(`Rejected position ${event.messageId}: ${result.reason}`);
      return;
    }
    const validated = event.withQuality(result.quality);

    // 2. Dedupe (fast path).
    if (this.alreadySeen(validated.messageId)) {
      this.logger.debug(`Deduped position ${validated.messageId}.`);
      return;
    }

    // 3. Persist (idempotent on event_id).
    try {
      await this.deps.positions.insert(validated);
    } catch (err) {
      // Insert failure (e.g. DB down) — do NOT cache/broadcast; let the consumer
      // retry. Log and rethrow so the consumer decides offset advancement.
      this.logger.warn(`Persist failed for ${validated.messageId}: ${(err as Error).message}`);
      throw err;
    }
    this.markSeen(validated.messageId);

    // 4. Cache (best-effort, never throws).
    await this.deps.cache.setLatest(validated);

    // 5. Trip engine — run the FSMs + mileage + engine-hours (Sprint 8, 07 §5).
    //    Runs BEFORE the broadcast gate so the FSMs see STALE positions too (a
    //    stale gap may close a trip). The engine catches its own errors, so a
    //    segmentation failure never blocks the position broadcast.
    await this.deps.tripEngine.process(validated);

    // 6. Broadcast — but NOT for STALE positions (07 §3.4).
    if (validated.quality !== 'STALE') {
      this.deps.signalBus.emitPosition(validated);
    }
  }

  private alreadySeen(messageId: string): boolean {
    return this.seen.has(messageId);
  }

  private markSeen(messageId: string): void {
    this.seen.add(messageId);
    // Bounded eviction: drop the oldest entries when the set fills.
    if (this.seen.size > this.maxSeen) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
  }
}
