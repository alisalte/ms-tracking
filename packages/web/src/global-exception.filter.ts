import {
  DomainError,
  type ErrorCode,
  ErrorCodes,
  HttpStatusByCode,
} from '@fleetvision/shared-kernel';
/**
 * Global exception filter — maps thrown errors to the JSON:API error envelope.
 *
 * Mapping rules (single source of truth = the shared-kernel catalog):
 *   - DomainError → use its `code`, look up the HTTP status in HttpStatusByCode.
 *   - HttpException → use its status; derive the canonical code from a reverse
 *     status→code lookup (no parallel switch to drift from the catalog).
 *   - Zod validation errors carried by a BadRequestException (the ZodValidationPipe
 *     attaches the zod issues) → emit each issue as a JSON:API error with a
 *     `source.pointer` so clients can highlight the offending field.
 *   - Everything else → canonical INTERNAL_ERROR / 500 with NO detail/stack
 *     leakage (never expose SQL, stack traces, or internal paths).
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

/** Reverse map: HTTP status → canonical code, derived from the catalog (no drift). */
const CodeByHttpStatus: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const [code, status] of Object.entries(HttpStatusByCode)) {
    // First code wins for a status; VALIDATION_ERROR claims 400 before BAD_REQUEST
    // is reached in iteration order — that's the intended precedence (a 400 from a
    // zod failure is VALIDATION_ERROR; a generic 400 is BAD_REQUEST).
    if (!(status in map)) map[status] = code;
  }
  // 400 → BAD_REQUEST is the fallback for non-zod 400s; zod 400s set VALIDATION_ERROR
  // explicitly via the zod-issue branch below, so BAD_REQUEST is the generic default.
  map[400] = ErrorCodes.BAD_REQUEST;
  return map;
})();

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

    const body = this.buildBody(exception, status);
    if (!response.headersSent) {
      response.status(status).contentType('application/json').json(body);
    }
  }

  /** Build the JSON:API error document for a non-Domain error. */
  private buildBody(exception: unknown, status: number): JsonApiErrorDocument {
    // 5xx → never leak detail. Generic INTERNAL_ERROR with no message body.
    if (status >= 500) {
      return {
        errors: [
          {
            code: ErrorCodes.INTERNAL_ERROR,
            status: String(status),
            title: HttpStatus[status] ?? 'Error',
          },
        ],
      };
    }

    // Zod validation issues: the ZodValidationPipe throws a BadRequestException
    // whose response carries the zod issues array. Emit one JSON:API error per
    // issue with a source.pointer so clients can highlight the field.
    const zodIssues = extractZodIssues(exception);
    if (zodIssues && zodIssues.length > 0) {
      return {
        errors: zodIssues.map((issue) => ({
          code: ErrorCodes.VALIDATION_ERROR,
          status: String(status),
          title: 'Validation failed.',
          detail: issue.message,
          source: { pointer: issue.path.length > 0 ? `/${issue.path.join('/')}` : undefined },
        })),
      };
    }

    // Generic 4xx → derive the canonical code from the status (no parallel switch).
    const code = CodeByHttpStatus[status] ?? ErrorCodes.INTERNAL_ERROR;
    return {
      errors: [
        {
          code,
          status: String(status),
          title: HttpStatus[status] ?? 'Error',
          detail: exception instanceof HttpException ? exception.message : undefined,
        },
      ],
    };
  }
}

/**
 * If the HttpException carries Zod issues (attached by ZodValidationPipe), extract
 * them. Returns undefined when the exception is not a zod-validation failure.
 */
interface ZodIssueLike {
  message: string;
  path: (string | number)[];
}

function extractZodIssues(exception: unknown): ZodIssueLike[] | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  const res = exception.getResponse();
  if (typeof res !== 'object' || res === null) return undefined;
  const issues = (res as { zodIssues?: unknown }).zodIssues;
  if (!Array.isArray(issues)) return undefined;
  return issues as ZodIssueLike[];
}
