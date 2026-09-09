/**
 * ReportScheduleWorker — polls due schedules and materializes CSV jobs.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { ReportScheduleService } from './report-schedule.service.js';

export interface ReportScheduleWorkerDeps {
  readonly schedules: ReportScheduleService;
  readonly intervalMs: number;
  readonly batchSize: number;
}

export class ReportScheduleWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReportScheduleWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: ReportScheduleWorkerDeps) {}

  public onApplicationBootstrap(): void {
    if (this.deps.intervalMs <= 0) {
      this.logger.log('Report schedule worker disabled (REPORT_SCHEDULE_WORKER_INTERVAL_MS=0).');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(`Schedule sweep failed: ${(err as Error).message}`),
      );
    }, this.deps.intervalMs);
    this.timer.unref();
    this.logger.log(`Report schedule worker started (interval=${this.deps.intervalMs}ms).`);
  }

  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep — public for tests. */
  public async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.deps.schedules.processDue(this.deps.batchSize);
    } finally {
      this.running = false;
    }
  }
}
