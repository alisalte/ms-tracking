import { randomUUID } from 'node:crypto';
/**
 * GatewayModule — wires the device-gateway components (06 §1.5 module structure).
 *
 * Composes the cross-cutting packages (config/logger/persistence/redis/health
 * /metrics) with the gateway core: protocol adapters, transport servers, session
 * manager, auth resolver, packet dispatcher, Kafka producer, and the admin API.
 * Mirrors the identity-service factory-`forRoot` style — providers are
 * constructed from the global knex/redis tokens and the validated
 * DeviceGatewayConfig.
 *
 * On bootstrap it: registers built-in adapters, loads any plugins, opens the
 * configured listeners, and starts the TCP/UDP servers + the liveness sweeper.
 * Kafka/Redis/DB are non-fatal — the gateway boots and serves devices even when
 * they are down.
 *
 * Sprint D reliability hardening:
 *   - duplicate-connection enforcement (newest session wins, local + cross-pod);
 *   - pool-full rejection (socket destroyed);
 *   - UDP pseudo-session reuse (no per-datagram leak);
 *   - periodic liveness sweep (auth-grace / UDP TTL / superseded detection);
 *   - registry cache invalidation subscriber (push-based, Redis pub/sub);
 *   - graceful shutdown (listeners → sessions → producer in order);
 *   - Prometheus metrics on /metrics.
 */
