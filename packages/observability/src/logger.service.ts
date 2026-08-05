/**
 * NestJS LoggerService adapter over pino.
 *
 * Nest calls `LoggerService` methods everywhere (bootstrap, DI, framework
 * internals). This adapter routes them through pino so every Nest-emitted log
 * also gets structured output + correlation fields.
 *
 * `Optional` so services can `Logger.setLogger(...)` it without breaking apps
 * that haven't registered the module yet (e.g. during a partial bootstrap).
 */
import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import type { PinoLogger } from './pino-logger.factory.js';

const NEST_CONTEXT_DEFAULT = 'Nest';

@Injectable()
export class PinoLoggerService implements NestLoggerService {
  constructor(private readonly logger: PinoLogger) {}

  public log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  public error(message: unknown, trace?: unknown, context?: string): void {
    this.write('error', message, context, trace);
  }

  public warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  public debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  public verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  public fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  /** The underlying pino logger, for direct structured logging when needed. */
  public get pino(): PinoLogger {
    return this.logger;
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    context?: string,
    trace?: unknown,
  ): void {
    // Nest's context string is the "logger name" (class/bundle). pino puts it
    // under `context` per the 01 §11.3 schema (`...message, context`).
    const bindings = {
      context: context ?? NEST_CONTEXT_DEFAULT,
      ...(trace !== undefined ? { trace } : {}),
    };

    if (typeof message === 'string') {
      this.logger[level](bindings, message);
    } else if (message instanceof Error) {
      const errBindings = { ...bindings, err: message };
      this.logger[level](errBindings, message.message);
    } else {
      this.logger[level](bindings, 'object');
      this.logger[level](
        bindings,
        typeof message === 'object' && message !== null ? JSON.stringify(message) : String(message),
      );
    }
  }
}
