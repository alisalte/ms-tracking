import { AuthCoreModule, jwtAuthGuardProvider } from '@fleetvision/auth';
/**
 * MediaModule — wires the media-service components (09 §1.5).
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { ChannelManager } from '../application/channel-manager.js';
import { StreamManager } from '../application/stream-manager.js';
import type { MediaConfig } from '../config/media.config.js';
import { RedisSessionCache } from '../infrastructure/cache/redis-session-cache.js';
import { StubMediaRouter } from '../infrastructure/media-router-port.js';
import { ChannelRepository } from '../infrastructure/persistence/channel.repository.js';
import { SessionRepository } from '../infrastructure/persistence/session.repository.js';
import { SignalingGateway } from '../infrastructure/signaling/signaling-gateway.js';
import { StreamsController } from './streams.controller.js';
import {
  CHANNEL_MANAGER,
  CHANNEL_REPOSITORY,
  MEDIA_CONFIG,
  MEDIA_ROUTER,
  SESSION_CACHE,
  SESSION_REPOSITORY,
  SIGNALING_GATEWAY,
  STREAM_MANAGER,
} from './tokens.js';

@Module({})
export class MediaModule {
  public static forRoot(config: MediaConfig): DynamicModule {
    return {
      module: MediaModule,
      imports: [
        AuthCoreModule.forRoot({
          jwtSecret: config.JWT_SECRET,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        }),
      ],
      providers: [
        jwtAuthGuardProvider(),
        { provide: MEDIA_CONFIG, useValue: config },

        // Repositories.
        {
          provide: CHANNEL_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new ChannelRepository(knex as never),
        },
        {
          provide: SESSION_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new SessionRepository(knex as never),
        },

        // Redis session cache.
        {
          provide: SESSION_CACHE,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) =>
            new RedisSessionCache(redis, config.MEDIA_SIGNALING_TOKEN_TTL_SECONDS),
        },

        // Media router (stub for Sprint 10 — real SFU wired when MEDIA_ROUTER_URL is set).
        {
          provide: MEDIA_ROUTER,
          useFactory: () => new StubMediaRouter(),
        },

        // Application services.
        {
          provide: CHANNEL_MANAGER,
          inject: [CHANNEL_REPOSITORY],
          useFactory: (repo: ChannelRepository) => new ChannelManager({ repo }),
        },
        {
          provide: STREAM_MANAGER,
          inject: [MEDIA_CONFIG, MEDIA_ROUTER, SESSION_CACHE, SESSION_REPOSITORY],
          useFactory: (
            cfg: MediaConfig,
            router: StubMediaRouter,
            cache: RedisSessionCache,
            repo: SessionRepository,
          ) => new StreamManager({ config: cfg, router, sessionCache: cache, sessionRepo: repo }),
        },

        // Signaling gateway.
        {
          provide: SIGNALING_GATEWAY,
          inject: [MEDIA_CONFIG, REDIS_TOKEN, SESSION_CACHE],
          useFactory: (cfg: MediaConfig, redis: Redis, cache: RedisSessionCache) =>
            new SignalingGateway({ config: cfg, redis, sessionCache: cache }),
        },

        StreamsController,
      ],
      controllers: [StreamsController],
    };
  }
}
