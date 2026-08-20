# Reproduction

## Observed behaviour

Two identical errors are emitted (e.g. two login attempts for the same user):

```
error: insert into "iam"."users" ("auth_provider", "display_name", "email", "id",
"mfa_enabled", "password_hash", "status", "tenant_id", "username", "version")
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
- duplicate key value violates unique constraint "users_pkey"
```

The SQL column list matches exactly the object passed to
`trx('iam.users').insert(...)` in `insertUser()`
(`apps/identity-service/src/infrastructure/persistence/user.repository.ts`).

## Environment that triggers it

- Runtime DB role is the non-superuser `fleetvision_app` (NOBYPASSRLS), so
  **Row-Level Security is enforced** at runtime.
- RLS policy on `iam.users` (migration `20260820110000_allow_platform_context_in_iam_rls.js`):

  ```sql
  USING ((current_setting('app.is_platform', true) = 'true')
         OR (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  ```

  Without `app.current_tenant_id` / `app.is_platform` set, the predicate is
  false for every row → **fails closed**.

## Repro steps

1. Deploy commit `6d0b283` ("fr") — where `save()` ran its existence pre-check as
   a bare `this.knex('iam.users').where({ id }).first()` with **no tenant or
   platform context** (RLS fails closed → always `null`).
2. Boot the stack so `iam.users` contains at least one user (seed or migration).
3. Call `POST /api/v1/auth/login` for that user (or trigger any
   `UserRepository.save()` on a rehydrated user).

### Result

- `findByEmail` succeeds (it runs inside `withTenantContext`).
- `save()`'s pre-check returns `null` (RLS hides every row).
- `save()` takes the INSERT branch → the row's `id` already exists → `users_pkey` violation.

Each failed attempt emits one error; two attempts → two identical errors.

## Why a fresh DB didn't fail on first boot

On an empty DB the seed's first INSERT succeeds (nothing to collide with). The
violation appears as soon as the same `id` is inserted a second time — i.e. the
first login, a second seed run, or a re-save.