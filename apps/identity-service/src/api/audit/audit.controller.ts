/**
 * Audit query — tenant-scoped read of the hash-chained identity audit log.
 * Base `/api/v1/audit`. Writes still happen in-process with each command;
 * this is the Admin Panel list/export source (Audit-Compliance-Log §5.1).
 */
import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { AuditRepository } from '../../infrastructure/persistence/audit.repository.js';
import { RequirePermissions } from '../shared/permissions.guard.js';
import { getPrincipal } from '../shared/principal.js';

@Controller('api/v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditRepository) {}

  @Get('entries')
  @RequirePermissions('audit.read')
  public async list(
    @Req() req: Request,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const p = getPrincipal(req);
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);
    const offset = Math.max(Number(offsetRaw) || 0, 0);
    const { rows, total } = await this.audit.query(p.tenantId, { limit, offset });
    return {
      data: rows.map((row) => this.toView(row)),
      meta: { total },
    };
  }

  private toView(row: Record<string, unknown>) {
    const created = row.created_at;
    return {
      id: String(row.id ?? ''),
      created_at:
        created instanceof Date
          ? created.toISOString()
          : String(created ?? new Date().toISOString()),
      action: String(row.action ?? 'SYSTEM'),
      actor_type: String(row.actor_type ?? 'SYSTEM'),
      actor_id: row.actor_id ? String(row.actor_id) : null,
      resource_type: String(row.resource_type ?? 'unknown'),
      resource_id: row.resource_id ? String(row.resource_id) : null,
      request_id: row.request_id ? String(row.request_id) : null,
      ip_address: row.ip_address != null ? String(row.ip_address) : null,
      outcome: String(row.outcome ?? 'SUCCESS'),
      entry_hash: String(row.entry_hash ?? ''),
    };
  }
}
