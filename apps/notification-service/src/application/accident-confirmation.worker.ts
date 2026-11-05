/**
 * Confirms held accident alarms whose vehicle reported nothing before the
 * deadline (see AlarmEvaluatorService.confirmDueAccidentHolds).
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AlarmEvaluatorService } from './alarm-evaluator.service.js';

export class AccidentConfirmationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccidentConfirmationWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly evaluator: AlarmEvaluatorService,
    private readonly intervalMs = 15_000,
  ) {}

  public onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.evaluator
        .confirmDueAccidentHolds()
        .catch((err) =>
          this.logger.error(`Accident confirmation sweep failed: ${(err as Error).message}`),
        );
    }, this.intervalMs);
    this.timer.unref();
    this.logger.log(`Accident confirmation worker started (interval=${this.intervalMs}ms).`);
  }

  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
