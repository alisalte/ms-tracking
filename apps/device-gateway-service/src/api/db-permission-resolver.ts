import type { PermissionResolver } from '@fleetvision/auth';
import { KNEX_TOKEN, type Knex, withTenantContext } from '@fleetvision/persistence-knex';
/**
 * DB-backed permission resolver for device-gateway. Reads the SAME
 * `iam.role_permissions` + `iam.user_roles` tables identity-service uses, so the
 * RBAC decision is consistent without a second authorization mechanism. Runs
 * under tenant context so the hardened RLS policy on the IAM tables admits the
 * caller's own rows.
 */
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class DbPermissionResolver implements PermissionResolver {
  constructor(@Inject(KNEX_TOKEN) private readonly knex: Knex) {}

  public async permissionsForUser(tenantId: string, userId: string): Promise<readonly string[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('iam.role_permissions')
        .join('iam.user_roles', 'iam.user_roles.role_id', 'iam.role_permissions.role_id')
        .where('iam.user_roles.tenant_id', tenantId)
        .where('iam.user_roles.user_id', userId)
        .select('iam.role_permissions.permission')
        .distinct()) as { permission: string }[];
      return rows.map((r) => r.permission);
    });
  }
}
