import type { BaseConfig, TypedConfigService } from '@fleetvision/config';
/**
 * LoggerModule — provides a global pino logger + wires the Nest LoggerService
 * override + correlation middleware.
 *
 * Usage:
 *   LoggerModule.forRoot({ serviceName: 'identity-service', level: 'info' })
 *
 * The module reads its level/serviceName from the typed ConfigService when
 * available, or from explicit options. It is `@Global()` so the logger is
 * injectable everywhere without re-importing.
 */
import {
  type DynamicModule,
  Global,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  type Provider,
} from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware.js';
import { PinoLoggerService } from './logger.service.js';
import { type PinoLogger, createLogger } from './pino-logger.factory.js';

export const LOGGER_TOKEN = 'FLEETVISION_LOGGER';

export interface LoggerModuleOptions {
  serviceName: string;
  level: string;
  environment?: string;
  /** Override pretty-printing (default: pretty in local/dev). */
  pretty?: boolean;
}

@Global()
@Module({})
export class LoggerModule implements NestModule {
  private static configureConsumer?: (consumer: MiddlewareConsumer) => void;

  public static forRoot(options: LoggerModuleOptions): DynamicModule {
    const logger = createLogger({
      serviceName: options.serviceName,
      level: options.level,
      environment: options.environment,
      pretty: options.pretty,
    });

    const loggerProvider: Provider = { provide: LOGGER_TOKEN, useValue: logger };
    const loggerServiceProvider: Provider = {
      provide: PinoLoggerService,
      useFactory: () => new PinoLoggerService(logger),
    };

    // Remember how to apply the middleware; applied when the module is consumed.
    LoggerModule.configureConsumer = (consumer) => {
      consumer.apply(CorrelationMiddleware).forRoutes('*');
    };

    return {
      module: LoggerModule,
      global: true,
      providers: [loggerProvider, loggerServiceProvider],
      exports: [LOGGER_TOKEN, PinoLoggerService],
    };
  }

  /**
   * Convenience: build the module from a typed ConfigService (preferred when the
   * config module is already loaded). Resolves serviceName/level/environment.
   */
  public static forRootFromConfig(config: BaseConfig): DynamicModule {
    return LoggerModule.forRoot({
      serviceName: config.serviceName,
      level: config.LOG_LEVEL,
      environment: config.ENVIRONMENT,
    });
  }

  public configure(consumer: MiddlewareConsumer): void {
    LoggerModule.configureConsumer?.(consumer);
  }

  public static extractFrom(config: TypedConfigService<BaseConfig>): LoggerModuleOptions {
    const c = config.all;
    return { serviceName: c.serviceName, level: c.LOG_LEVEL, environment: c.ENVIRONMENT };
  }

  // Required by NestModule interface signature.
  public apply(..._middlewares: unknown[]): this {
    return this;
  }

  public forRoutes(..._routes: unknown[]): this {
    return this;
  }

  /** Expose the raw logger type for type-only imports. */
  public static get loggerType(): PinoLogger | undefined {
    return undefined;
  }
}
