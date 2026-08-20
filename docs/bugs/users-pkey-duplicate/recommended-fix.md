# Recommended fix

Applied in `apps/identity-service/src/infrastructure/persistence/user.repository.ts`.

## 1. Atomic check-then-write (removes TOCTOU)

`save()` now runs the existence check and the write inside ONE tenant-scoped
transaction, so the create-vs-update decision cannot race a concurrent save of
the same aggregate:

```ts
public async save(user: User, ctx: EventContext): Promise<void> {
  const tenantId = user.tenantId;
  const events = user.pullEvents();
  await withTenantContext(this.knex, tenantId, async (trx) => {
    const existing = await trx('iam.users')
      .where({ id: user.id as string, tenant_id: tenantId })
      .first();
    if (!existing) {
      await this.insertUser(trx, tenantId, user, events, ctx);
    } else {
      await this.updateUser(trx, tenantId, user, events, ctx);
    }
  });
  user.markEventsCommitted();
}
```

`insertUser` / `updateUser` now receive the `trx` instead of opening their own
transaction.

## 2. Idempotent INSERT (defends the global `users_pkey`)

`insertUser` guards the insert with `.onConflict('id').ignore()` and skips event
persistence when the row already existed:

```ts
const inserted = await trx('iam.users').insert({ ... })
  .onConflict('id')
  .ignore()
  .returning('id');
if (inserted.length === 0) return;
await this.persistEvents(trx, tenantId, user.id as string, events, ctx);
```

This covers the residual case where a same-`id` row exists under a *different*
tenant (invisible to the tenant-scoped pre-check because `users_pkey` is global).

## 3. Keep the already-present context fixes

- `save()` pre-check must run under `withTenantContext(tenantId)` (working tree)
  — otherwise RLS fails closed and the pre-check sees nothing.
- `withoutTenantContext()` must set `app.is_platform = 'true'` (working tree) so
  the bootstrap seed's `findByUsername` and other platform reads pass the policy.

## Verification

- `pnpm --filter @fleetvision/identity-service typecheck` ✅
- `pnpm --filter @fleetvision/identity-service test` ✅ (42/42; the 3
  pre-existing `identity.config.spec.ts` failures were caused by the new required
  `DBURL_PLATFORM` in commit "fr" — fixed by adding it to the test fixture).