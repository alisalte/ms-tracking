import { RequirePermissions } from '@fleetvision/auth';
/**
 * Admin REST API (06 §11.4 queries, §9.4 hot reload).
 *
 * Read-only introspection + adapter enable/disable. Mounted under the admin HTTP
 * port (GATEWAY_ADMIN_PORT).
 *
 * Sprint B: these endpoints are protected by JWT authentication + the
 * `telemetry.gateway.manage` permission (02 §6), enforced by the global
 * CompositeAuthGuard + PermissionsGuard. The device TCP/UDP protocol listeners
 * are NOT HTTP routes and remain authenticated by device-protocol auth
 * (IMEI/serial) — they are unaffected by this guard.
 */
import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { ConnectionPool } from '../../application/connection-pool.js';
import type { SessionManager } from '../../application/session-manager.js';
import type { AdapterRegistry } from '../../infrastructure/protocol/index.js';
import { ADAPTER_REGISTRY, CONNECTION_POOL, SESSION_MANAGER } from '../tokens.js';

@Controller('admin')
@RequirePermissions('telemetry.gateway.manage')
export class AdminController {
  constructor(
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
    @Inject(SESSION_MANAGER) private readonly sessions: SessionManager,
    @Inject(CONNECTION_POOL) private readonly pool: ConnectionPool,
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

  /** Enable an adapter (06 §9.4 hot reload). */
  @Post('listeners/:id/enable')
  public enable(@Param('id') id: string): { id: string; enabled: boolean } {
    const ok = this.adapters.setEnabled(id, true);
    return { id, enabled: ok };
  }

  /** Disable an adapter (06 §9.4 hot reload). */
  @Post('listeners/:id/disable')
  public disable(@Param('id') id: string): { id: string; disabled: boolean } {
    const ok = this.adapters.setEnabled(id, false);
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
}
