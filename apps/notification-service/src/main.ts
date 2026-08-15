/**
 * notification-service bootstrap.
 *
 * Crash-fast env validation → NestFactory → global web primitives (exception
 * filter, request-id interceptor) → graceful shutdown → listen. Mirrors the
 * gps-engine bootstrap pattern.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { notificationConfigSchema } from './config/notification.config.js';

async function bootstrap() {
  const config = notificationConfigSchema.parse({
    ...process.env,
    serviceName: 'notification-service',
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  const logger = new Logger('Bootstrap');
  logger.log(`notification-service listening on :${config.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start notification-service:', err);
  process.exit(1);
});
