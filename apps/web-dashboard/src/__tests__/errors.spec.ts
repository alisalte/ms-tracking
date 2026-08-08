import { describe, expect, it } from 'vitest';

import {
  ApiClientError,
  ConflictError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  ServerError,
  UnauthorizedError,
  ValidationError,
  getApiErrorMessage,
  normalizeApiError,
} from '@/api/errors';

describe('API error normalization', () => {
  it('normalizes a 401 to UnauthorizedError', () => {
    const err = normalizeApiError({
      response: { status: 401, data: { errors: [{ code: 'AUTH_EXPIRED', detail: 'Token expired' }] } },
      message: 'Request failed',
    });
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('AUTH_EXPIRED');
    expect(err.message).toBe('Token expired');
  });

  it('normalizes a 403 to ForbiddenError', () => {
    const err = normalizeApiError({ response: { status: 403, data: {} }, message: 'Forbidden' });
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(403);
  });

  it('normalizes a 404 to NotFoundError', () => {
    const err = normalizeApiError({ response: { status: 404, data: {} }, message: 'Not found' });
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('normalizes a 409 to ConflictError', () => {
    const err = normalizeApiError({ response: { status: 409, data: { errors: [{ detail: 'Duplicate' }] }, }, message: 'x' });
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe('Duplicate');
  });

  it('normalizes a 422 to ValidationError', () => {
    const err = normalizeApiError({ response: { status: 422, data: {} }, message: 'Invalid' });
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('normalizes a 500 to ServerError', () => {
    const err = normalizeApiError({ response: { status: 500, data: {} }, message: 'Server error' });
    expect(err).toBeInstanceOf(ServerError);
  });

  it('normalizes a 502 to ServerError', () => {
    const err = normalizeApiError({ response: { status: 502, data: {} }, message: 'Bad gateway' });
    expect(err).toBeInstanceOf(ServerError);
  });

  it('normalizes no-response (network) to NetworkError', () => {
    const err = normalizeApiError({ response: undefined, message: 'Network Error' });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.status).toBe(0);
  });

  it('normalizes unknown status to generic ApiClientError', () => {
    const err = normalizeApiError({ response: { status: 418, data: {} }, message: "I'm a teapot" });
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(418);
  });

  it('extracts error title when detail is missing', () => {
    const err = normalizeApiError({
      response: { status: 403, data: { errors: [{ title: 'Permission denied' }] } },
      message: 'x',
    });
    expect(err.message).toBe('Permission denied');
  });

  it('getApiErrorMessage extracts from ApiClientError', () => {
    const err = new NotFoundError('NF', 'Resource gone');
    expect(getApiErrorMessage(err)).toBe('Resource gone');
  });

  it('getApiErrorMessage handles generic Error', () => {
    expect(getApiErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('getApiErrorMessage handles unknown', () => {
    expect(getApiErrorMessage(null)).toBe('An unexpected error occurred');
  });
});
