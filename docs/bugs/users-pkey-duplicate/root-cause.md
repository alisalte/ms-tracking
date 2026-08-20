# Root cause

## The constraint

`iam.users` is created with `t.uuid('id').primary()` — the primary key is
**`users_pkey` = unique on `id` alone, globally** (across all tenants). Email
uniqueness is a separate index (`iam_users_tenant_email_unique`), username
uniqueness is another (`iam_users_username_unique`). So an INSERT fails on
`users_pkey` only when the **same `id` is inserted twice**.

## Why the same `id` is inserted twice

`UserRepository.save()` (create-vs-update decision):

```ts
const existing = await this.knex('iam.users').where({ id: user.id as string }).first();
if (!existing) {
  await this.insertUser(tenantId, user, events, ctx);   // INSERT (collides)
} else {
  await this.updateUser(...);                            // UPDATE
}
```

At commit `6d0b283` ("fr") the pre-check ran as a **bare knex query with no
tenant/platform context**. The runtime role `fleetvision_app` is NOBYPASSRLS, and
the hardened RLS policy fails closed when neither `app.current_tenant_id` nor
`app.is_platform` is set:

```sql
( app.is_platform = 'true' )
OR ( tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid )
--                     ^ both GUCs NULL -> predicate is FALSE for every row
```

Therefore the pre-check returned `null` for **every** id, even for rows that
existed. Every `save()` on a persisted user (login, lockout, seed re-run) fell
into the INSERT branch and inserted an `id` that was already in the table →
`duplicate key value violates unique constraint "users_pkey"`.

## Contributing factor (why this wasn't caught earlier)

Before the runtime split the app connected as the DB owner/superuser, which
**bypasses RLS**, so the bare pre-check saw real rows and the UPDATE branch was
taken. The RLS note in `packages/persistence-knex/src/tenant-context.ts`
("RLS is currently NOT the enforcing boundary") became stale once `fleetvision_app`
started enforcing it — but the pre-check was never given a context.

## Secondary defect (same file, still latent after the RLS fix)

Even with the pre-check wrapped in `withTenantContext(tenantId)`, the check and
the write run in **two separate transactions** (TOCTOU), and `users_pkey` is
global while the pre-check is tenant-scoped — a same-`id` row created under a
*different* tenant is invisible to the pre-check and the INSERT would still
collide. This was fixed with the single-transaction write + `onConflict('id')`
guard (see `recommended-fix.md`).