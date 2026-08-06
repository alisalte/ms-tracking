/**
 * map-engine-service bootstrap (08 §1.5).
 *
 * Order matters (Codebase Architecture §4):
 *   1. Validate env — crash-fast on misconfig.
 *   2. Create the Nest app with the validated config.
 *   3. Enable shutdown hooks (close knex pool + Redis).
 *   4. Listen on the configured port/host.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { mapEngineConfigSchema } from './config/map-engine.config.js';

async function bootstrap(): Promise<void> {
  const config = mapEngineConfigSchema.parse({
    ...process.env,
    serviceName: 'map-engine-service',
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  // eslint-disable-next-line no-console
  console.log(`map-engine-service listening on http://${config.HOST}:${config.PORT}/health/live`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[map-engine-service] Failed to start:', err);
  process.exit(1);
});
