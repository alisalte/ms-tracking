/**
 * Builds the EventContext that aggregates need to raise domain events. Kept in
 * one place so the tenant id + correlation id are always sourced the same way
 * (INV-I02: tenant from principal, correlation from request).
 */
import { randomUUID } from 'node:crypto';
import type { EventContext } from '../../domain/index.js';

export function buildEventContext(
  tenantId: string,
  aggregateType: string,
  correlationId?: string,
): EventContext {
  return {
    tenantId,
    correlationId: correlationId ?? randomUUID(),
    aggregateType,
  };
}
