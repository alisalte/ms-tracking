/**
 * FleetManagementModule — wires the fleet/vehicle/device domain (repositories,
 * application services, Kafka session-lifecycle consumer) and the REST API.
 * Mirrors the gps-engine / identity factory-`forRoot` style: providers are built
 * from the global knex token + the validated config.
 *
 * On bootstrap it starts the session-lifecycle consumer (non-fatal). Kafka/Redis/
 * Postgres down does NOT stop the REST API from booting.
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { BindingService } from '../application/binding.service.js';
import { DeviceService } from '../application/device.service.js';
import { FleetService } from '../application/fleet.service.js';
import { VehicleService } from '../application/vehicle.service.js';
import type { FleetManagementConfig } from '../config/fleet-management.config.js';
import { RegistryInvalidationPublisher } from '../infrastructure/cache/registry-invalidation-publisher.js';
import { SessionLifecycleConsumer } from '../infrastructure/kafka/session-lifecycle-consumer.js';
import { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { BindingRepository } from '../infrastructure/persistence/binding.repository.js';
import { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import { FleetRepository } from '../infrastructure/persistence/fleet.repository.js';
import { VehicleRepository } from '../infrastructure/persistence/vehicle.repository.js';
import { DevicesController } from './devices.controller.js';
import { FleetsController } from './fleets.controller.js';
import {
  BINDING_SERVICE,
  DEVICE_REPOSITORY,
  DEVICE_SERVICE,
  FLEET_MANAGEMENT_CONFIG,
  FLEET_SERVICE,
  SESSION_LIFECYCLE_CONSUMER,
  VEHICLE_SERVICE,
} from './tokens.js';
import { VehiclesController } from './vehicles.controller.js';

@Module({})
export class FleetManagementModule {
  public static forRoot(config: FleetManagementConfig): DynamicModule {
    return {
      module: FleetManagementModule,
      providers: [
        { provide: FLEET_MANAGEMENT_CONFIG, useValue: config },
        // Sprint D §11 — push-based gateway auth-cache invalidation (best-effort).
        {
          provide: 'REGISTRY_INVALIDATION_PUBLISHER',
          inject: [REDIS_TOKEN],
          useFactory: (redis: unknown) => new RegistryInvalidationPublisher(redis as never),
        },
        // Repositories (take the global knex client).
        {
          provide: DEVICE_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new DeviceRepository(knex as never),
        },
        // Audit + remaining repos are stateless; construct directly via factories.
        {
          provide: AuditRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new AuditRepository(knex as never),
        },
        {
          provide: FleetRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new FleetRepository(knex as never),
        },
        {
          provide: VehicleRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new VehicleRepository(knex as never),
        },
        {
          provide: BindingRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new BindingRepository(knex as never),
        },
        // Application services (compose repos + audit + knex for transactions).
        {
          provide: FLEET_SERVICE,
          inject: [KNEX_TOKEN, FleetRepository, AuditRepository],
          useFactory: (knex: unknown, fleets: FleetRepository, audit: AuditRepository) =>
            new FleetService(knex as never, fleets, audit),
        },
        {
          provide: VEHICLE_SERVICE,
          inject: [KNEX_TOKEN, VehicleRepository, FleetRepository, AuditRepository],
          useFactory: (
            knex: unknown,
            vehicles: VehicleRepository,
            fleets: FleetRepository,
            audit: AuditRepository,
          ) => new VehicleService(knex as never, vehicles, fleets, audit),
        },
        {
          provide: DEVICE_SERVICE,
          inject: [
            KNEX_TOKEN,
            DeviceRepository,
            AuditRepository,
            'REGISTRY_INVALIDATION_PUBLISHER',
          ],
          useFactory: (
            knex: unknown,
            devices: DeviceRepository,
            audit: AuditRepository,
            invalidation: RegistryInvalidationPublisher,
          ) => new DeviceService(knex as never, devices, audit, invalidation),
        },
        {
          provide: BINDING_SERVICE,
          inject: [
            KNEX_TOKEN,
            VehicleRepository,
            DeviceRepository,
            BindingRepository,
            AuditRepository,
            'REGISTRY_INVALIDATION_PUBLISHER',
          ],
          useFactory: (
            knex: unknown,
            vehicles: VehicleRepository,
            devices: DeviceRepository,
            bindings: BindingRepository,
            audit: AuditRepository,
            invalidation: RegistryInvalidationPublisher,
          ) =>
            new BindingService(knex as never, vehicles, devices, bindings, audit, invalidation),
        },
        // Kafka session-lifecycle consumer (non-fatal at boot).
        {
          provide: SESSION_LIFECYCLE_CONSUMER,
          inject: [FLEET_MANAGEMENT_CONFIG, DEVICE_REPOSITORY],
          useFactory: (cfg: FleetManagementConfig, devices: DeviceRepository) =>
            new SessionLifecycleConsumer(cfg, devices),
        },
      ],
      controllers: [FleetsController, VehiclesController, DevicesController],
    };
  }
}
