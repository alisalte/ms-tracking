import { DomainError, type ErrorCode, HttpStatusByCode } from '@fleetvision/shared-kernel';
/**
 * Global exception filter — the seed of the §8 filter chain. Maps thrown errors
 * to the JSON:API error envelope. Sprint 1 keeps this intentionally minimal:
 * Nest's built-in HttpException passes through with its status; everything else
 * becomes a canonical `INTERNAL_ERROR` 500. Later sprints add the domain-error
 * → HTTP mapping, problem-details negotiation, and PII redaction.
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { JsonApiErrorDocument } from './error-envelope.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Domain errors carry a canonical code; map it to the catalog HTTP status.
    if (exception instanceof DomainError) {
      const status =
        HttpStatusByCode[exception.code as ErrorCode] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      this.logger.debug(`Domain ${exception.code}: ${exception.message}`);
      const body: JsonApiErrorDocument = {
        errors: [
          {
            code: exception.code,
            status: String(status),
            title: HttpStatus[status] ?? 'Error',
            detail: exception.message,
            meta: exception.details,
          },
        ],
      };
      if (!response.headersSent) {
        response.status(status).contentType('application/json').json(body);
      }
      return;
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Unexpected (non-HTTP) errors are logged with the stack; HTTP exceptions
    // are operational and logged at debug to avoid log noise from 4xx.
    if (exception instanceof HttpException) {
      this.logger.debug(`HTTP ${status}: ${exception.message}`);
    } else {
      this.logger.error(
        `Unhandled exception: ${(exception as Error).message}`,
        (exception as Error).stack,
      );
    }

    const body: JsonApiErrorDocument = {
      errors: [
        {
          code: status >= 500 ? 'INTERNAL_ERROR' : this.codeForStatus(status),
          status: String(status),
          title: HttpStatus[status] ?? 'Error',
          detail: exception instanceof HttpException ? exception.message : undefined,
        },
      ],
    };

    if (!response.headersSent) {
      response.status(status).contentType('application/json').json(body);
    }
  }

  /** Map a 4xx status to a coarse canonical code; 5xx collapses to INTERNAL_ERROR. */
  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_ERROR';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
