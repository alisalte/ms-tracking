# @fleetvision/persistence-knex

The relational gateway for FleetVision services (Codebase Architecture §10): a **PgBouncer-aware knex client factory**, a CRUD `BaseRepository` for aggregate repositories to extend, and a **migrations runner** wired into a NestJS `PersistenceModule`.

No heavy ORM (ADR-021 §2.1) — knex gives explicit, aggregate-aligned SQL; each concrete repository owns its queries and its domain↔row mapper.

## Usage

```ts
// apps/identity-service/src/app.module.ts
import path from 'node:path';
import { PersistenceModule } from '@fleetvision/persistence-knex';

@Module({
  imports: [
    // `cfg` is the validated IdentityConfig from ConfigModule (see main.ts).
    PersistenceModule.forRoot({
      client: { url: cfg.dbUrl },
      migrations: { directory: path.join(import.meta.dirname, 'infrastructure/database/migrations') },
    }),
  ],
})
export class AppModule {}
```

## Exports

| Symbol | Purpose |
|---|---|
| `PersistenceModule.forRoot({ client, migrations })` | Builds the knex client, runs migrations on boot, closes the pool on shutdown |
| `KNEX_TOKEN` | Inject to receive the `Knex` client |
| `createKnex(opts)` | The client factory (PgBouncer-aware) |
| `BaseRepository<Row>` | CRUD base for aggregate repositories |
| `runMigrations(client, opts)` | Apply pending migrations |

## PgBouncer

Transaction-mode PgBouncer cannot pool prepared statements across checkouts. The factory disables them when `pgBouncer: true` **or** the URL contains `?pgbouncer=1`. Production places PgBouncer in front of every Postgres instance (03_Database_Architecture.md §21.2).
