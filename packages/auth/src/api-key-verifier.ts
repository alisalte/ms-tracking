import type { Knex } from '@fleetvision/persistence-knex';
import { withoutTenantContext } from '@fleetvision/persistence-knex';
/**
 * API-key verifier — resolves a presented `fv_<env>_<secret>` key to a trusted
 * identity. Cross-tenant by design (the caller's tenant is unknown until the key
 * resolves): looks up by the 11-char prefix, then Argon2id-verifies the secret
 * against the stored hash. The resolved `tenantId` becomes the authenticated
 * tenant and `scopes` become the context permissions — so an API key can never
 * reach another tenant's data (every downstream repository filters by tenant_id).
 *
 * identity-service owns the `iam.api_keys` schema; this default verifier is
 * usable by any service because the schema is shared. Services that do not need
 * API-key auth simply omit the provider.
 */
import argon2 from 'argon2';

/** The trusted identity an API key resolves to. */
export interface VerifiedApiKey {
  readonly keyId: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
  readonly assignedUserId: string | null;
}

/** Port — services may provide their own implementation. */
export abstract class ApiKeyVerifier {
  /** Resolve a presented plaintext key, or return null if invalid/inactive. */
  public abstract verify(presentedKey: string): Promise<VerifiedApiKey | null>;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[] | readonly string[];
  assigned_user_id: string | null;
  expires_at: Date | null;
  status: 'ACTIVE' | 'REVOKED';
}

/**
 * TTL for remembering a SUCCESSFULLY verified key (prefix → identity).
 *
 * Argon2id verification is deliberately expensive (tens of ms to seconds
 * depending on the identity-service hash parameters) and runs on the libuv
 * threadpool. Service-to-service callers (e.g. the device-gateway resolving
 * IMEIs per packet) present the SAME key on every request — without this
 * cache a reconnect storm multiplies into a threadpool-saturating Argon2
 * storm that starves the whole process. Negative results are NOT cached
 * (brute-force keys must pay full cost every time); a revoke takes effect
 * within this TTL at the latest.
 */
const VERIFIED_CACHE_TTL_MS = 30_000;
const VERIFIED_CACHE_MAX = 128;

interface CacheEntry {
  readonly identity: VerifiedApiKey;
  readonly expiresAtMs: number;
  /** Negative-expiry bookkeeping: row expires_at snapshot for early eviction. */
  readonly keyExpiresAt: Date | null;
}

export class KnexApiKeyVerifier extends ApiKeyVerifier {
  private readonly verified = new Map<string, CacheEntry>();

  constructor(private readonly knex: Knex) {
    super();
  }

  public async verify(presentedKey: string): Promise<VerifiedApiKey | null> {
    if (!presentedKey.startsWith('fv_') || presentedKey.length < 12) return null;
    const prefix = presentedKey.slice(0, 11);

    // Fast path: recently verified, still ACTIVE, not expired.
    const cached = this.verified.get(presentedKey);
    if (
      cached &&
      Date.now() < cached.expiresAtMs &&
      (!cached.keyExpiresAt || new Date(cached.keyExpiresAt) > new Date())
    ) {
      return cached.identity;
    }
    if (cached) this.verified.delete(presentedKey);

    let rows: ApiKeyRow[];
    try {
      // Cross-tenant BY DESIGN (the caller's tenant is unknown until the key
      // resolves) — iam.api_keys carries tenant-isolation RLS, so the lookup
      // must run as a platform operation or the app role sees zero rows and
      // every service-to-service key fails with 401.
      const result = (await withoutTenantContext(this.knex, (trx) =>
        trx.raw('SELECT * FROM iam.api_keys WHERE key_prefix = ?', [prefix]),
      )) as unknown as { rows: ApiKeyRow[] };
      rows = result.rows;
    } catch {
      // DB unreachable — fail-closed (no API key authenticates against an
      // unreachable store). The guard maps this to 401.
      throw new Error('API-key store unreachable.');
    }
    if (rows.length === 0) return null;

    // Verify each candidate (prefix collisions are ~impossible but cheap to be
    // exhaustive). Only an ACTIVE, non-expired key whose hash matches resolves.
    for (const row of rows) {
      let matches = false;
      try {
        matches = await argon2.verify(row.key_hash, presentedKey);
      } catch {
        matches = false;
      }
      if (!matches) continue;
      if (row.status !== 'ACTIVE') return null;
      if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
      const identity: VerifiedApiKey = {
        keyId: row.id,
        tenantId: row.tenant_id,
        scopes: [...(row.scopes ?? [])],
        assignedUserId: row.assigned_user_id,
      };
      this.rememberVerified(presentedKey, identity, row.expires_at);
      return identity;
    }
    return null;
  }

  /** Bounded remember: oldest entry is evicted at capacity. */
  private rememberVerified(
    presentedKey: string,
    identity: VerifiedApiKey,
    keyExpiresAt: Date | null,
  ): void {
    if (this.verified.size >= VERIFIED_CACHE_MAX) {
      const oldest = this.verified.keys().next().value;
      if (oldest !== undefined) this.verified.delete(oldest);
    }
    this.verified.set(presentedKey, {
      identity,
      expiresAtMs: Date.now() + VERIFIED_CACHE_TTL_MS,
      keyExpiresAt,
    });
  }
}
