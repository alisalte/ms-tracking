/**
 * MetricsModule — exposes the Prometheus registry over GET /metrics.
 *
 * Registers the app's `TelemetryMetrics` as the `METRICS_TOKEN` provider so
 * services increment counters where they live (no central metrics service —
 * Sprint D §33: "use the existing observability stack, keep it small").
 */
import {
  Controller,
  type DynamicModule,
  Get,
  Global,
  Inject,
  Module,
  type Provider,
} from '@nestjs/common';
import type { Registry } from 'prom-client';
import {
  type TelemetryMetrics,
  type TelemetryMetricsOptions,
  createTelemetryMetrics,
} from './telemetry-metrics.js';

export const METRICS_TOKEN = 'FLEETVISION_METRICS';
/**
 * Injection token for the concrete prom-client registry. The controller must
 * inject by token — `Registry` is exported type-only from prom-client, so a
 * class-based paramtype would compile to `Function` and fail DI resolution.
 */
export const METRICS_REGISTRY_TOKEN = 'FLEETVISION_METRICS_REGISTRY';

export interface MetricsModuleOptions {
  readonly telemetry?: TelemetryMetricsOptions;
  /** Expose GET /metrics (default true). */
  readonly exposeEndpoint?: boolean;
}

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS_REGISTRY_TOKEN) private readonly registry: Registry) {}

  /** Prometheus text exposition (content-type negotiated by prom-client). */
  @Get()
  public async prometheus(): Promise<string> {
    return this.registry.metrics();
  }
}

/**
 * Global so the METRICS_TOKEN registered once at the app composition root is
 * injectable from feature modules (notification-service's NotificationModule,
 * gps-engine's feature modules) without each importing MetricsModule — a
 * second import would create a duplicate registry + /metrics controller.
 */
@Global()
@Module({})
export class MetricsModule {
  public static forRoot(options: MetricsModuleOptions = {}): DynamicModule {
    const metrics = createTelemetryMetrics(options.telemetry);
    const metricsProvider: Provider = {
      provide: METRICS_TOKEN,
      useValue: metrics,
    };
    // Bind the concrete registry instance for the /metrics controller.
    const registryProvider: Provider = {
      provide: METRICS_REGISTRY_TOKEN,
      useValue: metrics.registry,
    };
    return {
      module: MetricsModule,
      providers: [metricsProvider, registryProvider],
      controllers: options.exposeEndpoint === false ? [] : [MetricsController],
      exports: [metricsProvider],
    };
  }
}

export { createTelemetryMetrics, type TelemetryMetrics, type TelemetryMetricsOptions };
