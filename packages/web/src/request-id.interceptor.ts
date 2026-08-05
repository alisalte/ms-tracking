/**
 * Request-id interceptor — the seed of the §8 interceptor chain. The correlation
 * headers themselves are set by the observability CorrelationMiddleware; this
 * interceptor shows where response-shaping interceptors (content negotiation,
 * pagination envelopes, etc.) will layer on in later sprints. It is a no-op
 * passthrough in Sprint 1, kept so the app.module wires the interceptor pipeline
 * early and the pattern is established.
 */
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, map } from 'rxjs';

@Injectable()
export class RequestIdInterceptor<T> implements NestInterceptor<T, T> {
  public intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<T> {
    // The observability CorrelationMiddleware already echoes `x-request-id` and
    // `traceparent` on the response. Later sprints append body shaping here.
    return next.handle().pipe(map((data) => data));
  }
}
