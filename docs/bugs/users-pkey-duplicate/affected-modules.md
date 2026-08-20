# Affected modules

| Module | File | Role in the bug |
| --- | --- | --- |
| User persistence | `apps/identity-service/src/infrastructure/persistence/user.repository.ts` | `save()` pre-check + `insertUser()` — the code that INSERTs and collides with `users_pkey` |
| Tenant context | `packages/persistence-knex/src/tenant-context.ts` | `withTenantContext` / `withoutTenantContext` — the only way to set the RLS GUCs |
| RLS policy | `apps/identity-service/src/infrastructure/database/migrations/20260820110000_allow_platform_context_in_iam_rls.js` | Hardened `iam.users` policy (platform OR tenant predicate) |
| Runtime grants | `apps/identity-service/src/infrastructure/database/migrations/20260820100000_grant_iam_runtime_privileges.js` | Enables runtime DML for `fleetvision_app` (RLS enforced) |
| Schema | `apps/identity-service/src/infrastructure/database/migrations/20260102000000_create_iam_schema.js` | `users_pkey` = global unique on `id`; `iam_users_tenant_email_unique`; `iam_users_username_unique` |
| Runtime wiring | `apps/identity-service/src/app.module.ts` | `migrationsClient`/`platformClient` = `DBURL_PLATFORM` (privileged), runtime `DBURL` = `fleetvision_app` |
| Bootstrap seed | `apps/identity-service/src/api/shared/bootstrap-seed.ts` + `provision-tenant.use-case.ts` | First user INSERT; relies on `save()` deciding correctly |
| Login flow | `apps/identity-service/src/application/auth/login.use-case.ts` | Calls `save()` on an existing rehydrated user → most common trigger |

Not affected: notification-service `UserDirectory` (read-only), tests, other services.