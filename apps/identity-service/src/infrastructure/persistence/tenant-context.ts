/**
 * Re-export of the shared tenant-context helpers (Sprint B). The canonical
 * `withTenantContext` / `withoutTenantContext` now live in
 * `@fleetvision/persistence-knex`; identity re-exports them so its existing
 * import paths (`./tenant-context.js`) keep compiling.
 */
export { withTenantContext, withoutTenantContext } from '@fleetvision/persistence-knex';
