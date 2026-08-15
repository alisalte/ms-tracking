/**
 * GatewayAuditWriter — records administrative actions taken through the
 * device-gateway admin API (06 §9.4 hot reloads: adapter enable/disable) into
 * the shared `audit.audit_entries` table, preserving the platform-wide SHA-256
 * hash-chain (same algorithm as identity-service AuditRepository).
 *
 * The device-gateway does not own the audit subsystem; it appends to the SAME
 * table identity-service uses so there is one continuous chain. Writes run on
 * the platform (BYPASSRLS) client under the platform flag so the tenant-aware
 * RLS policy on `audit.audit_entries` admits the row, and the entry is
 * tenant-attributed from the verified JWT principal.
 *
 * Best-effort: a DB error while auditing must NOT break the admin operation
 * itself — callers swallow the rejection and log. The action still completes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { type Knex, PLATFORM_KNEX_TOKEN, withPlatformContext } from '@fleetvision/persistence-knex';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface GatewayAuditEntry {
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly permission: string;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

@Injectable()
export class GatewayAuditWriter {
  private readonly logger = new Logger(GatewayAuditWriter.name);

  constructor(@Inject(PLATFORM_KNEX_TOKEN) private readonly knex: Knex) {}

  /** Append an admin audit entry. Best-effort — never throws to the caller. */
  public async record(entry: GatewayAuditEntry): Promise<void> {
    try {
      await withPlatformContext(this.knex, async (trx) => {
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
          actor_type: 'USER',
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
          actor_type: 'USER',
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
      });
    } catch (err) {
      // Non-fatal: the admin operation still succeeds; audit is best-effort.
      this.logger.warn(`Failed to audit admin action ${entry.action}: ${(err as Error).message}`);
    }
  }

  /** SHA-256(prev_hash || canonical(entry)) — matches identity-service. */
  private computeHash(entry: Record<string, unknown>): string {
    const canonical = JSON.stringify(entry, Object.keys(entry).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }
}
