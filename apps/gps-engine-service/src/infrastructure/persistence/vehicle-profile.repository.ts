/**
 * Vehicle machine-type lookup for the GPS fix filter.
 *
 * Reads `fleet.vehicles.machine_type` (owned by fleet-management) under the
 * tenant RLS context and memoises it per vehicle, so the hot path costs one
 * query per vehicle per TTL rather than one per position. Lookup failures
 * resolve to null (the filter then applies the generic speed cap).
 */
import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';

const DEFAULT_TTL_MS = 5 * 60_000;

export class VehicleProfileRepository {
  private readonly cache = new Map<string, { machineType: string | null; expiresAt: number }>();

  constructor(
    private readonly knex: Knex,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  public async machineType(tenantId: string, vehicleId: string): Promise<string | null> {
    const key = `${tenantId}:${vehicleId}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.machineType;
    let machineType: string | null = null;
    try {
      const row = await withTenantContext(this.knex, tenantId, (trx) =>
        trx
          .withSchema('fleet')
          .from('vehicles')
          .select('machine_type')
          .whereRaw('tenant_id = ?::uuid', [tenantId])
          .whereRaw('id = ?::uuid', [vehicleId])
          .first(),
      );
      const value = (row as { machine_type?: unknown } | undefined)?.machine_type;
      machineType = typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      // Non-UUID ids (legacy device-keyed positions) or DB down — keep the last
      // known value briefly rather than hammering the DB.
      machineType = hit?.machineType ?? null;
    }
    this.cache.set(key, { machineType, expiresAt: now + this.ttlMs });
    if (this.cache.size > 50_000) {
      for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
    }
    return machineType;
  }
}
