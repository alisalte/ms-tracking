import { RequirePermissions, getPrincipal } from '@fleetvision/auth';
/**
 * Admin REST API (06 §11.4 queries, §9.4 hot reload).
 *
 * Read-only introspection + adapter enable/disable. Mounted under the admin
 * HTTP port (GATEWAY_ADMIN_PORT).
 *
 * Sprint B: these endpoints are protected by JWT authentication + the
 * `telemetry.gateway.manage` permission (02 §6), enforced by the global
 * CompositeAuthGuard + PermissionsGuard. The device TCP/UDP protocol listeners
 * are NOT HTTP routes and remain authenticated by device-protocol auth
 * (IMEI/serial) — they are unaffected by this guard.
 *
 * Sprint-D merge union: mutating operations (adapter enable/disable) are
 * recorded in the shared hash-chained audit log via GatewayAuditWriter
 * (parallel-line feature). Best-effort — a DB outage while auditing must never
 * break the admin operation itself.
 */
import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ConnectionPool } from '../../application/connection-pool.js';
import type { SessionManager } from '../../application/session-manager.js';
import type { AdapterRegistry } from '../../infrastructure/protocol/index.js';
import { ADAPTER_REGISTRY, CONNECTION_POOL, SESSION_MANAGER } from '../tokens.js';
// NestJS DI needs the class VALUE at runtime: a type-only import is elided by tsc
// and the compiled build then fails to resolve the 4th constructor param
// (design:paramtypes degrades to Function). biome-ignore-start is required because
// useImportType would otherwise auto-revert this to `import type`.
// biome-ignore lint/style/useImportType: DI token — must stay a value import.
import { GatewayAuditWriter } from './gateway-audit-writer.js';

@Controller('admin')
@RequirePermissions('telemetry.gateway.manage')
export class AdminController {
  constructor(
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
    @Inject(SESSION_MANAGER) private readonly sessions: SessionManager,
    @Inject(CONNECTION_POOL) private readonly pool: ConnectionPool,
    private readonly audit: GatewayAuditWriter,
  ) {}

  /** ListSessions — paginated sessions on this pod (06 §11.4). */
  @Get('sessions')
  public listSessions(): { count: number; sessions: readonly unknown[] } {
    const sessions = this.sessions.list();
    return { count: sessions.length, sessions };
  }

  /** GetListener status for every registered adapter (06 §11.4). */
  @Get('listeners')
  public listListeners(): readonly unknown[] {
    return this.adapters.list();
  }

  /** Enable an adapter (06 §9.4 hot reload). Audited. */
  @Post('listeners/:id/enable')
  public async enable(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ id: string; enabled: boolean }> {
    const before = this.adapters.list().find((a) => a.id === id)?.enabled ?? null;
    const ok = this.adapters.setEnabled(id, true);
    await this.auditAdmin(
      req,
      'telemetry.adapter.enable',
      id,
      { enabled: before },
      { enabled: ok },
    );
    return { id, enabled: ok };
  }

  /** Disable an adapter (06 §9.4 hot reload). Audited. */
  @Post('listeners/:id/disable')
  public async disable(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ id: string; disabled: boolean }> {
    const before = this.adapters.list().find((a) => a.id === id)?.enabled ?? null;
    const ok = this.adapters.setEnabled(id, false);
    await this.auditAdmin(
      req,
      'telemetry.adapter.disable',
      id,
      { enabled: before },
      { enabled: !ok },
    );
    return { id, disabled: ok };
  }

  /** GetStats — per-pod counts (06 §11.4). */
  @Get('stats')
  public stats(): {
    activeConnections: number;
    capacity: number;
    adapters: number;
    enabledAdapters: number;
  } {
    const pressure = this.pool.pressure();
    const all = this.adapters.list();
    return {
      activeConnections: pressure.active,
      capacity: pressure.capacity,
      adapters: all.length,
      enabledAdapters: all.filter((a) => a.enabled).length,
    };
  }

  /** Best-effort audit of an admin mutation (never breaks the operation). */
  private async auditAdmin(
    req: Request,
    action: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    try {
      const p = getPrincipal(req);
      await this.audit.record({
        tenantId: p.tenantId,
        actorId: p.userId,
        action,
        resourceType: 'telemetry.adapter',
        resourceId,
        permission: 'telemetry.gateway.manage',
        outcome: 'SUCCESS',
        requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        before,
        after,
      });
    } catch {
      // Auditing is best-effort by contract — the admin action already ran.
    }
  }
}