import { METRICS_TOKEN, type TelemetryMetrics } from '@fleetvision/observability';
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { EXTRA_READINESS_INDICATORS } from '@fleetvision/health';
import { Inject, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
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
import {
  RegistryInvalidationSubscriber,
  type DeviceRegistry,
  HttpDeviceRegistry,
} from '../infrastructure/registry/index.js';
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
export class GatewayModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GatewayModule.name);
  private tcpServer: TcpServer | null = null;
  private udpServer: UdpServer | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

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
        // Device registry — production calls fleet-management-service over HTTP
        // (HttpDeviceRegistry); the gateway never knows fleet's DB schema (Sprint C
        // §17). Reached only on an L1+L2 cache miss. InMemoryDeviceRegistry stays
        // available for unit tests (constructed directly).
        {
          provide: DEVICE_REGISTRY,
          useFactory: () =>
            new HttpDeviceRegistry({
              baseUrl: config.FLEET_REGISTRY_URL,
              apiKey: config.FLEET_REGISTRY_API_KEY,
              timeoutMs: config.FLEET_REGISTRY_TIMEOUT_MS,
              maxRetries: config.FLEET_REGISTRY_MAX_RETRIES,
              retryBackoffMs: config.FLEET_REGISTRY_RETRY_BACKOFF_MS,
            }),
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
        // Kafka producer (non-fatal at boot — lazy connect). Sprint D: bounded
        // retry, linger, event listeners, metrics.
        {
          provide: KAFKA_PRODUCER,
          inject: [METRICS_TOKEN],
          useFactory: (metrics: TelemetryMetrics) =>
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
              lingerMs: config.GATEWAY_KAFKA_LINGER_MS,
              retry: {
                retries: config.GATEWAY_KAFKA_RETRIES,
                initialRetryIntervalMs: config.GATEWAY_KAFKA_RETRY_INITIAL_MS,
                maxRetryIntervalMs: config.GATEWAY_KAFKA_RETRY_MAX_MS,
              },
              metrics,
            }),
        },
        // Session manager — env-configured TTLs + auth grace.
        {
          provide: SESSION_MANAGER,
          inject: ['GATEWAY_SESSION_REDIS', KAFKA_PRODUCER, INSTANCE_ID],
          useFactory: (store: SessionRedisStore, kafka: DeviceGatewayKafkaProducer, pod: string) =>
            new SessionManager(store, kafka, pod, {
              tcpTtlSeconds: config.GATEWAY_TCP_SESSION_TTL_SECONDS,
              udpTtlSeconds: config.GATEWAY_UDP_SESSION_TTL_SECONDS,
              authGraceMs: config.GATEWAY_AUTH_GRACE_SECONDS * 1000,
              supersededCheckIntervalMs: config.GATEWAY_SWEEP_INTERVAL_SECONDS * 1000,
            }),
        },
        // Auth resolver — env-configured L1/L2 cache ladder.
        {
          provide: 'GATEWAY_AUTH_RESOLVER',
          inject: [REDIS_TOKEN, DEVICE_REGISTRY],
          useFactory: (redis: Redis, registry: DeviceRegistry) =>
            new AuthResolver(redis, registry, {
              l1MaxEntries: config.GATEWAY_AUTH_L1_MAX_ENTRIES,
              l1TtlMs: config.GATEWAY_AUTH_L1_TTL_SECONDS * 1000,
              l2TtlSeconds: config.GATEWAY_AUTH_L2_TTL_SECONDS,
            }),
        },
        // Registry cache invalidation subscriber (push-based, Redis pub/sub — Sprint D §11).
        {
          provide: 'REGISTRY_INVALIDATION_SUBSCRIBER',
          inject: [REDIS_TOKEN, 'GATEWAY_AUTH_RESOLVER'],
          useFactory: (redis: Redis, authResolver: AuthResolver) =>
            new RegistryInvalidationSubscriber(redis, authResolver),
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
        // Sprint D §35 — Kafka-producer readiness (checked in /health/ready).
        // Liveness never checks Kafka ("alive but not ready" stays expressible).
        {
          provide: EXTRA_READINESS_INDICATORS,
          inject: [KAFKA_PRODUCER],
          useFactory: (kafka: DeviceGatewayKafkaProducer) => [
            async () => ({
              kafka_producer: {
                status: kafka.isConnected ? 'up' : 'down',
              },
            }),
          ],
        },
        AdminController,
      ],
      controllers: [AdminController],
      exports: [KAFKA_PRODUCER, EXTRA_READINESS_INDICATORS],
    };
  }

  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: DeviceGatewayConfig,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
    @Inject(SESSION_MANAGER) private readonly sessions: SessionManager,
    @Inject(PACKET_DISPATCHER) private readonly dispatcher: PacketDispatcher,
    @Inject(CONNECTION_POOL) private readonly pool: ConnectionPool,
    @Inject(INSTANCE_ID) private readonly instanceId: string,
    @Inject('REGISTRY_INVALIDATION_SUBSCRIBER')
    private readonly invalidationSubscriber: RegistryInvalidationSubscriber,
    @Inject(METRICS_TOKEN) private readonly metrics: TelemetryMetrics,
  ) {}

  /** Open the configured TCP/UDP listeners once the DI graph is ready. */
  public async onApplicationBootstrap(): Promise<void> {
    // Sprint D §11 — start push-based registry cache invalidation.
    await this.invalidationSubscriber.start().catch((err) => {
      this.logger.warn(`Registry invalidation subscriber not started: ${(err as Error).message}`);
    });

    const listeners = parseListeners(this.config.GATEWAY_LISTENERS);
    if (listeners.length === 0) {
      this.logger.warn('No listeners configured (GATEWAY_LISTENERS empty) — idle gateway.');
    } else {
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
              onOpen: (ctx) =>
                this.sessions.registerTerminator(ctx.session.id as string, () =>
                  ctx.socket.destroy(),
                ),
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

      this.tcpServer = tcpServer;
      this.udpServer = udpServer;
      await Promise.all([tcpServer.startAll(), udpServer.startAll()]);
    }

    // Sprint D §7 — periodic liveness sweep: auth-grace close, UDP TTL expiry,
    // cross-instance superseded detection.
    const sweepMs = this.config.GATEWAY_SWEEP_INTERVAL_SECONDS * 1000;
    this.sweepTimer = setInterval(() => {
      this.sessions
        .sweep()
        .then((r) => {
          if (r.closedAuthGrace + r.closedUdpTtl + r.closedSuperseded > 0) {
            this.logger.debug(
              `Sweep: ${r.closedAuthGrace} auth-grace, ${r.closedUdpTtl} udp-ttl, ${r.closedSuperseded} superseded.`,
            );
          }
        })
        .catch((err) => this.logger.warn(`Sweep error: ${(err as Error).message}`));
    }, sweepMs);
    // Don't keep the process alive on the sweeper alone (graceful exit).
    this.sweepTimer.unref?.();
  }

  public async onApplicationShutdown(): Promise<void> {
    // Sprint D §36 — graceful, ordered shutdown:
    //   1. stop accepting (listeners close);
    //   2. close all sessions (SHUTDOWN) — destroys sockets + emits DISCONNECTED;
    //   3. invalidation subscriber + producer disconnect (registered providers);
    //   4. knex/redis (shared packages).
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    await Promise.allSettled([this.tcpServer?.stopAll(), this.udpServer?.stopAll()]);
    await this.sessions.closeAll('SHUTDOWN').catch((err) => {
      this.logger.warn(`Error closing sessions on shutdown: ${(err as Error).message}`);
    });
  }

  /**
   * Open a session for a new connection. Returns null (reject) when the pool is
   * at its hard cap so the transport destroys the socket (Sprint D §7).
   */
  private openSession(init: {
    transport: 'tcp' | 'udp';
    protocolId: string;
    remoteAddress: string;
    remotePort: number;
  }): DeviceSession | null {
    // UDP pseudo-session reuse (06 §4.4): if a live session exists for this
    // source, refresh it instead of leaking a new one per datagram (Sprint D §7).
    if (init.transport === 'udp') {
      const existing = this.sessions.udpSessionFor(
        init.protocolId,
        init.remoteAddress,
        init.remotePort,
      );
      if (existing) {
        existing.touch();
        return existing;
      }
    }
    const session = DeviceSession.open({ ...init, instanceId: this.instanceId });
    if (!this.pool.admit(session)) {
      this.metrics.gatewayConnections.inc({ result: 'rejected_pool_full' });
      this.logger.warn('Connection pool full — rejecting new connection (back-pressure).');
      return null;
    }
    this.sessions.track(session);
    this.metrics.gatewayConnections.inc({ result: 'accepted' });
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
