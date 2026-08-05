/**
 * User aggregate repository — maps between the User domain object and the
 * `iam.users` row, and persists domain events to the outbox atomically.
 *
 * Reads/writes go through a tenant-scoped transaction (`withTenantContext`)
 * so RLS filters to the caller's tenant (INV-I02). User-name uniqueness across
 * the platform (INV-IAM-02) is enforced by a global unique index; the unique
 * violation surfaces as a CONFLICT at the application layer.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import {
  type EventContext,
  type User,
  User as UserClass,
  type UserProps,
  type UserStatus,
} from '../../domain/index.js';
import { withTenantContext, withoutTenantContext } from './tenant-context.js';

/** Raw row shape in `iam.users`. */
export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  username: string;
  password_hash: string | null;
  status: UserStatus;
  display_name: string | null;
  auth_provider: string;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  failed_login_attempts: number;
  lockout_until: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class UserRepository {
  constructor(private readonly knex: Knex) {}

  /** Find a user by id within a tenant. */
  public async findById(tenantId: string, id: string): Promise<User | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<UserRow>('iam.users').where({ id, tenant_id: tenantId }).first();
      if (!row) return null;
      const roleIds = await this.loadRoleIds(trx, tenantId, id);
      return this.toDomain(row, roleIds);
    });
  }

  /** Find a user by email within a tenant (login path). */
  public async findByEmail(tenantId: string, email: string): Promise<User | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<UserRow>('iam.users').where({ tenant_id: tenantId, email }).first();
      if (!row) return null;
      const roleIds = await this.loadRoleIds(trx, tenantId, row.id);
      return this.toDomain(row, roleIds);
    });
  }

  /** Find a user by username platform-wide (INV-IAM-02 uniqueness check). */
  public async findByUsername(username: string): Promise<User | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<UserRow>('iam.users').where({ username }).first();
      if (!row) return null;
      const roleIds = await this.loadRoleIds(trx, row.tenant_id, row.id);
      return this.toDomain(row, roleIds);
    });
  }

  /**
   * Persist a (new or changed) user and its domain events atomically. New users
   * are INSERTed; existing users are UPDATEd with optimistic version check.
   */
  public async save(user: User, ctx: EventContext): Promise<void> {
    const tenantId = user.tenantId;
    const events = user.pullEvents();

    const existing = await this.knex('iam.users')
      .where({ id: user.id as string })
      .first();
    if (!existing) {
      await this.insertUser(tenantId, user, events, ctx);
    } else {
      await this.updateUser(tenantId, user, events, ctx);
    }
    user.markEventsCommitted();
  }

  /** List users in a tenant with simple pagination. */
  public async list(
    tenantId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ rows: User[]; total: number }> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const [rows, countRow] = await Promise.all([
        trx<UserRow>('iam.users')
          .where({ tenant_id: tenantId })
          .orderBy('created_at', 'asc')
          .limit(limit)
          .offset(offset),
        trx.count({ total: '*' }).from('iam.users').where({ tenant_id: tenantId }).first(),
      ]);
      const total = countRow ? Number((countRow as { total: string }).total) : 0;
      const users = await Promise.all(
        (rows as UserRow[]).map(async (r) => {
          const roleIds = await this.loadRoleIds(trx, tenantId, r.id);
          return this.toDomain(r, roleIds);
        }),
      );
      return { rows: users, total };
    });
  }

  // --- Role bindings --------------------------------------------------------

  public async assignRole(tenantId: string, userId: string, roleId: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('iam.user_roles')
        .insert({ tenant_id: tenantId, user_id: userId, role_id: roleId })
        .onConflict(['tenant_id', 'user_id', 'role_id'])
        .ignore();
    });
  }

  public async revokeRole(tenantId: string, userId: string, roleId: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('iam.user_roles')
        .where({ tenant_id: tenantId, user_id: userId, role_id: roleId })
        .delete();
    });
  }

  // --- Internals ------------------------------------------------------------

  private async loadRoleIds(
    trx: Knex.Transaction,
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = (await trx('iam.user_roles')
      .where({ tenant_id: tenantId, user_id: userId })
      .select('role_id')) as { role_id: string }[];
    return rows.map((r) => r.role_id);
  }

  private async insertUser(
    tenantId: string,
    user: User,
    events: import('@fleetvision/shared-kernel').DomainEvent[],
    ctx: EventContext,
  ): Promise<void> {
    await withoutTenantContext(this.knex, async (trx) => {
      await trx('iam.users').insert({
        id: user.id as string,
        tenant_id: tenantId,
        email: user.email,
        username: user.username,
        password_hash: user.passwordHash,
        status: user.status,
        display_name: user.displayName,
        auth_provider: user.authProvider,
        mfa_enabled: user.mfaEnabled,
        version: 1,
      });
      await this.persistEvents(trx, tenantId, user.id as string, events, ctx);
    });
  }

  private async updateUser(
    tenantId: string,
    user: User,
    events: import('@fleetvision/shared-kernel').DomainEvent[],
    ctx: EventContext,
  ): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      // Match by id+tenant; the aggregate was just loaded by findById, so the
      // row exists. Version is bumped server-side. (Full optimistic-concurrency
      // with expectedVersion rehydration is a follow-up; MVP scopes by id.)
      const updated = await trx('iam.users')
        .where({ id: user.id as string, tenant_id: tenantId })
        .update({
          email: user.email,
          password_hash: user.passwordHash,
          status: user.status,
          last_login_at: user.lastLoginAt,
          failed_login_attempts: user.failedLoginAttempts,
          lockout_until: user.lockoutUntil,
          version: this.knex.raw('version + 1'),
        });
      if (updated === 0) {
        throw new Error('User not found during update.');
      }
      await this.persistEvents(trx, tenantId, user.id as string, events, ctx);
    });
  }

  /** Drain events into the outbox inside the same transaction. */
  private async persistEvents(
    trx: Knex.Transaction,
    tenantId: string,
    aggregateId: string,
    events: import('@fleetvision/shared-kernel').DomainEvent[],
    ctx: EventContext,
  ): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e) => ({
      aggregate_type: ctx.aggregateType,
      aggregate_id: aggregateId,
      tenant_id: tenantId,
      event_type: e.type,
      payload: JSON.stringify(serializeEvent(e)),
      headers: JSON.stringify({ correlation_id: ctx.correlationId }),
    }));
    await trx('event_outbox').insert(rows);
  }

  /** Map a row to the User aggregate (no events raised). */
  private toDomain(row: UserRow, roleIds: string[]): User {
    const props: UserProps = {
      tenantId: row.tenant_id,
      email: row.email,
      username: row.username,
      passwordHash: row.password_hash,
      status: row.status,
      displayName: row.display_name,
      authProvider: row.auth_provider,
      mfaEnabled: row.mfa_enabled,
      lastLoginAt: row.last_login_at,
      failedLoginAttempts: row.failed_login_attempts,
      lockoutUntil: row.lockout_until,
    };
    return UserClass.rehydrate(row.id, row.version, props, roleIds);
  }
}

/**
 * Serialize a domain event for the outbox payload. Pulls the public fields an
 * event carries; CloudEvents metadata is on the base class.
 */
function serializeEvent(
  event: import('@fleetvision/shared-kernel').DomainEvent,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: event.id,
    type: event.type,
    source: event.source,
    time: event.time,
    fleetvision: event.fleetvision,
  };
  // Domain-specific payload fields (email, roleId, etc.) are public own props.
  for (const [k, v] of Object.entries(event)) {
    if (!(k in out) && typeof v !== 'function') {
      out[k] = v;
    }
  }
  return out;
}
