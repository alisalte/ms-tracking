/**
 * identity-service bootstrap.
 *
 * Order matters (Codebase Architecture §4):
 *   1. Validate env against the identity schema — crash-fast on misconfig.
 *   2. Create the Nest app with the validated config (AppModule.forRoot).
 *   3. Enable shutdown hooks so SIGTERM/SIGINT close the knex pool + Redis
 *      gracefully (DoD #7).
 *   4. Listen on the configured port/host.
 */
import 'reflect-metadata';
import { GlobalExceptionFilter, RequestIdInterceptor } from '@fleetvision/web';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { identityConfigSchema } from './config/identity.config.js';

async function bootstrap(): Promise<void> {
  // 1. Crash-fast env validation (ConfigModule would do this too, but doing it
  //    before NestFactory.create means a misconfigured env never starts a server).
  const config = identityConfigSchema.parse({
    ...process.env,
    serviceName: 'identity-service',
  });

  // 2. Create the app. AppModule composes config/logger/persistence/redis/health
  //    plus the Sprint 2 AuthModule (auth, users, tenants, api-keys).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });

  // 3. Cross-cutting web primitives.
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // 4. Graceful shutdown: enables OnApplicationShutdown hooks (closes knex/redis,
  //    disconnects the Kafka producer).
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
  // eslint-disable-next-line no-console
  console.log(`identity-service listening on http://${config.HOST}:${config.PORT}/health/live`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[identity-service] Failed to start:', err);
  process.exit(1);
});
