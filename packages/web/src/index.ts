/**
 * @fleetvision/web — public surface. The HTTP cross-cutting primitives.
 */
export { GlobalExceptionFilter } from './global-exception.filter.js';
export { RequestIdInterceptor } from './request-id.interceptor.js';
export {
  errorDocument,
  type JsonApiError,
  type JsonApiErrorDocument,
} from './error-envelope.js';
