import { randomUUID } from 'node:crypto';
/**
 * GatewayModule — wires the device-gateway components (06 §1.5 module structure).
 *
 * Composes the cross-cutting packages (config/logger/persistence/redis/health)
 * with the gateway core: protocol adapters, transport servers, session manager,
 * auth resolver, packet dispatcher, Kafka producer, and the admin API. Mirrors
 * the identity-service factory-`forRoot` style — providers are constructed from
 * the global knex/redis tokens and the validated DeviceGatewayConfig.
 *
 * On bootstrap it: registers built-in adapters, loads any plugins, opens the
 * configured listeners, and starts the TCP/UDP servers. Kafka/Redis/DB are
 * non-fatal — the gateway boots and serves devices even when they are down.
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Module } from '@nestjs/common';
import {
  AuthResolver,
  ConnectionPool,
  PacketDispatcher,
  SessionManager,
} from '../application/index.js';
import { type DeviceGatewayConfig, parseListeners } from '../config/device-gateway.config.js';
import { DeviceSession, RawPacket } from '../domain/index.js';
import { BUILTIN_ADAPTERS } from '../infrastructure/adapters/index.js';
import { DeviceGatewayKafkaProducer } from '../infrastructure/kafka/index.js';
import {
  AdapterRegistry,
  PluginLoader,
  type ProtocolAdapter,
} from '../infrastructure/protocol/index.js';
import { InMemoryDeviceRegistry } from '../infrastructure/registry/index.js';
import { RawPacketStorage, SessionRedisStore } from '../infrastructure/storage/index.js';
import {
  TcpListener,
  TcpServer,
  UdpListener,
  UdpServer,
} from '../infrastructure/transport/index.js';
import { AdminController } from './admin/admin.controller.js';
import {
  ADAPTER_REGISTRY,
  CONNECTION_POOL,
  DEVICE_REGISTRY,
  GATEWAY_CONFIG,
  INSTANCE_ID,
  KAFKA_PRODUCER,
  PACKET_DISPATCHER,
  SESSION_MANAGER,
} from './tokens.js';

// Re-export the tokens so existing import paths (`from './gateway.module.js'`)
// keep resolving — the source of truth is tokens.ts.
export {
  ADAPTER_REGISTRY,
  SESSION_MANAGER,
  PACKET_DISPATCHER,
  CONNECTION_POOL,
  KAFKA_PRODUCER,
  DEVICE_REGISTRY,
  INSTANCE_ID,
  GATEWAY_CONFIG,
} from './tokens.js';

@Module({})
export class GatewayModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(GatewayModule.name);

  public static forRoot(config: DeviceGatewayConfig) {
    const instanceId = `pod-${randomUUID()}`;

    return {
      module: GatewayModule,
      providers: [
        { provide: INSTANCE_ID, useValue: instanceId },
        { provide: GATEWAY_CONFIG, useValue: config },
        // Adapter registry + built-in adapters + plugin loader.
        {
          provide: ADAPTER_REGISTRY,
          useFactory: async () => {
            const registry = new AdapterRegistry();
            for (const adapter of BUILTIN_ADAPTERS) registry.register(adapter, false);
            if (config.GATEWAY_PLUGIN_DIR) {
              const loader = new PluginLoader({ pluginDir: config.GATEWAY_PLUGIN_DIR });
              const plugins = await loader.discover();
              for (const p of plugins) registry.register(p, true);
            }
            return registry;
          },
        },
        // Device registry (in-memory for Sprint 3; gRPC client later).
        {
          provide: DEVICE_REGISTRY,
          useValue: new InMemoryDeviceRegistry(),
        },
        // Connection pool.
        {
          provide: CONNECTION_POOL,
          useFactory: () =>
            new ConnectionPool({
              maxConnections: config.GATEWAY_MAX_CONNECTIONS,
              reportingIntervalMs: config.GATEWAY_DEFAULT_REPORTING_INTERVAL_SECONDS * 1000,
              evictionThreshold: Math.floor(config.GATEWAY_MAX_CONNECTIONS * 0.9),
            }),
        },
        // Session-redis store (best-effort — Redis may be down at boot).
        {
          provide: 'GATEWAY_SESSION_REDIS',
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new SessionRedisStore(redis),
        },
        // Kafka producer (non-fatal at boot — lazy connect).
        {
          provide: KAFKA_PRODUCER,
          useFactory: () =>
            new DeviceGatewayKafkaProducer({
              brokers: config.GATEWAY_KAFKA_BROKERS.split(','),
              clientId: config.GATEWAY_KAFKA_CLIENT_ID,
              topics: {
                position: config.GATEWAY_KAFKA_POSITION_TOPIC,
                alarm: config.GATEWAY_KAFKA_ALARM_TOPIC,
                device: config.GATEWAY_KAFKA_DEVICE_TOPIC,
                commandAck: 'fleetvision.telemetry.command.ack',
                session: config.GATEWAY_KAFKA_SESSION_TOPIC,
              },
            }),
        },
        // Session manager.
        {
          provide: SESSION_MANAGER,
          inject: ['GATEWAY_SESSION_REDIS', KAFKA_PRODUCER, INSTANCE_ID],
          useFactory: (store: SessionRedisStore, kafka: DeviceGatewayKafkaProducer, pod: string) =>
            new SessionManager(store, kafka, pod, {
              tcpTtlSeconds: 60,
              udpTtlSeconds: config.GATEWAY_UDP_SESSION_TTL_SECONDS,
            }),
        },
        // Auth resolver.
        {
          provide: 'GATEWAY_AUTH_RESOLVER',
          inject: [REDIS_TOKEN, DEVICE_REGISTRY],
          useFactory: (redis: Redis, registry: InMemoryDeviceRegistry) =>
            new AuthResolver(redis, registry),
        },
        // Raw packet storage.
        { provide: 'GATEWAY_RAW_STORAGE', useValue: new RawPacketStorage() },
        // Packet dispatcher.
        {
          provide: PACKET_DISPATCHER,
          inject: ['GATEWAY_AUTH_RESOLVER', SESSION_MANAGER, KAFKA_PRODUCER, 'GATEWAY_RAW_STORAGE'],
          useFactory: (
            authResolver: AuthResolver,
            sessions: SessionManager,
            kafka: DeviceGatewayKafkaProducer,
            raw: RawPacketStorage,
          ) =>
            new PacketDispatcher({
              authResolver,
              sessionManager: sessions,
              kafka,
              rawStorage: raw,
            }),
        },
        AdminController,
      ],
      controllers: [AdminController],
    };
  }

  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: DeviceGatewayConfig,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
    @Inject(SESSION_MANAGER) private readonly sessions: SessionManager,
    @Inject(PACKET_DISPATCHER) private readonly dispatcher: PacketDispatcher,
    @Inject(CONNECTION_POOL) private readonly pool: ConnectionPool,
    @Inject(INSTANCE_ID) private readonly instanceId: string,
  ) {}

  /** Open the configured TCP/UDP listeners once the DI graph is ready. */
  public async onApplicationBootstrap(): Promise<void> {
    const listeners = parseListeners(this.config.GATEWAY_LISTENERS);
    if (listeners.length === 0) {
      this.logger.warn('No listeners configured (GATEWAY_LISTENERS empty) — idle gateway.');
      return;
    }

    const tcpServer = new TcpServer();
    const udpServer = new UdpServer();

    for (const l of listeners) {
      const adapter = this.adapters.get(l.adapterId);
      if (!adapter) {
        this.logger.warn(`Listener '${l.adapterId}' has no enabled adapter — skipping.`);
        continue;
      }
      if (l.transport === 'tcp') {
        tcpServer.add(
          `${l.adapterId}:tcp`,
          new TcpListener({
            adapter,
            port: l.port,
            host: this.config.GATEWAY_HOST,
            idleTimeoutMs: this.config.GATEWAY_TCP_IDLE_TIMEOUT_SECONDS * 1000,
            openSession: (init) => this.openSession(init),
            onPacket: async (ctx, payload) => this.onPacket(ctx, adapter, payload),
            onClose: (ctx, reason) => this.onClose(ctx.session, reason),
          }),
        );
      } else {
        udpServer.add(
          `${l.adapterId}:udp`,
          new UdpListener({
            adapter,
            port: l.port,
            host: this.config.GATEWAY_HOST,
            openSession: (init) => this.openSession(init),
            onPacket: async (ctx, payload) => {
              await this.onPacket(ctx, adapter, payload);
            },
          }),
        );
      }
    }

    await Promise.all([tcpServer.startAll(), udpServer.startAll()]);
  }

  private openSession(init: {
    transport: 'tcp' | 'udp';
    protocolId: string;
    remoteAddress: string;
    remotePort: number;
  }): DeviceSession {
    const session = DeviceSession.open({ ...init, instanceId: this.instanceId });
    if (!this.pool.admit(session)) {
      // Pool full — back-pressure (06 §5.1). The transport will close the socket.
      this.logger.warn('Connection pool full — admitting session for triage (back-pressure).');
    }
    this.sessions.track(session);
    return session;
  }

  private async onPacket(
    ctx: { session: DeviceSession },
    adapter: ProtocolAdapter,
    payload: Buffer,
  ): Promise<boolean> {
    const raw = new RawPacket({
      protocolId: adapter.id,
      payload,
      receivedAt: new Date(),
      direction: 'INBOUND',
    });
    try {
      const result = await this.dispatcher.dispatch(ctx.session, adapter, raw);
      if (result.close) {
        await this.sessions.close(ctx.session, result.closeReason ?? 'AUTH_FAILED');
        return false;
      }
    } catch (err) {
      this.logger.warn(`Dispatch error: ${(err as Error).message}`);
      return false;
    }
    return true;
  }

  private async onClose(session: DeviceSession, reason: string): Promise<void> {
    this.pool.release(session.id as string);
    await this.sessions.close(session, reason as never).catch(() => {
      /* best-effort */
    });
  }
}
