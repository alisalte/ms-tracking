/**
 * Correlation middleware — installs the per-request correlation context from
 * inbound headers (X-Request-Id, W3C traceparent) before handlers run.
 *
 * This is the inbound side of 01 §11.3 + API_Design §2.2: every request gets an
 * `X-Request-Id` (generated if absent) echoed on the response, and a W3C
 * `traceparent` propagated to downstream gRPC/Kafka calls.
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { augmentCorrelation, withCorrelation } from './correlation-context.js';
import { generateTraceparent, parseTraceparent } from './traceparent.js';

export const REQUEST_ID_HEADER = 'x-request-id';
export const TRACEPARENT_HEADER = 'traceparent';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  public use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.header(REQUEST_ID_HEADER) ?? generateTraceparent()).trim();
    const traceparentRaw = req.header(TRACEPARENT_HEADER);
    const parsed = traceparentRaw ? parseTraceparent(traceparentRaw) : null;
    const traceparent = traceparentRaw && parsed ? traceparentRaw : generateTraceparent();
    const traceId = parsed?.traceId ?? requestId;

    // Echo the request id so clients can correlate (API_Design §2.2 response headers).
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(TRACEPARENT_HEADER, traceparent);

    withCorrelation({ traceId, correlationId: requestId }, () => {
      next();
    });
  }

  /** Augment the active context after auth — e.g. attach tenant_id from the JWT. */
  public static attachPrincipal(ctx: { tenantId?: string; userId?: string }): void {
    augmentCorrelation(ctx);
  }
}
