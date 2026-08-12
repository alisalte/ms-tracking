/**
 * fleet-service bootstrap. Mirrors the notification-service pattern.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { fleetConfigSchema } from './config/fleet.config.js';

async function bootstrap() {
  const config = fleetConfigSchema.parse({
    ...process.env,
    serviceName: 'fleet-service',
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  new Logger('Bootstrap').log(`fleet-service listening on :${config.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start fleet-service:', err);
  process.exit(1);
});
