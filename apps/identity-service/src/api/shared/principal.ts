/**
 * Re-export of the shared authenticated-context primitives (Sprint B). Identity
 * historically owned `Principal`/`getPrincipal`; they now live in
 * `@fleetvision/auth` so every service shares one model. This shim keeps
 * existing import paths (`../shared/principal.js`) compiling.
 */
export {
  getAuthContext,
  getPrincipal,
  type AuthenticatedContext,
  type Principal,
} from '@fleetvision/auth';
