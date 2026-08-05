/**
 * HealthModule — wires terminus + the health controller. Import once in the app
 * module. Depends on the knex/redis clients being available in the DI graph
 * (via PersistenceModule / RedisModule), so its indicators can ping them.
 */
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { KnexPingIndicator } from './knex-ping.indicator.js';
import { RedisPingIndicator } from './redis-ping.indicator.js';

@Module({
  imports: [TerminusModule.forRoot()],
  controllers: [HealthController],
  providers: [KnexPingIndicator, RedisPingIndicator],
})
export class HealthModule {}
