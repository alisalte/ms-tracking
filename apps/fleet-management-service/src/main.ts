/**
 * fleet-management-service bootstrap.
 *
 * Order matters (Codebase Architecture §4):
 *   1. Validate env against the fleet-management schema — crash-fast on misconfig.
 *   2. Create the Nest app with the validated config (AppModule.forRoot).
 *   3. Enable shutdown hooks so SIGTERM/SIGINT close the knex pool, Redis, and the
 *      Kafka consumer gracefully.
 *   4. Listen on the configured port/host.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { fleetManagementConfigSchema } from './config/fleet-management.config.js';

async function bootstrap(): Promise<void> {
  // 1. Crash-fast env validation.
  const config = fleetManagementConfigSchema.parse({
    ...process.env,
    serviceName: 'fleet-management-service',
  });

  // 2. Create the app. AppModule composes config/logger/persistence/redis/auth/health
  //    plus the FleetManagementModule (fleet/vehicle/device domain + REST API +
  //    session-lifecycle Kafka consumer).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  // 3. Cross-cutting web primitives (JSON:API error envelope + request-id).
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // 4. Graceful shutdown: enables OnApplicationShutdown hooks (closes knex/redis,
  //    disconnects the Kafka consumer).
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  // eslint-disable-next-line no-console
  console.log(
    `fleet-management-service listening on http://${config.HOST}:${config.PORT}/health/live`,
  );
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[fleet-management-service] Failed to start:', err);
  process.exit(1);
});
