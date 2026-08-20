# Status

**Date:** 2026-08-20

| Phase | State |
| --- | --- |
| Root cause identified | ✅ — `save()` pre-check ran without tenant/platform context; RLS failed closed → every save of an existing user took the INSERT branch → `users_pkey` violation |
| Code fix implemented | ✅ — atomic single-transaction check-then-write + `.onConflict('id').ignore()` guard in `UserRepository` |
| Pre-existing test breakage | ✅ — `identity.config.spec.ts` updated with `DBURL_PLATFORM` fixture |
| Typecheck | ✅ — `pnpm --filter @fleetvision/identity-service typecheck` passes |
| Unit tests | ✅ — 42/42 pass (`pnpm --filter @fleetvision/identity-service test`) |
| Deployed | ⏳ — changes are uncommitted in the working tree; must be committed and the image redeployed |

## Open items

- Commit the working-tree changes (they include the context/Runtime fixes from
  the RLS split) and redeploy `identity-service`.
- Optionally add a regression test for `save()` on an already-persisted user
  exercising the INSERT/UPDATE branch selection.
- Consider making `users_pkey` composite `(tenant_id, id)` in a future schema
  migration so tenant scoping and key uniqueness align.