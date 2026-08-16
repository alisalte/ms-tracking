/**
 * reporting-service bootstrap.
 *
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
import { reportingConfigSchema } from './config/reporting.config.js';

async function bootstrap(): Promise<void> {
  const config = reportingConfigSchema.parse({
    ...process.env,
    serviceName: 'reporting-service',
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  // eslint-disable-next-line no-console
  console.log(`reporting-service listening on http://${config.HOST}:${config.PORT}/health/live`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[reporting-service] Failed to start:', err);
  process.exit(1);
});
