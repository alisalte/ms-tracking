/**
 * media-service bootstrap (09 §1.5).
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { mediaConfigSchema } from './config/media.config.js';

async function bootstrap(): Promise<void> {
  const config = mediaConfigSchema.parse({
    ...process.env,
    serviceName: 'media-service',
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  // eslint-disable-next-line no-console
  console.log(`media-service listening on http://${config.HOST}:${config.PORT}/health/live`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[media-service] Failed to start:', err);
  process.exit(1);
});
