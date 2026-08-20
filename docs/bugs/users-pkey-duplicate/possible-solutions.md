# Possible solutions

| Option | Approach | Pros | Cons |
| --- | --- | --- | --- |
| A. Atomic check-then-write | Run the existence check and INSERT/UPDATE in **one** tenant-scoped transaction (single `withTenantContext` around both) | Removes the TOCTOU; decision matches the committed state | None significant |
| B. Idempotent INSERT | Add `.onConflict('id').ignore()` to `insertUser` | A residual duplicate-id insert becomes a no-op instead of a crash | Must skip event persistence when the row was skipped, or outbox gets duplicate rows |
| C. Global pre-check | Revert pre-check to `where({ id })` under `withoutTenantContext` (platform context so RLS passes) | Restores the original "update if id exists anywhere" semantics | Cross-tenant id reuse would silently UPDATE a *different* tenant's row — wrong row write |
| D. Composite primary key | Make `users_pkey` = `(tenant_id, id)` | Id is then only unique within a tenant | Large schema change; breaks FK references on `id`; doesn't fix the RLS-fail-closed root issue |
| E. Fix `withoutTenantContext` to set `is_platform` | Ensure platform context is truly platform | Needed for cross-tenant reads (seed, username lookup) | Already done in the working tree; does not by itself fix `save()` |

## Chosen combination

**A + B**, plus the already-present working-tree fixes (tenant-scoped pre-check in
`save()`, `withoutTenantContext` setting `app.is_platform`). C is rejected because
it can silently update another tenant's row; D is rejected as an unnecessary and
breaking schema change.