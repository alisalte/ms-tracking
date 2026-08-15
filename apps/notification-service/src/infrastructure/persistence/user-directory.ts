/**
 * UserDirectory — trusted backend lookup of tenant users from `iam.users`
 * (identity-service schema). Sprint H §20: recipient identity (userId,
 * tenantId, contact info) is resolved from trusted backend data, NEVER
 * from alarm/event payloads.
 *
 * Read-only, platform-scoped (the notification service does not own the
 * iam schema). Results are cached briefly in Redis to avoid hammering the
 * directory on notification storms.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withPlatformContext } from '@fleetvision/persistence-knex';

export interface TenantUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export class UserDirectory {
  private static readonly CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly platformKnex: Knex,
    private readonly cache: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
    } | null,
  ) {}

  /** List active users of a tenant (trusted source: iam.users). */
  public async listTenantUsers(tenantId: string): Promise<TenantUser[]> {
    const cacheKey = `tenant:${tenantId}:users`;
    const cached = await this.cache?.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as TenantUser[];
      } catch {
        // Fall through to a fresh lookup on corrupt cache entries.
      }
    }
    const rows = await withPlatformContext(this.platformKnex, async (trx) => {
      return trx('iam.users')
        .where({ tenant_id: tenantId, status: 'ACTIVE' })
        .select('id', 'tenant_id', 'email', 'display_name');
    });
    const users: TenantUser[] = rows.map((r: Record<string, string | null>) => ({
      userId: String(r.id),
      tenantId: String(r.tenant_id),
      email: r.email ?? null,
      displayName: r.display_name ?? null,
    }));
    if (this.cache) {
      await this.cache
        .set(cacheKey, JSON.stringify(users), 'EX', UserDirectory.CACHE_TTL_SECONDS)
        .catch(() => undefined);
    }
    return users;
  }

  /** Resolve a single user's contact info (email lookup for the EMAIL channel). */
  public async getUser(tenantId: string, userId: string): Promise<TenantUser | null> {
    const users = await this.listTenantUsers(tenantId);
    return users.find((u) => u.userId === userId) ?? null;
  }
}
