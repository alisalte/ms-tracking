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
import { DeviceCommandService } from '../application/device-command.service.js';
import { DeviceService } from '../application/device.service.js';
import { FleetService } from '../application/fleet.service.js';
import { SummaryService } from '../application/summary.service.js';
import { VehicleService } from '../application/vehicle.service.js';
import type { FleetManagementConfig } from '../config/fleet-management.config.js';
import { RegistryInvalidationPublisher } from '../infrastructure/cache/registry-invalidation-publisher.js';
import { CommandAckConsumer } from '../infrastructure/kafka/command-ack-consumer.js';
import { CommandRequestProducer } from '../infrastructure/kafka/command-request-producer.js';
import { SessionLifecycleConsumer } from '../infrastructure/kafka/session-lifecycle-consumer.js';
import { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { BindingRepository } from '../infrastructure/persistence/binding.repository.js';
import { DeviceCommandRepository } from '../infrastructure/persistence/device-command.repository.js';
import { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import { FleetRepository } from '../infrastructure/persistence/fleet.repository.js';
import { VehicleRepository } from '../infrastructure/persistence/vehicle.repository.js';
import {
  DeviceCommandIssuesController,
  DeviceCommandsController,
} from './device-commands.controller.js';
import { DevicesController } from './devices.controller.js';
import { FleetsController } from './fleets.controller.js';
import { SummaryController } from './summary.controller.js';
import {
  BINDING_SERVICE,
  COMMAND_ACK_CONSUMER,
  COMMAND_REQUEST_PRODUCER,
  DEVICE_COMMAND_REPOSITORY,
  DEVICE_COMMAND_SERVICE,
  DEVICE_REPOSITORY,
  DEVICE_SERVICE,
  FLEET_MANAGEMENT_CONFIG,
  FLEET_SERVICE,
  SESSION_LIFECYCLE_CONSUMER,
  SUMMARY_SERVICE,
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
        // Class-token alias for the services that inject `DeviceRepository`
        // directly (DEVICE_SERVICE / BINDING_SERVICE) — without it Nest cannot
        // resolve the class token at boot (latent wiring bug surfaced by the
        // Sprint E E2E, the first full AppModule boot).
        {
          provide: DeviceRepository,
          useExisting: DEVICE_REPOSITORY,
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
          ) => new BindingService(knex as never, vehicles, devices, bindings, audit, invalidation),
        },
        {
          provide: DEVICE_SERVICE,
          inject: [
            KNEX_TOKEN,
            DeviceRepository,
            AuditRepository,
            'REGISTRY_INVALIDATION_PUBLISHER',
            VehicleRepository,
            BINDING_SERVICE,
          ],
          useFactory: (
            knex: unknown,
            devices: DeviceRepository,
            audit: AuditRepository,
            invalidation: RegistryInvalidationPublisher,
            vehicles: VehicleRepository,
            bindings: BindingService,
          ) => new DeviceService(knex as never, devices, audit, invalidation, vehicles, bindings),
        },
        // Dashboard count aggregate (Sprint E §21) — read-only, existing domains.
        {
          provide: SUMMARY_SERVICE,
          inject: [FleetRepository, VehicleRepository, DEVICE_REPOSITORY],
          useFactory: (
            fleets: FleetRepository,
            vehicles: VehicleRepository,
            devices: DeviceRepository,
          ) => new SummaryService(fleets, vehicles, devices),
        },
        // Kafka session-lifecycle consumer (non-fatal at boot).
        {
          provide: SESSION_LIFECYCLE_CONSUMER,
          inject: [FLEET_MANAGEMENT_CONFIG, DEVICE_REPOSITORY],
          useFactory: (cfg: FleetManagementConfig, devices: DeviceRepository) =>
            new SessionLifecycleConsumer(cfg, devices),
        },
        // --- Device commands (downstream TCP configuration, 06 §11.3) ---
        {
          provide: DEVICE_COMMAND_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new DeviceCommandRepository(knex as never),
        },
        {
          provide: DeviceCommandRepository,
          useExisting: DEVICE_COMMAND_REPOSITORY,
        },
        {
          provide: COMMAND_REQUEST_PRODUCER,
          inject: [FLEET_MANAGEMENT_CONFIG],
          useFactory: (cfg: FleetManagementConfig) => new CommandRequestProducer(cfg),
        },
        {
          provide: DEVICE_COMMAND_SERVICE,
          inject: [
            KNEX_TOKEN,
            DEVICE_REPOSITORY,
            DEVICE_COMMAND_REPOSITORY,
            AuditRepository,
            COMMAND_REQUEST_PRODUCER,
            FLEET_MANAGEMENT_CONFIG,
          ],
          useFactory: (
            knex: unknown,
            devices: DeviceRepository,
            commands: DeviceCommandRepository,
            audit: AuditRepository,
            producer: CommandRequestProducer,
            cfg: FleetManagementConfig,
          ) => {
            const service = new DeviceCommandService(
              knex as never,
              devices,
              commands,
              audit,
              producer,
              {
                defaultTtlSeconds: cfg.FLEET_COMMAND_TTL_SECONDS,
                sweepIntervalSeconds: cfg.FLEET_COMMAND_SWEEP_SECONDS,
              },
            );
            service.startSweeper();
            return service;
          },
        },
        // Command-ack consumer (non-fatal at boot).
        {
          provide: COMMAND_ACK_CONSUMER,
          inject: [FLEET_MANAGEMENT_CONFIG, DEVICE_COMMAND_REPOSITORY],
          useFactory: (cfg: FleetManagementConfig, commands: DeviceCommandRepository) =>
            new CommandAckConsumer(cfg, commands),
        },
      ],
      controllers: [
        FleetsController,
        VehiclesController,
        DevicesController,
        SummaryController,
        DeviceCommandsController,
        DeviceCommandIssuesController,
      ],
    };
  }
}
