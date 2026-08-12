/**
 * Realtime WebSocket gateway — Socket.IO broadcaster (07 §11).
 *
 * Subscribes to the signal bus (position.update / device.status) and fans the
 * signals out to authorized Socket.IO rooms:
 *   - `tenant:<tid>:fleet`           — all vehicles in a tenant.
 *   - `tenant:<tid>:vehicle:<vid>`   — a single vehicle.
 *
 * SECURITY (Sprint 1): every connection is authenticated via the identity-issued
 * HS256 JWT (handshake.auth.token), and every room join is validated against the
 * caller's tenant — a client may only join rooms prefixed with its own
 * `tenant:<tenantId>:...`. Unauthenticated clients cannot connect; authenticated
 * clients cannot subscribe to another tenant's realtime data.
 *
 * Multi-pod fan-out: the `@socket.io/redis-adapter` propagates emissions to
 * sibling broadcaster pods via Redis pub/sub, so a client connected to any pod
 * receives the update (07 §11.3, ADR-015).
 *
 * Delivery semantics (07 §11.4): at-most-once over WebSocket — no ack/retry.
 *
 * Graceful disable: when GPS_WS_ENABLED=false, the gateway is a no-op (the signal
 * bus still receives emissions, they just go nowhere) — useful for headless test
 * environments and the non-fatal-boot contract.
 */
import type { TokenVerifier } from '@fleetvision/auth';
import type { Redis } from '@fleetvision/cache-redis';
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as IoServer, type Socket } from 'socket.io';
import type {
  DeviceStatusSignal,
  PositionSignal,
  SignalBus,
} from '../../application/signal-bus.js';
import type { GpsEngineConfig } from '../../config/gps-engine.config.js';

export interface RealtimeGatewayDeps {
  readonly config: GpsEngineConfig;
  readonly redis: Redis;
  readonly signalBus: SignalBus;
  /** Verifies the identity-issued JWT presented on the WS handshake. */
  readonly tokenVerifier: TokenVerifier;
}

interface WsPrincipal {
  readonly tenantId: string;
  readonly userId: string;
}

