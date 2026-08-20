# Lessons learned

1. **"RLS is not enforced" notes go stale the moment the runtime role changes.**
   `packages/persistence-knex/src/tenant-context.ts` documented that RLS was
   bypassed because the app connected as owner. Once `fleetvision_app`
   (NOBYPASSRLS) became the runtime role, every untracked knex query silently
   failed closed. Every query touching an RLS-enabled table MUST run inside
   `withTenantContext` / `withoutTenantContext`.

2. **Check-then-insert is not atomic.** A create-vs-update decision split across
   two transactions (two `withTenantContext` calls) leaves a race window. Keep
   the check and the write in the same transaction.

3. **Primary-key uniqueness is global; tenant scoping is local.** `users_pkey`
   is unique on `id` alone. A pre-check scoped by `(id, tenant_id)` cannot see a
   same-`id` row in another tenant, so the INSERT needs an `ON CONFLICT` guard —
   or the constraint should be composite.

4. **Schema contract changes break tests and fixtures.** Adding a required env
   var (`DBURL_PLATFORM`) without updating `identity.config.spec.ts` broke 3
   tests on the same commit that introduced the runtime role split.

5. **The same error twice in a log usually means the same id was attempted
   twice**, not a UUID collision. UUID collisions are statistically impossible
   here — a reused id always points at an application logic path (stale
   existence check, double save, re-provisioning).