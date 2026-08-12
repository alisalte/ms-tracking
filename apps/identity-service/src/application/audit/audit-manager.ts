import {
  type Knex,
  PLATFORM_KNEX_TOKEN,
  withPlatformContext,
  withTenantContext,
} from '@fleetvision/persistence-knex';
/**
 * AuditManager — the application-layer facade over AuditRepository.append. Use
 * cases call `record(entry)` to capture a security-sensitive mutation in the
 * hash-chained audit log. Each record opens its own tenant/platform-context
 * transaction (matching the per-call transaction pattern used across the app) so
 * the audit row is committed even if the command's own transaction is separate.
 *
 * The audit subsystem is the SINGLE audit mechanism (Sprint 1 requirement 7):
 * no duplicate audit system is created. The hash-chain integrity
 * (prev_hash → entry_hash) is preserved by AuditRepository.append.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  AuditEntry,
  AuditRepository,
} from '../../infrastructure/persistence/audit.repository.js';

export interface AuditActor {
  readonly actorId: string | null;
  readonly actorType: 'USER' | 'SERVICE' | 'SYSTEM';
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export interface RecordAuditInput extends AuditActor {
  readonly tenantId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly permission: string | null;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  readonly before?: unknown;
  readonly after?: unknown;
  /** When true, write under platform context (cross-tenant/platform ops). */
  readonly platform?: boolean;
}

@Injectable()
export class AuditManager {
  constructor(
    @Inject(PLATFORM_KNEX_TOKEN) private readonly knex: Knex,
    private readonly audit: AuditRepository,
  ) {}

  public async record(input: RecordAuditInput): Promise<void> {
    const entry: AuditEntry = {
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      permission: input.permission,
      outcome: input.outcome,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      before: input.before,
      after: input.after,
    };
    // Platform-scoped audit (tenant provisioning) bypasses the tenant guard via
    // the platform role + app.is_platform flag; all other audit uses the row's
    // tenant context so the tenant-aware RLS policy admits the write.
    if (input.platform) {
      await withPlatformContext(this.knex, async (trx) => {
        await this.audit.append(trx, entry);
      });
    } else {
      await withTenantContext(this.knex, input.tenantId, async (trx) => {
        await this.audit.append(trx, entry);
      });
    }
  }
}
