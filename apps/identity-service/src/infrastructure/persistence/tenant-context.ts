/**
 * Tenant-context helpers — re-exported from @fleetvision/persistence-knex so the
 * identity-service's existing imports keep resolving. The canonical
 * implementation lives in the shared persistence package (used by every service
 * now that RLS is enforced DB-side).
 */
export {
  withTenantContext,
  withoutTenantContext,
  withPlatformContext,
  assertUuid,
  assertBoolString,
} from '@fleetvision/persistence-knex';
