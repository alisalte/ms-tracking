/**
 * @fleetvision/observability — public surface.
 */
export { LoggerModule, type LoggerModuleOptions, LOGGER_TOKEN } from './logger.module.js';
export { PinoLoggerService } from './logger.service.js';
export { createLogger, type PinoLogger, type LoggerFactoryOptions } from './pino-logger.factory.js';
export {
  CorrelationMiddleware,
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
} from './correlation.middleware.js';
export {
  withCorrelation,
  getCorrelation,
  augmentCorrelation,
  type CorrelationContext,
} from './correlation-context.js';
export { generateTraceparent, parseTraceparent } from './traceparent.js';
export {
  MetricsModule,
  MetricsController,
  METRICS_TOKEN,
  type MetricsModuleOptions,
} from './metrics/metrics.module.js';
export {
  createTelemetryMetrics,
  type TelemetryMetrics,
  type TelemetryMetricsOptions,
} from './metrics/telemetry-metrics.js';
