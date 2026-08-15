import type { TokenVerifier } from '@fleetvision/auth';
import type { Redis } from '@fleetvision/cache-redis';
/**
 * Alarm realtime gateway — Socket.IO server for alarm event push.
 *
 * Emits alarm.created / alarm.acknowledged / alarm.resolved to tenant-scoped
 * rooms (tenant:<tid>:alerts). Same JWT auth + tenant-validated room-join pattern
 * as gps-engine's realtime gateway (Sprint 1 hardening). No second WS architecture.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as IoServer, type Socket } from 'socket.io';
import type { NotificationConfig } from '../../config/notification.config.js';
import type { AlarmOccurrence } from '../../domain/alarm-occurrence.js';
import type { Notification as NotificationEntity } from '../../domain/notification.js';

export interface AlarmRealtimeGatewayDeps {
  readonly config: NotificationConfig;
  readonly redis: Redis;
  readonly tokenVerifier: TokenVerifier;
}

interface WsPrincipal {
  readonly tenantId: string;
  readonly userId: string;
}

export class AlarmRealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AlarmRealtimeGateway');
  private io: IoServer | null = null;

  constructor(private readonly deps: AlarmRealtimeGatewayDeps) {}

  public async onApplicationBootstrap(): Promise<void> {
    if (!this.deps.config.NOTIF_WS_ENABLED) {
      this.logger.log('WebSocket alarm gateway disabled (NOTIF_WS_ENABLED=false).');
      return;
    }
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start alarm WS server — continuing without realtime push: ${(err as Error).message}`,
      );
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    this.io?.close();
    this.io = null;
  }

  private async start(): Promise<void> {
    const io = new IoServer(this.deps.config.NOTIF_WS_PORT, {
      cors: { origin: this.deps.config.NOTIF_WS_CORS_ORIGIN ?? '*' },
      maxHttpBufferSize: 1e6,
      pingTimeout: 30_000,
    });

    const pubClient = this.deps.redis;
    const subClient = this.deps.redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));

    // JWT auth on handshake (Sprint 1 hardening — rejects unauthenticated).
    io.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.token as string | undefined) ?? '';
        if (!token) {
          next(new Error('Authentication required.'));
          return;
        }
        const claims = await this.deps.tokenVerifier.verifyAccess(token);
        socket.data.principal = {
          tenantId: claims.tenant_id,
          userId: claims.sub,
        } satisfies WsPrincipal;
        next();
      } catch {
        next(new Error('Authentication required.'));
      }
    });

    io.on('connection', (socket: Socket) => {
      const principal = socket.data.principal as WsPrincipal | undefined;
      this.logger.debug(`WS alarm client connected: ${socket.id} tenant=${principal?.tenantId}`);
      // Tenant-validated room join (same pattern as gps-engine).
      socket.on('subscribe', (room: unknown) => {
        if (!principal || typeof room !== 'string') {
          socket.disconnect(true);
          return;
        }
        const allowedRooms = [
          `tenant:${principal.tenantId}:alerts`,
          `tenant:${principal.tenantId}:notifications`,
          // Sprint H §39/45 — per-user room so targeted notifications reach
          // only the authorized user.
          `user:${principal.tenantId}:${principal.userId}`,
        ];
        if (!allowedRooms.includes(room)) {
          this.logger.warn(`WS ${socket.id} denied join to ${room}`);
          return;
        }
        socket.join(room);
      });
      socket.on('disconnect', () => {
        this.logger.debug(`WS alarm client disconnected: ${socket.id}`);
      });
    });

    this.io = io;
    this.logger.log(`Alarm WS server listening on :${this.deps.config.NOTIF_WS_PORT}`);
  }

  /** Emit alarm.created to the tenant's alerts room. */
  public emitAlarmCreated(tenantId: string, alarm: AlarmOccurrence): void {
    this.io?.to(`tenant:${tenantId}:alerts`).emit('alarm.created', {
      id: alarm.id,
      type: alarm.type,
      severity: alarm.severity,
      status: alarm.status,
      vehicleId: alarm.vehicleId,
      message: alarm.message,
      lat: alarm.lat,
      lng: alarm.lng,
      raisedAt: alarm.raisedAt,
    });
  }

  /** Emit alarm.acknowledged. */
  public emitAlarmAcknowledged(tenantId: string, alarm: AlarmOccurrence): void {
    this.io?.to(`tenant:${tenantId}:alerts`).emit('alarm.acknowledged', {
      id: alarm.id,
      status: alarm.status,
      acknowledgedAt: alarm.acknowledgedAt,
      acknowledgedBy: alarm.acknowledgedBy,
    });
  }

  /** Emit alarm.resolved. */
  public emitAlarmResolved(tenantId: string, alarm: AlarmOccurrence): void {
    this.io?.to(`tenant:${tenantId}:alerts`).emit('alarm.resolved', {
      id: alarm.id,
      status: alarm.status,
      resolvedAt: alarm.resolvedAt,
      resolvedBy: alarm.resolvedBy,
      resolutionReason: alarm.resolutionReason,
    });
  }

  /**
   * Emit notification.new (the bell). Targeted notifications (userId set) go
   * to the per-user room; broadcasts go to the tenant-wide notifications room.
   */
  public emitNotification(tenantId: string, notification: NotificationEntity): void {
    const room = notification.userId
      ? `user:${tenantId}:${notification.userId}`
      : `tenant:${tenantId}:notifications`;
    this.io?.to(room).emit('notification.new', {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      category: notification.category,
      severity: notification.severity,
      eventType: notification.eventType,
      vehicleId: notification.vehicleId,
      priority: notification.priority,
      link: notification.link,
      createdAt: notification.createdAt,
    });
  }
}
