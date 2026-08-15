import { DomainError } from '@fleetvision/shared-kernel';
import { describe, expect, it } from '@jest/globals';
import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { GlobalExceptionFilter } from '../global-exception.filter.js';

/**
 * Sprint 2 error-response consistency: every canonical code maps to its HTTP
 * status, 5xx errors leak no detail/SQL, zod validation issues produce per-field
 * source.pointer entries, and business-rule violations map to 422 (not 400).
 */

class TestBusinessError extends DomainError {
  public readonly code = 'BUSINESS_RULE_VIOLATION';
  constructor() {
    super('Tenant quota exceeded.');
  }
}

interface JsonApiErr {
  code: string;
  detail?: string;
  source?: { pointer?: string };
}

function runFilter(exception: unknown): { status: number; body: { errors: JsonApiErr[] } } {
  const captured: { status: number; body: { errors: JsonApiErr[] } } = {
    status: 0,
    body: { errors: [] },
  };
  const res: Partial<Response> = {
    headersSent: false,
    status: (code: number) => {
      captured.status = code;
      return res as Response;
    },
    contentType: () => res as Response,
    json: (b: unknown) => {
      captured.body = b as { errors: JsonApiErr[] };
      return res as Response;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  return captured;
}

describe('GlobalExceptionFilter error mapping', () => {
  it('maps a DomainError via its canonical code', () => {
    const { status, body } = runFilter(new TestBusinessError());
    expect(status).toBe(422);
    expect(body.errors[0]?.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('maps NotFoundError → 404, ConflictException → 409, Forbidden → 403, Unauthorized → 401', () => {
    expect(runFilter(new NotFoundException()).status).toBe(404);
    expect(runFilter(new ConflictException()).status).toBe(409);
    expect(runFilter(new ForbiddenException()).status).toBe(403);
    expect(runFilter(new UnauthorizedException()).status).toBe(401);
  });

  it('5xx errors leak NO detail or stack (generic INTERNAL_ERROR)', () => {
    const dbErr = new Error('relation "iam.users" does not exist\nSELECT * FROM iam.users');
    const { status, body } = runFilter(dbErr);
    expect(status).toBe(500);
    expect(body.errors[0]?.code).toBe('INTERNAL_ERROR');
    expect(body.errors[0]?.detail).toBeUndefined();
    // No SQL/table leakage anywhere in the response body.
    expect(JSON.stringify(body)).not.toMatch(/iam\.users|SELECT/);
  });

  it('zod validation issues produce per-field source.pointer errors', () => {
    const exc = new BadRequestException({
      message: 'Validation failed.',
      zodIssues: [
        { message: 'Required', path: ['email'] },
        { message: 'Too short', path: ['password'] },
      ],
    });
    const { status, body } = runFilter(exc);
    expect(status).toBe(400);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0]?.source?.pointer).toBe('/email');
    expect(body.errors[1]?.source?.pointer).toBe('/password');
  });

  it('a generic HttpException 400 maps to BAD_REQUEST (catalog consistency)', () => {
    const { status, body } = runFilter(new HttpException('nope', HttpStatus.BAD_REQUEST));
    expect(status).toBe(400);
    expect(body.errors[0]?.code).toBe('BAD_REQUEST');
  });
});
