/**
 * Audit repository — appends report EXPORT actions to the shared
 * `audit.audit_entries` hash-chained table (Sprint J §48; the same ported
 * pattern as map-engine). Best-effort: a missing audit schema degrades to a
 * debug log and never blocks the export. Report CONTENTS are never logged —
 * only the action + row count.
 */
import { createHash, randomUUID } from 'node:crypto';
import { type Knex, withoutTenantContext as withoutCtx } from '@fleetvision/persistence-knex';

export interface ReportAuditEntry {
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  readonly requestId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export class AuditRepository {
  constructor(private readonly knex: Knex) {}

  public async appendBestEffort(entry: ReportAuditEntry): Promise<void> {
    try {
      await withoutCtx(this.knex, async (trx) => {
        const lastRow = await trx<{ seq_no: number; entry_hash: string }>('audit.audit_entries')
          .orderBy('seq_no', 'desc')
          .first()
          .forUpdate();
        const seqNo = lastRow ? Number(lastRow.seq_no) + 1 : 1;
        const prevHash = lastRow ? lastRow.entry_hash : '0'.repeat(64);
        const id = randomUUID();
        const createdAt = new Date();
        const canonical = {
          id,
          tenant_id: entry.tenantId,
          actor_id: entry.actorId,
          actor_type: 'USER',
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId,
          permission: null,
          outcome: entry.outcome,
          request_id: entry.requestId,
          ip_address: null,
          user_agent: null,
          before: entry.before,
          after: entry.after,
          seq_no: seqNo,
          prev_hash: prevHash,
          created_at: createdAt.toISOString(),
        };
        const entryHash = createHash('sha256')
          .update(JSON.stringify(canonical, Object.keys(canonical).sort()))
          .digest('hex');
        await trx('audit.audit_entries').insert({
          ...canonical,
          before: entry.before === undefined ? null : JSON.stringify(entry.before),
          after: entry.after === undefined ? null : JSON.stringify(entry.after),
          created_at: createdAt,
          entry_hash: entryHash,
        });
      });
    } catch {
      // Best-effort: the audit schema may be absent in isolated deployments.
    }
  }
}
