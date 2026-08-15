/**
 * FleetModule — wires driver + business-trip repositories, controllers.
 */
import { AuthModule, jwtAuthGuardProvider } from '@fleetvision/auth';
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
        AuthModule.forRoot({
          jwt: {
            JWT_SECRET: _config.JWT_SECRET,
            JWT_ISSUER: _config.JWT_ISSUER,
            JWT_AUDIENCE: _config.JWT_AUDIENCE,
          },
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
