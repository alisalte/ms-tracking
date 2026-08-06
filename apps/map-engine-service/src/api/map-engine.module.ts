/**
 * MapEngineModule — wires the Map Engine components (08 §1.5).
 *
 * Composes the cross-cutting packages with the engine core: geo repositories
 * (geofences, POIs, replay), Redis geo cache, the provider abstraction (local
 * provider + router), the application services (cluster, replay, geofence, POI),
 * and the REST API.
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { ClusterService } from '../application/cluster-service.js';
import { GeofenceService } from '../application/geofence-service.js';
import { PoiService } from '../application/poi-service.js';
import { ProviderRouter } from '../application/provider-router.js';
import { ReplayService } from '../application/replay-service.js';
import type { MapEngineConfig } from '../config/map-engine.config.js';
import { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';
import { GeofenceRepository } from '../infrastructure/persistence/geofence.repository.js';
import { PoiRepository } from '../infrastructure/persistence/poi.repository.js';
import { ReplayRepository } from '../infrastructure/persistence/replay.repository.js';
import { LocalProvider } from '../infrastructure/provider/local-provider.js';
import { LocationController } from './location.controller.js';
import { MapController } from './map.controller.js';
import { RouteController } from './route.controller.js';
import {
  CLUSTER_SERVICE,
  GEOFENCE_REPOSITORY,
  GEOFENCE_SERVICE,
  GEO_CACHE,
  MAP_ENGINE_CONFIG,
  MAP_PROVIDER,
  POI_REPOSITORY,
  POI_SERVICE,
  PROVIDER_ROUTER,
  REPLAY_REPOSITORY,
  REPLAY_SERVICE,
} from './tokens.js';

@Module({})
export class MapEngineModule {
  public static forRoot(config: MapEngineConfig): DynamicModule {
    return {
      module: MapEngineModule,
      providers: [
        { provide: MAP_ENGINE_CONFIG, useValue: config },

        // --- Repositories (read/write the geo + tracking schemas) ---
        {
          provide: GEOFENCE_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new GeofenceRepository(knex as never),
        },
        {
          provide: POI_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new PoiRepository(knex as never),
        },
        {
          provide: REPLAY_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new ReplayRepository(knex as never),
        },

        // --- Redis geo cache ---
        {
          provide: GEO_CACHE,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) =>
            new RedisGeoCache(
              redis,
              config.MAP_CACHE_TTL_SECONDS,
              config.MAP_CLUSTER_CACHE_TTL_SECONDS,
            ),
        },

        // --- Provider abstraction (local provider + router) ---
        {
          provide: MAP_PROVIDER,
          inject: [KNEX_TOKEN, GEO_CACHE],
          useFactory: (knex: unknown, cache: RedisGeoCache) =>
            new LocalProvider({ knex: knex as never, cache }),
        },
        {
          provide: PROVIDER_ROUTER,
          inject: [MAP_PROVIDER, MAP_ENGINE_CONFIG],
          useFactory: (provider: LocalProvider, cfg: MapEngineConfig) =>
            new ProviderRouter({
              providers: new Map([[cfg.MAP_DEFAULT_PROVIDER, provider]]),
              defaultProvider: cfg.MAP_DEFAULT_PROVIDER,
              region: cfg.MAP_PROVIDER_REGION,
            }),
        },

        // --- Application services ---
        {
          provide: CLUSTER_SERVICE,
          inject: [KNEX_TOKEN, GEO_CACHE, MAP_ENGINE_CONFIG],
          useFactory: (knex: unknown, cache: RedisGeoCache, cfg: MapEngineConfig) =>
            new ClusterService({ knex: knex as never, cache, maxClusters: cfg.MAP_MAX_CLUSTERS }),
        },
        {
          provide: REPLAY_SERVICE,
          inject: [REPLAY_REPOSITORY, GEO_CACHE, MAP_ENGINE_CONFIG],
          useFactory: (repo: ReplayRepository, cache: RedisGeoCache, cfg: MapEngineConfig) =>
            new ReplayService({
              replayRepo: repo,
              cache,
              replayCacheTtlSeconds: cfg.MAP_REPLAY_CACHE_TTL_SECONDS,
            }),
        },
        {
          provide: GEOFENCE_SERVICE,
          inject: [GEOFENCE_REPOSITORY],
          useFactory: (repo: GeofenceRepository) => new GeofenceService({ repo }),
        },
        {
          provide: POI_SERVICE,
          inject: [POI_REPOSITORY],
          useFactory: (repo: PoiRepository) => new PoiService({ repo }),
        },

        MapController,
        LocationController,
        RouteController,
      ],
      controllers: [MapController, LocationController, RouteController],
    };
  }
}
