/**
 * device-gateway-service bootstrap.
 *
 * Order matters (Codebase Architecture §4):
 *   1. Validate env against the gateway schema — crash-fast on misconfig.
 *   2. Create the Nest app with the validated config (AppModule.forRoot).
 *   3. Enable shutdown hooks so SIGTERM/SIGINT close the TCP/UDP servers, the
 *      connection pool, the Kafka producer, and Redis (06 §15.2 graceful drain).
 *   4. Listen on the admin HTTP port. Protocol TCP/UDP listeners open their own
 *      ports from GATEWAY_LISTENERS during onApplicationBootstrap.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { deviceGatewayConfigSchema } from './config/device-gateway.config.js';

async function bootstrap(): Promise<void> {
  // 1. Crash-fast env validation.
  const config = deviceGatewayConfigSchema.parse({
    ...process.env,
    serviceName: 'device-gateway-service',
  });

  // 2. Create the app. AppModule composes config/logger/persistence/redis/health
  //    plus the GatewayModule (adapters, transport, sessions, dispatcher, Kafka).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  // 3. Cross-cutting web primitives.
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // 4. Graceful shutdown: enables OnApplicationShutdown hooks (closes TCP/UDP
  //    servers, the pool, the Kafka producer, knex, Redis).
  app.enableShutdownHooks();

  await app.listen(config.GATEWAY_ADMIN_PORT, config.GATEWAY_HOST);
  // eslint-disable-next-line no-console
  console.log(
    `device-gateway-service admin on http://${config.GATEWAY_HOST}:${config.GATEWAY_ADMIN_PORT}/health/live`,
  );
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[device-gateway-service] Failed to start:', err);
  process.exit(1);
});
