/**
 * Deletes expired alarm_evidence rows (30-day retention, F-07).
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AlarmEvidenceRepository } from '../infrastructure/persistence/alarm-evidence.repository.js';

export class EvidenceRetentionWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceRetentionWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly evidence: AlarmEvidenceRepository,
    private readonly intervalMs: number,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) {
      this.logger.log('Evidence retention worker disabled.');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(`Evidence retention failed: ${(err as Error).message}`),
      );
    }, this.intervalMs);
    this.timer.unref();
    this.logger.log(`Evidence retention worker started (interval=${this.intervalMs}ms).`);
  }

  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(): Promise<number> {
    const n = await this.evidence.deleteExpired();
    if (n > 0) this.logger.log(`Purged ${n} expired alarm_evidence row(s).`);
    return n;
  }
}
