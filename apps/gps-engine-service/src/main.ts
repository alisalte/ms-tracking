/**
 * gps-engine-service bootstrap.
 *
 * Order matters (Codebase Architecture §4):
 *   1. Validate env against the GPS engine schema — crash-fast on misconfig.
 *   2. Create the Nest app with the validated config (AppModule.forRoot).
 *   3. Enable shutdown hooks so SIGTERM/SIGINT close the knex pool, Redis, Kafka
 *      consumer, and the WebSocket server gracefully.
 *   4. Listen on the configured port/host.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { gpsEngineConfigSchema } from './config/gps-engine.config.js';

async function bootstrap(): Promise<void> {
  // 1. Crash-fast env validation.
  const config = gpsEngineConfigSchema.parse({
    ...process.env,
    serviceName: 'gps-engine-service',
  });

  // 2. Create the app. AppModule composes config/logger/persistence/redis/health
  //    plus the GpsEngineModule (Kafka consumer, pipeline, WS gateway, REST API).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  // 3. Cross-cutting web primitives.
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // 4. Graceful shutdown: enables OnApplicationShutdown hooks (closes knex/redis,
  //    disconnects the Kafka consumer + Socket.IO server).
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  // eslint-disable-next-line no-console
  console.log(`gps-engine-service listening on http://${config.HOST}:${config.PORT}/health/live`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[gps-engine-service] Failed to start:', err);
  process.exit(1);
});
