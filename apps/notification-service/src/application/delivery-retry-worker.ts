import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * DeliveryRetryWorker — drains due delivery retries from PostgreSQL
 * (Sprint H §31/§53).
 *
 * Replaces the Sprint 5 in-memory setTimeout retry, which was lost on
 * restart. Workers claim rows with SELECT … FOR UPDATE SKIP LOCKED plus a
 * time lease, so multiple instances never dispatch the same delivery
 * simultaneously. Bounded retries with exponential backoff; permanent
 * errors and exhausted budgets end terminally FAILED (counted as DLQ).
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import type { NotificationProviderRegistry } from './channels/provider-registry.js';
import type { DeliveryExecutor } from './delivery-executor.js';

export interface DeliveryRetryWorkerDeps {
  readonly deliveries: NotificationDeliveryRepository;
  readonly registry: NotificationProviderRegistry;
  readonly executor: DeliveryExecutor;
  readonly metrics: TelemetryMetrics | null;
  readonly intervalMs: number;
  readonly batchSize: number;
}

export class DeliveryRetryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DeliveryRetryWorker');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: DeliveryRetryWorkerDeps) {}

  public onApplicationBootstrap(): void {
    if (this.deps.intervalMs <= 0) {
      this.logger.log('Delivery retry worker disabled (NOTIF_RETRY_WORKER_INTERVAL_MS=0).');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(`Retry sweep failed: ${(err as Error).message}`),
      );
    }, this.deps.intervalMs);
    this.timer.unref();
    this.logger.log(`Delivery retry worker started (interval=${this.deps.intervalMs}ms).`);
  }

  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep — public for tests. */
  public async tick(): Promise<number> {
    if (this.running) return 0; // Never overlap sweeps.
    this.running = true;
    try {
      const claimed = await this.deps.deliveries.claimDueDeliveries(
        this.deps.batchSize,
        // Lease: generous multiple of the expected attempt duration; if the
        // worker dies mid-attempt the row becomes claimable again after this.
        Math.max(this.deps.intervalMs * 4, 60_000),
      );
      for (const { delivery, notification } of claimed) {
        const provider = this.deps.registry.get(delivery.channel);
        if (!provider) {
          // Channel no longer registered (e.g. provider disabled at runtime).
          delivery.markFailed('Provider no longer registered', 'PERMANENT');
          await this.deps.deliveries.updateStatus(delivery);
          this.deps.metrics?.notificationsFailed.inc({ channel: delivery.channel });
          continue;
        }
        try {
          await this.deps.executor.execute(provider, notification, delivery, true);
        } catch (err) {
          this.logger.error(
            `Retry attempt for delivery ${delivery.id} crashed: ${(err as Error).message}`,
          );
        }
      }
      return claimed.length;
    } finally {
      this.running = false;
    }
  }
}
