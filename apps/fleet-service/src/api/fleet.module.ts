/**
 * FleetModule — wires driver + business-trip repositories, controllers.
 */
import { AuthCoreModule, jwtAuthGuardProvider } from '@fleetvision/auth';
import { KNEX_TOKEN, PLATFORM_KNEX_TOKEN } from '@fleetvision/persistence-knex';
import type { Knex } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import type { FleetConfig } from '../config/fleet.config.js';
import { BusinessTripRepository } from '../infrastructure/persistence/business-trip.repository.js';
import { DriverRepository } from '../infrastructure/persistence/driver.repository.js';
import { BusinessTripsController } from './business-trips.controller.js';
import { DriversController } from './drivers.controller.js';

@Module({})
export class FleetModule {
  public static forRoot(_config: FleetConfig): DynamicModule {
    return {
      module: FleetModule,
      imports: [
        AuthCoreModule.forRoot({
          jwtSecret: _config.JWT_SECRET,
          issuer: _config.JWT_ISSUER,
          audience: _config.JWT_AUDIENCE,
        }),
      ],
      providers: [
        jwtAuthGuardProvider(),
        {
          provide: DriverRepository,
          inject: [KNEX_TOKEN, PLATFORM_KNEX_TOKEN],
          useFactory: (knex: Knex, platformKnex: Knex) => new DriverRepository(knex, platformKnex),
        },
        {
          provide: BusinessTripRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new BusinessTripRepository(knex),
        },
      ],
      controllers: [DriversController, BusinessTripsController],
    };
  }
}