export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('RealtimeGateway');
  private io: IoServer | null = null;

  constructor(private readonly deps: RealtimeGatewayDeps) {}

  public async onApplicationBootstrap(): Promise<void> {
    if (!this.deps.config.GPS_WS_ENABLED) {
      this.logger.log('WebSocket broadcaster disabled (GPS_WS_ENABLED=false).');
      this.attachSignalListeners();
      return;
    }
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start WebSocket server — continuing without realtime push: ${(err as Error).message}`,
      );
    }
    // Always attach signal listeners so the pipeline never blocks on the bus,
    // even when the WS server failed to start.
    this.attachSignalListeners();
  }

  public async onApplicationShutdown(): Promise<void> {
    this.io?.close();
    this.io = null;
  }

  private async start(): Promise<void> {
    const io = new IoServer(this.deps.config.GPS_WS_PORT, {
      // CORS restricted to a configurable origin list (default '*' for local dev;
      // production sets GPS_WS_CORS_ORIGIN to the dashboard origin(s)).
      cors: { origin: this.deps.config.GPS_WS_CORS_ORIGIN ?? '*' },
      // Coalescing: a slow client's buffer fills → disconnect (07 §11.4).
      maxHttpBufferSize: 1e6,
      pingTimeout: 30_000,
    });

    // Redis adapter for multi-pod fan-out (ADR-015).
    const pubClient = this.deps.redis;
    const subClient = this.deps.redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));

    // --- Authentication middleware: verify the JWT on the handshake. ---
    io.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.token as string | undefined) ?? '';
        if (!token) {
          next(new Error('Authentication required.'));
          return;
        }
        const claims = await this.deps.tokenVerifier.verifyAccess(token);
        // Attach the verified tenant so room joins can be validated against it.
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
      this.logger.debug(`WS client connected: ${socket.id} tenant=${principal?.tenantId}`);
      // Room join: client emits 'subscribe' with a room name. The room MUST be a
      // tenant-namespaced room owned by the caller (tenant:<ownTenantId>:...).
      socket.on('subscribe', (room: unknown) => {
        if (!principal || typeof room !== 'string') {
          socket.disconnect(true);
          return;
        }
        if (!isAllowedRoom(room, principal.tenantId)) {
          // Cross-tenant or malformed join → deny (do NOT disclose the room).
          this.logger.warn(
            `WS ${socket.id} denied join to ${room} (tenant ${principal.tenantId}).`,
          );
          return;
        }
        socket.join(room);
        this.logger.debug(`WS ${socket.id} joined room ${room}`);
      });
      socket.on('unsubscribe', (room: unknown) => {
        if (typeof room === 'string') socket.leave(room);
      });
      socket.on('disconnect', () => {
        this.logger.debug(`WS client disconnected: ${socket.id}`);
      });
    });

    this.io = io;
    this.logger.log(`WebSocket server listening on :${this.deps.config.GPS_WS_PORT}`);
  }

  /** Wire signal-bus emissions → Socket.IO room broadcasts. */
  private attachSignalListeners(): void {
    this.deps.signalBus.onPosition((signal) => this.onPosition(signal));
    this.deps.signalBus.onDeviceStatus((signal) => this.onDeviceStatus(signal));
    // Sprint 8: trip/idle/parking/engine-hours boundary events.
    this.deps.signalBus.onTrip((event) => this.onTripEvent(event));
    this.deps.signalBus.onIdle((event) => this.onIdleEvent(event));
    this.deps.signalBus.onParking((event) => this.onParkingEvent(event));
    this.deps.signalBus.onEngineHours((signal) => this.onEngineHours(signal));
  }

  private onPosition(signal: PositionSignal): void {
    if (!this.io) return;
    const fleetRoom = `tenant:${signal.tenantId}:fleet`;
    const vehicleRoom = `tenant:${signal.tenantId}:vehicle:${signal.vehicleId}`;
    this.io.to(fleetRoom).emit('position.update', signal);
    this.io.to(vehicleRoom).emit('position.update', signal);
  }

  private onDeviceStatus(signal: DeviceStatusSignal): void {
    if (!this.io) return;
    const fleetRoom = `tenant:${signal.tenantId}:fleet`;
    this.io.to(fleetRoom).emit('device.status', signal);
  }

  /** Sprint 8: broadcast trip/idle/parking/engine-hours events to fleet rooms. */
  private onTripEvent(event: { tenantId: string; vehicleId: string; type: string }): void {
    if (!this.io) return;
    const fleetRoom = `tenant:${event.tenantId}:fleet`;
    const vehicleRoom = `tenant:${event.tenantId}:vehicle:${event.vehicleId}`;
    this.io.to(fleetRoom).emit('trip.event', event);
    this.io.to(vehicleRoom).emit('trip.event', event);
  }

  private onIdleEvent(event: { tenantId: string; vehicleId: string }): void {
    if (!this.io) return;
    this.io.to(`tenant:${event.tenantId}:fleet`).emit('idle.event', event);
  }

  private onParkingEvent(event: { tenantId: string; vehicleId: string }): void {
    if (!this.io) return;
    this.io.to(`tenant:${event.tenantId}:fleet`).emit('parking.event', event);
  }

  private onEngineHours(signal: { tenantId: string; vehicleId: string }): void {
    if (!this.io) return;
    this.io.to(`tenant:${signal.tenantId}:fleet`).emit('engine.hours', signal);
  }
}

/**
 * A room is allowed iff it is tenant-namespaced AND the tenant id in the room
 * name equals the caller's own tenant id. Accepted shapes:
 *   tenant:<tid>:fleet
 *   tenant:<tid>:vehicle:<vid>
 * This blocks cross-tenant subscription without disclosing valid room names.
 */
export function isAllowedRoom(room: string, tenantId: string): boolean {
  const fleet = `tenant:${tenantId}:fleet`;
  const vehiclePrefix = `tenant:${tenantId}:vehicle:`;
  return room === fleet || (room.startsWith(vehiclePrefix) && room.length > vehiclePrefix.length);
}
