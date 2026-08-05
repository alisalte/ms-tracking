# @fleetvision/config

Typed, **zod-validated** environment config loader for FleetVision services (Codebase Architecture §13).

## Why

Twelve-factor: config lives in the **environment**, not in code. The same Docker image runs in dev, staging, and prod; only the env (ConfigMap/Secret) differs. **Validation at boot** means an invalid config crashes the process immediately instead of failing mysteriously mid-request.

## Usage

Config lives in the environment, so zod keys are the conventional UPPERCASE env
var names (zod reads `process.env` literally). The service merges its own keys
onto the shared base schema.

```ts
// apps/identity-service/src/config/identity.config.ts
import { z } from 'zod';
import { baseConfigSchema } from '@fleetvision/config';

export const identityConfigSchema = baseConfigSchema.merge(
  z.object({
    DBURL: z.string().min(1),
    REDISURL: z.string().min(1),
    JWT_ISSUER: z.string().min(1).default('fleetvision'),
  }),
);
export type IdentityConfig = z.infer<typeof identityConfigSchema>;
```

```ts
// apps/identity-service/src/app.module.ts
import { ConfigModule } from '@fleetvision/config';
import { identityConfigSchema } from './config/identity.config.js';

@Module({ imports: [ConfigModule.forRoot({ schema: identityConfigSchema, serviceName: 'identity-service' })] })
export class AppModule {}
```

## Base schema keys (env var names)

| Env var | Type | Default | Notes |
|---|---|---|---|
| `PORT` | number | `3000` | HTTP listen port |
| `HOST` | string | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | enum | `info` | pino level |
| `ENVIRONMENT` | enum | `local` | local/dev/staging/production |

`serviceName` is injected by `ConfigModule.forRoot({ serviceName })` (each
service knows its own name statically), not read from env.

## Exports

| Symbol | Purpose |
|---|---|
| `ConfigModule.forRoot({ schema, serviceName })` | Validates env and provides a typed config |
| `TypedConfigService` | Inject to read typed config values |
| `CONFIG_TOKEN` | The raw validated config token (advanced use) |
| `baseConfigSchema` | Shared base schema (PORT, HOST, LOG_LEVEL, ENVIRONMENT) — extend this |
