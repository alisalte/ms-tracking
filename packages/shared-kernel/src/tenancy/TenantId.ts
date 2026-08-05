/**
 * Tenant identity primitives. INV-I02 (docs/specs/02_Domain_Model.md §8): tenant_id is
 * ALWAYS derived from the authenticated principal (JWT), never from the request
 * body. The branded type makes a raw string unassignable to a TenantId — the
 * only constructor path is `fromJwtClaims`, which reads it off the verified token.
 */
import { type Brand, asId } from '../domain/Identifier.js';

/**
 * Branded tenant identifier — opaque to clients, UUID-backed.
 *
 * A raw `string` is not assignable to `TenantId`; the only construction paths
 * are the `TenantId` factories below, which read the value off trusted sources
 * (verified JWT claims, rehydrated store records). The brand is erased at
 * runtime (it is structurally just a string), so `fromJwtClaims` returns the
 * raw value when inspected.
 */
export type TenantId = Brand<string, 'TenantId'>;

export const TenantId = {
  /** The only sanctioned way to build a TenantId — from verified JWT claims. */
  fromJwtClaims(claims: { tenant_id?: string; sub?: string }): TenantId {
    const tid = claims.tenant_id;
    if (!tid || typeof tid !== 'string') {
      throw new Error('JWT is missing tenant_id claim (INV-I02 violation)');
    }
    return asId(tid, 'TenantId');
  },

  /** Rehydrate a TenantId from an event/store record (already trusted). */
  fromTrusted(value: string): TenantId {
    return asId(value, 'TenantId');
  },
} as const;
