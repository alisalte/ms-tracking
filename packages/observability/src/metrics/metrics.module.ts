/**
 * MetricsModule — exposes the Prometheus registry over GET /metrics.
 *
 * Registers the app's `TelemetryMetrics` as the `METRICS_TOKEN` provider so
 * services increment counters where they live (no central metrics service —
 * Sprint D §33: "use the existing observability stack, keep it small").
 */
import { Controller, type DynamicModule, Get, Module, type Provider } from '@nestjs/common';
import type { Registry } from 'prom-client';
import {
  type TelemetryMetrics,
  type TelemetryMetricsOptions,
  createTelemetryMetrics,
} from './telemetry-metrics.js';

export const METRICS_TOKEN = 'FLEETVISION_METRICS';

export interface MetricsModuleOptions {
  readonly telemetry?: TelemetryMetricsOptions;
  /** Expose GET /metrics (default true). */
  readonly exposeEndpoint?: boolean;
}

@Controller('metrics')
export class MetricsController {
  constructor(private readonly registry: Registry) {}

  /** Prometheus text exposition (content-type negotiated by prom-client). */
  @Get()
  public async prometheus(): Promise<string> {
    return this.registry.metrics();
  }
}

@Module({})
export class MetricsModule {
  public static forRoot(options: MetricsModuleOptions = {}): DynamicModule {
    const metricsProvider: Provider = {
      provide: METRICS_TOKEN,
      useFactory: () => createTelemetryMetrics(options.telemetry),
    };
    return {
      module: MetricsModule,
      providers: [metricsProvider],
      controllers: options.exposeEndpoint === false ? [] : [MetricsController],
      exports: [metricsProvider],
    };
  }
}

export { createTelemetryMetrics, type TelemetryMetrics, type TelemetryMetricsOptions };
