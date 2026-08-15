/**
 * Audit repository — appends to the shared `audit.audit_entries` table with
 * hash-chain integrity (INV-A01), ported from identity-service so fleet-management
 * writes audit entries WITHOUT inventing a second audit system (Sprint C §28).
 *
 * The `audit` schema + `audit.audit_entries` table are created by identity-service
 * (the foundational auth provider every service depends on) and shared across the
 * platform via the single PostgreSQL instance. Call `append` INSIDE the command's
 * `withTenantContext` transaction so audit commits atomically with the change.
 */
import { createHash, randomUUID } from 'node:crypto';
import { type Knex, withoutTenantContext as withoutCtx } from '@fleetvision/persistence-knex';

export interface AuditEntry {
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly actorType: 'USER' | 'SERVICE' | 'SYSTEM';
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly permission: string | null;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export class AuditRepository {
  constructor(private readonly knex: Knex) {}

  /** Append under a row lock, chaining seq_no + SHA-256(prev || canonical). */
  public async append(trx: Knex.Transaction, entry: AuditEntry): Promise<void> {
    const lastRow = await trx<{ seq_no: number; entry_hash: string }>('audit.audit_entries')
      .orderBy('seq_no', 'desc')
      .first()
      .forUpdate();
    const seqNo = lastRow ? Number(lastRow.seq_no) + 1 : 1;
    const prevHash = lastRow ? lastRow.entry_hash : '0'.repeat(64);

    const id = randomUUID();
    const createdAt = new Date();
    const entryHash = this.computeHash({
      id,
      tenant_id: entry.tenantId,
      actor_id: entry.actorId,
      actor_type: entry.actorType,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      permission: entry.permission,
      outcome: entry.outcome,
      request_id: entry.requestId,
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
      before: entry.before,
      after: entry.after,
      seq_no: seqNo,
      prev_hash: prevHash,
      created_at: createdAt.toISOString(),
    });

    await trx('audit.audit_entries').insert({
      id,
      tenant_id: entry.tenantId,
      actor_id: entry.actorId,
      actor_type: entry.actorType,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      permission: entry.permission,
      outcome: entry.outcome,
      request_id: entry.requestId,
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
      before: entry.before === undefined ? null : JSON.stringify(entry.before),
      after: entry.after === undefined ? null : JSON.stringify(entry.after),
      seq_no: seqNo,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: createdAt,
    });
  }

  /** Query audit entries for a tenant (simplified). */
  public async query(
    tenantId: string,
    opts: {
      resourceType?: string;
      resourceId?: string;
      actorId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    return withoutCtx(this.knex, async (trx) => {
      const base = trx('audit.audit_entries').where({ tenant_id: tenantId });
      if (opts.resourceType) base.where({ resource_type: opts.resourceType });
      if (opts.resourceId) base.where({ resource_id: opts.resourceId });
      if (opts.actorId) base.where({ actor_id: opts.actorId });
      const [rows, countRow] = await Promise.all([
        base.clone().orderBy('seq_no', 'desc').limit(limit).offset(offset),
        base.clone().count({ total: '*' }).first(),
      ]);
      const total = countRow ? Number((countRow as { total: string }).total) : 0;
      return { rows: rows as Record<string, unknown>[], total };
    });
  }

  private computeHash(entry: Record<string, unknown>): string {
    const canonical = JSON.stringify(entry, Object.keys(entry).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }
}
