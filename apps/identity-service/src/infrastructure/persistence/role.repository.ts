/**
 * Role repository — maps the Role aggregate to `iam.roles` + `iam.role_permissions`.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { type Role, Role as RoleClass, type RoleProps } from '../../domain/index.js';
import { withTenantContext } from './tenant-context.js';

export interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  version: number;
}

interface PermissionRow {
  permission: string;
}

export class RoleRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(tenantId: string, id: string): Promise<Role | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = (await trx('iam.roles').where({ id, tenant_id: tenantId }).first()) as
        | RoleRow
        | undefined;
      if (!row) return null;
      const perms = (
        (await trx('iam.role_permissions')
          .where({ role_id: id })
          .select('permission')) as PermissionRow[]
      ).map((p) => p.permission);
      return this.toDomain(row, perms);
    });
  }

  public async findByName(tenantId: string, name: string): Promise<Role | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = (await trx('iam.roles').where({ tenant_id: tenantId, name }).first()) as
        | RoleRow
        | undefined;
      if (!row) return null;
      const perms = (
        (await trx('iam.role_permissions')
          .where({ role_id: row.id })
          .select('permission')) as PermissionRow[]
      ).map((p) => p.permission);
      return this.toDomain(row, perms);
    });
  }

  public async list(tenantId: string): Promise<Role[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('iam.roles')
        .where({ tenant_id: tenantId })
        .orderBy('name')) as RoleRow[];
      return Promise.all(
        rows.map(async (r) => {
          const perms = (
            (await trx('iam.role_permissions')
              .where({ role_id: r.id })
              .select('permission')) as PermissionRow[]
          ).map((p) => p.permission);
          return this.toDomain(r, perms);
        }),
      );
    });
  }

  public async listWithMemberCounts(
    tenantId: string,
  ): Promise<Array<{ role: Role; memberCount: number }>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('iam.roles')
        .where({ tenant_id: tenantId })
        .orderBy('name')) as RoleRow[];
      const counts = (await trx('iam.user_roles')
        .where({ tenant_id: tenantId })
        .groupBy('role_id')
        .select('role_id')
        .count('* as n')) as Array<{ role_id: string; n: string | number }>;
      const countMap = new Map(counts.map((c) => [c.role_id, Number(c.n)]));
      return Promise.all(
        rows.map(async (r) => {
          const perms = (
            (await trx('iam.role_permissions')
              .where({ role_id: r.id })
              .select('permission')) as PermissionRow[]
          ).map((p) => p.permission);
          return { role: this.toDomain(r, perms), memberCount: countMap.get(r.id) ?? 0 };
        }),
      );
    });
  }

  /** Replace the permission set of a custom (non-system) role. */
  public async replacePermissions(
    tenantId: string,
    roleId: string,
    permissions: readonly string[],
  ): Promise<Role> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = (await trx('iam.roles').where({ id: roleId, tenant_id: tenantId }).first()) as
        | RoleRow
        | undefined;
      if (!row) throw new Error('Role not found');
      if (row.is_system) throw new Error('System roles are immutable.');
      await trx('iam.role_permissions').where({ role_id: roleId }).delete();
      if (permissions.length > 0) {
        await trx('iam.role_permissions').insert(
          permissions.map((permission) => ({ role_id: roleId, permission })),
        );
      }
      return this.toDomain(row, [...permissions]);
    });
  }

  /** Insert a new role with its permission set. */
  public async save(role: Role): Promise<void> {
    await withTenantContext(this.knex, role.tenantId, async (trx) => {
      await trx('iam.roles').insert({
        id: role.id as string,
        tenant_id: role.tenantId,
        name: role.name,
        description: role.description,
        is_system: role.isSystem,
        version: 1,
      });
      const perms = [...role.permissions].map((p) => ({
        role_id: role.id as string,
        permission: p,
      }));
      if (perms.length > 0) {
        await trx('iam.role_permissions').insert(perms);
      }
    });
  }

  /** Resolve the full permission set for a user (union across assigned roles). */
  public async permissionsForUser(tenantId: string, userId: string): Promise<string[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('iam.role_permissions')
        .join('iam.user_roles', 'iam.user_roles.role_id', 'iam.role_permissions.role_id')
        .where('iam.user_roles.tenant_id', tenantId)
        .where('iam.user_roles.user_id', userId)
        .select('iam.role_permissions.permission')
        .distinct()) as PermissionRow[];
      return rows.map((r) => r.permission);
    });
  }

  /** Resolve assigned role *names* (JWT /me show names, never role UUIDs). */
  public async namesForUser(tenantId: string, userId: string): Promise<string[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('iam.roles')
        .join('iam.user_roles', 'iam.user_roles.role_id', 'iam.roles.id')
        .where('iam.user_roles.tenant_id', tenantId)
        .where('iam.user_roles.user_id', userId)
        .orderBy('iam.roles.name')
        .select('iam.roles.name')) as Array<{ name: string }>;
      return rows.map((r) => r.name);
    });
  }

  private toDomain(row: RoleRow, permissions: string[]): Role {
    const props: RoleProps = {
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description,
      isSystem: row.is_system,
      permissions: new Set(permissions),
    };
    return RoleClass.rehydrate(row.id, row.version, props);
  }
}
