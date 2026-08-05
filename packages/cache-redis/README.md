# @fleetvision/cache-redis

Shared cache/coordination layer for FleetVision services (01 §4.2, Codebase Architecture §10): an **ioredis client factory** plus a NestJS `RedisModule`.

One client per service connects to the platform Redis. It is used for rate-limit counters, idempotency keys, short-lived tokens, and the read-side cache.

## Usage

```ts
import { RedisModule } from '@fleetvision/cache-redis';

@Module({ imports: [RedisModule.forRoot({ url: cfg.redisUrl })] })
export class AppModule {}
```

| Symbol | Purpose |
|---|---|
| `RedisModule.forRoot({ url })` | Builds the client, closes it on shutdown |
| `REDIS_TOKEN` | Inject to receive the ioredis `Redis` client |
| `createRedisClient(opts)` | The factory |
